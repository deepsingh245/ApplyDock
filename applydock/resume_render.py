"""Deterministic Typst rendering of structured resumes plus post-render PDF validation."""
from __future__ import annotations

from collections import OrderedDict
import hashlib
import io
import json
from pathlib import Path
import re
import threading
import unicodedata

from . import resume_model

TEMPLATE_DIR = Path(__file__).resolve().parent / "resume_templates"
FONT_DIR = TEMPLATE_DIR / "fonts"
TEMPLATES = {
    "ats-classic": {"label": "ATS Classic", "file": "ats-classic.typ", "description": "Single column, centered header, standard spacing."},
    "compact": {"label": "Compact", "file": "compact.typ", "description": "Single column with tighter type for one-page resumes."},
}
MAX_RENDER_BYTES = 2_000_000
MAX_PAGES = 6
RENDER_LOCK = threading.Lock()
_CACHE: OrderedDict = OrderedDict()
_CACHE_SIZE = 12


class RenderError(ValueError):
    """The resume could not be rendered; the message is safe to show to the user."""


def _typst():
    try:
        import typst
    except ImportError:
        raise RenderError("PDF generation needs the typst package. Run: py -3 -m pip install -r requirements.txt") from None
    return typst


def status() -> dict:
    try:
        typst = _typst()
    except RenderError as error:
        return {"available": False, "message": str(error)}
    return {"available": True, "version": getattr(typst, "__version__", ""), "message": ""}


def renderer_version(template_id: str) -> str:
    digest = hashlib.sha256()
    for name in ("_common.typ", TEMPLATES[template_id]["file"]):
        digest.update((TEMPLATE_DIR / name).read_bytes())
    try:
        version = getattr(_typst(), "__version__", "")
    except RenderError:
        version = "missing"
    return f"typst-{version}:{digest.hexdigest()[:12]}"


def _dates(start: str, end: str) -> str:
    if start and end:
        return f"{start} – {end}"
    return start or end


def _display_url(url: str) -> str:
    if url.startswith("mailto:"):
        return url[7:]
    return re.sub(r"^https?://(www\.)?", "", url).rstrip("/")


def build_model(content: dict) -> dict:
    """Flatten normalized content into the simple structure the Typst templates consume."""
    basics = content["basics"]
    contact = []
    for value in (basics["email"], basics["phone"], basics["location"]):
        if value:
            url = "mailto:" + value if value == basics["email"] and "@" in value else ""
            contact.append({"text": value, "url": url})
    if basics["url"]:
        contact.append({"text": _display_url(basics["url"]), "url": basics["url"]})
    for profile in basics["profiles"]:
        if profile["url"]:
            contact.append({"text": _display_url(profile["url"]), "url": profile["url"]})
        elif profile["network"]:
            contact.append({"text": profile["network"], "url": ""})
    titles = content["meta"]["section_titles"]
    sections = []
    for key in content["meta"]["section_order"]:
        if not resume_model.section_has_content(content, key):
            continue
        if key == "summary":
            sections.append({"kind": "text", "title": titles["summary"], "text": basics["summary"]})
        elif key == "skills":
            groups = [{"name": item["name"], "keywords": ", ".join(item["keywords"])} for item in content["skills"] if item["name"] or item["keywords"]]
            if groups:
                sections.append({"kind": "skills", "title": titles["skills"], "groups": groups})
        elif key == "custom":
            for item in content["custom"]:
                lines = [child["text"] for child in item["items"] if child["text"]]
                if item["title"] and lines:
                    sections.append({"kind": "list", "title": item["title"], "items": lines})
        else:
            entries = [_entry(key, item) for item in content[key]]
            entries = [entry for entry in entries if entry["title"] or entry["subtitle"] or entry["bullets"]]
            if entries:
                sections.append({"kind": "entries", "title": titles[key], "entries": entries})
    style = dict(content["meta"]["layout"])
    style["leading"] = round(max(0.12, style["line_height"] - 0.85), 3)  # Typst leading is the gap between lines
    return {
        "name": basics["name"] or "Resume", "title": (basics["name"] or "Resume") + " — Resume",
        "headline": basics["label"], "contact": contact, "sections": sections, "paper": content["meta"]["paper"],
        "style": style,
    }


# Steps tried in order by fit_to_pages(): spacing first, then margins, then type size.
FIT_STEPS = [
    ("section_gap", 0.1, 0.4), ("entry_gap", 0.1, 0.3), ("bullet_gap", 0.05, 0.15), ("line_height", 0.05, 1.15),
    ("margin_y", 1.0, 8.0), ("margin_x", 1.0, 10.0), ("font_size", 0.25, 9.0), ("heading_size", 0.5, 9.5), ("name_size", 1.0, 15.0),
]


def fit_to_pages(content: dict, limit: int) -> dict:
    """Tighten the layout step by step until the resume fits `limit` pages.

    Returns {fitted, page_count, layout}. Never goes below readable minimums; if the content
    still does not fit, it reports that instead of shrinking further.
    """
    if limit < 1:
        raise RenderError("Choose a page limit first.")
    current = resume_model.normalize(content)
    pages = page_count(render(current))
    if pages <= limit:
        return {"fitted": True, "page_count": pages, "layout": current["meta"]["layout"], "changed": False}
    layout = dict(current["meta"]["layout"])
    for key, step, floor in FIT_STEPS:
        while layout[key] - step >= floor - 1e-9:
            layout[key] = round(layout[key] - step, 2)
            trial = {**current, "meta": {**current["meta"], "layout": layout}}
            pages = page_count(render(resume_model.normalize(trial)))
            if pages <= limit:
                return {"fitted": True, "page_count": pages, "layout": resume_model.normalize(trial)["meta"]["layout"], "changed": True}
    return {"fitted": False, "page_count": pages, "layout": layout, "changed": True}


def _entry(section: str, item: dict) -> dict:
    entry = {"title": "", "subtitle": "", "location": item.get("location", ""), "dates": "", "url": "", "url_text": "",
             "summary": "", "bullets": [child["text"] for child in item.get("highlights", []) if child["text"]], "keywords": ""}
    if section == "work":
        entry.update(title=item["position"] or item["name"], subtitle=item["name"] if item["position"] else "",
                     dates=_dates(item["startDate"], item["endDate"]), summary=item["summary"])
    elif section == "projects":
        entry.update(title=item["name"], dates=_dates(item["startDate"], item["endDate"]), summary=item["description"],
                     keywords=", ".join(item["keywords"]))
        if item["url"]:
            entry.update(url=item["url"], url_text=_display_url(item["url"]))
    elif section == "education":
        degree = " in ".join(value for value in (item["studyType"], item["area"]) if value)
        entry.update(title=degree or item["institution"], subtitle=item["institution"] if degree else "",
                     dates=_dates(item["startDate"], item["endDate"]),
                     summary="; ".join(value for value in (item["score"], ", ".join(item["courses"])) if value))
    elif section == "certificates":
        entry.update(title=item["name"], subtitle=item["issuer"], dates=item["date"])
        if item["url"]:
            entry.update(url=item["url"], url_text=_display_url(item["url"]))
    elif section == "awards":
        entry.update(title=item["title"], subtitle=item["awarder"], dates=item["date"], summary=item["summary"])
    return entry


def _sanitize_error(error: Exception) -> str:
    message = re.sub(r"(?i)\b[A-Z]:\\[^\s\"']+", "[template]", str(error))
    message = re.sub(r"/[^\s\"']+\.typ", "[template]", message)
    return message.splitlines()[0][:300] if message else "Typst could not render this resume."


def render(content: dict, template_id: str | None = None, fmt: str = "pdf") -> bytes:
    """Render normalized content to PDF bytes. Output is byte-for-byte deterministic for equal input."""
    template_id = template_id or content["meta"]["template"]
    if template_id not in TEMPLATES:
        raise RenderError("Choose an available template.")
    if fmt != "pdf":
        raise RenderError("Only PDF output is supported.")
    key = (resume_model.content_hash(content), template_id, renderer_version(template_id))
    with RENDER_LOCK:
        if key in _CACHE:
            _CACHE.move_to_end(key)
            return _CACHE[key]
        typst = _typst()
        payload = json.dumps(build_model(content), ensure_ascii=False)
        try:
            pdf = typst.compile(str(TEMPLATE_DIR / TEMPLATES[template_id]["file"]), root=str(TEMPLATE_DIR),
                                font_paths=[str(FONT_DIR)], ignore_system_fonts=True, format="pdf",
                                sys_inputs={"resume": payload})
        except Exception as error:
            raise RenderError("Typst could not render this resume: " + _sanitize_error(error)) from None
        if not isinstance(pdf, bytes) or not pdf.startswith(b"%PDF-"):
            raise RenderError("Typst returned an invalid PDF.")
        if len(pdf) > MAX_RENDER_BYTES:
            raise RenderError("The generated PDF is unexpectedly large.")
        if page_count(pdf) > MAX_PAGES:
            raise RenderError(f"The resume is longer than {MAX_PAGES} pages. Shorten it before generating a PDF.")
        _CACHE[key] = pdf
        while len(_CACHE) > _CACHE_SIZE:
            _CACHE.popitem(last=False)
        return pdf


def _reader(pdf: bytes):
    from pypdf import PdfReader
    return PdfReader(io.BytesIO(pdf))


def page_count(pdf: bytes) -> int:
    return len(_reader(pdf).pages)


_INVISIBLE = dict.fromkeys(map(ord, "­​‌‍⁠﻿•·|"), None)


def fold(value: str) -> str:
    """Comparison form that ignores case, whitespace, bullets and soft hyphens (extractors vary on these)."""
    value = unicodedata.normalize("NFKC", value).translate(_INVISIBLE).lower()
    value = value.replace("–", "-").replace("—", "-")
    return re.sub(r"\s+", "", value)


def _expected_links(content: dict) -> list:
    links = []
    basics = content["basics"]
    if basics["email"] and "@" in basics["email"]:
        links.append("mailto:" + basics["email"])
    links.extend(value for value in [basics["url"]] + [item["url"] for item in basics["profiles"]] if value)
    links.extend(item["url"] for item in content["projects"] + content["certificates"] if item["url"])
    return list(dict.fromkeys(links))


def validate(pdf: bytes, content: dict) -> dict:
    """Re-extract the generated PDF and compare it with the structured resume.

    Passing these checks means the text is extractable, complete and in order for this
    extractor; it is not a guarantee about any particular employer's ATS.
    """
    reader = _reader(pdf)
    pages = [page.extract_text() or "" for page in reader.pages]
    full = "\n".join(pages)
    folded = fold(full)
    missing = []
    for value in resume_model.expected_strings(content):
        if fold(value) and fold(value) not in folded:
            missing.append(value)
    blank_pages = [index + 1 for index, text in enumerate(pages) if not text.strip()]
    headings = [heading for heading in resume_model.heading_order(content)]
    lines = [fold(line) for line in full.splitlines() if line.strip()]
    heading_lines = [line for line in lines if line in {fold(value) for value in headings}]
    duplicates = sorted({heading for heading in headings if heading_lines.count(fold(heading)) > headings.count(heading)})
    first_line = {}
    for index, line in enumerate(lines):
        first_line.setdefault(line, index)
    positions = [first_line.get(fold(heading), -1) for heading in headings]
    order_ok = all(position >= 0 for position in positions) and positions == sorted(positions)
    found_links = []
    for page in reader.pages:
        for annotation in page.get("/Annots") or []:
            annotation = annotation.get_object()
            action = annotation.get("/A") or {}
            uri = action.get("/URI") if hasattr(action, "get") else None
            if uri:
                found_links.append(str(uri))
    links_missing = [link for link in _expected_links(content) if link not in found_links]
    fonts, unembedded = set(), set()
    for page in reader.pages:
        resources = page.get("/Resources") or {}
        for font in (resources.get("/Font") or {}).values():
            font = font.get_object()
            name = str(font.get("/BaseFont", "")).lstrip("/")
            fonts.add(re.sub(r"^[A-Z]{6}\+", "", name))
            descriptors = [font.get("/FontDescriptor")] + [child.get_object().get("/FontDescriptor") for child in font.get("/DescendantFonts") or []]
            embedded = any(d and any(key in d.get_object() for key in ("/FontFile", "/FontFile2", "/FontFile3")) for d in descriptors)
            if not embedded:
                unembedded.add(name)
    limit = content["meta"]["page_limit"]
    page_limit_ok = not limit or len(pages) <= limit
    warnings = []
    for value in missing[:8]:
        warnings.append(f"The generated PDF appears to be missing: “{value[:90]}”.")
    if len(missing) > 8:
        warnings.append(f"{len(missing) - 8} more expected text items were not found.")
    if blank_pages:
        warnings.append("Blank page(s) detected: " + ", ".join(map(str, blank_pages)) + ".")
    if not page_limit_ok:
        warnings.append(f"The document has {len(pages)} pages, above the selected limit of {limit}.")
    if duplicates:
        warnings.append("Section heading(s) appear more than once: " + ", ".join(duplicates) + ".")
    if not order_ok and headings:
        warnings.append("The extracted section order may differ from the resume order.")
    if links_missing:
        warnings.append(f"{len(links_missing)} link(s) are not clickable in the PDF.")
    if unembedded:
        warnings.append("Some fonts are not embedded: " + ", ".join(sorted(unembedded)) + ".")
    return {
        "ok": not warnings, "page_count": len(pages), "page_limit": limit, "page_limit_ok": page_limit_ok,
        "blank_pages": blank_pages, "missing": missing[:50], "missing_count": len(missing),
        "order_ok": order_ok, "duplicates": duplicates, "links_found": len(found_links),
        "links_missing": links_missing, "fonts": sorted(fonts), "unembedded_fonts": sorted(unembedded),
        "extracted_characters": len(full), "warnings": warnings,
    }
