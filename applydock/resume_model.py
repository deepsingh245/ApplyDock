"""Structured resume content: schema normalization, stable ids, edits, diffs, and fact checks.

Pure functions only (no database or file access). The internal format is a superset of
JSON Resume (https://jsonresume.org/schema) with stable ids on every editable item so AI
suggestions and edits can target content without fragile string replacement.
"""
from __future__ import annotations

import copy
import hashlib
import json
import re
import secrets
import unicodedata

SCHEMA_ID = "applydock-resume/1"
SECTIONS = ("summary", "work", "projects", "skills", "education", "certificates", "awards", "custom")
DEFAULT_ORDER = ["summary", "skills", "work", "projects", "education", "certificates", "awards", "custom"]
DEFAULT_TITLES = {
    "summary": "Summary", "work": "Experience", "projects": "Projects", "skills": "Skills",
    "education": "Education", "certificates": "Certifications", "awards": "Awards",
}
TEMPLATES = ("ats-classic", "compact")
PAPERS = ("a4", "us-letter")
ID_PATTERN = re.compile(r"^[a-z]{1,3}_[A-Za-z0-9]{6,24}$")
ID_PREFIX = {"profiles": "p", "work": "w", "projects": "pr", "skills": "s", "education": "e",
             "certificates": "c", "awards": "a", "custom": "cu", "highlights": "h", "items": "ci"}
LIMITS = {
    "text": 300, "summary": 2500, "highlight": 700, "keyword": 80,
    "items": 40, "highlights": 30, "keywords": 60, "profiles": 10,
}
ITEM_FIELDS = {
    "profiles": ("network", "url"),
    "work": ("name", "position", "location", "startDate", "endDate", "summary"),
    "projects": ("name", "url", "startDate", "endDate", "description"),
    "skills": ("name",),
    "education": ("institution", "area", "studyType", "startDate", "endDate", "score"),
    "certificates": ("name", "issuer", "date", "url"),
    "awards": ("title", "awarder", "date", "summary"),
    "custom": ("title",),
}
LONG_FIELDS = {"summary", "description"}
URL_FIELDS = {"url"}
BASICS_FIELDS = ("name", "label", "email", "phone", "url", "location", "summary")


def new_id(prefix: str) -> str:
    return f"{prefix}_{secrets.token_hex(5)}"


def empty_resume() -> dict:
    return normalize({"basics": {"name": ""}})


def clean_text(value, limit: int) -> str:
    value = unicodedata.normalize("NFC", str(value if value is not None else ""))
    value = "".join(char for char in value if char in "\n" or unicodedata.category(char)[0] != "C")
    value = re.sub(r"[ \t]+", " ", value)
    value = re.sub(r"\n{3,}", "\n\n", value)
    return value.strip()[:limit]


def clean_url(value, strict: bool) -> str:
    value = clean_text(value, LIMITS["text"])
    if not value:
        return ""
    if re.fullmatch(r"[^\s@/:]+@[^\s@/:]+\.[^\s@/:]+", value):
        value = "mailto:" + value
    elif not re.match(r"^[a-z][a-z0-9+.-]*:", value, re.I):
        value = "https://" + value.lstrip("/")
    scheme = value.split(":", 1)[0].lower()
    if scheme not in ("http", "https", "mailto") or re.search(r"\s", value):
        if strict:
            raise ValueError("Links must use http, https, or mailto.")
        return ""
    return value


def _assign_id(item: dict, prefix: str, seen: set) -> None:
    value = str(item.get("id") or "")
    if not ID_PATTERN.fullmatch(value) or value in seen:
        value = new_id(prefix)
        while value in seen:
            value = new_id(prefix)
    item["id"] = value
    seen.add(value)


def _text_list(items, prefix: str, limit: int, seen: set, drop_empty: bool) -> list:
    result = []
    for raw in items if isinstance(items, list) else []:
        item = raw if isinstance(raw, dict) else {"text": raw}
        text = clean_text(item.get("text", ""), LIMITS["highlight"])
        if not text and drop_empty:
            continue
        entry = {"id": item.get("id"), "text": text}
        _assign_id(entry, prefix, seen)
        result.append(entry)
        if len(result) >= limit:
            break
    return result


def _keywords(values) -> list:
    result = []
    for value in values if isinstance(values, list) else str(values or "").split(","):
        text = clean_text(value, LIMITS["keyword"])
        if text and text.lower() not in {item.lower() for item in result}:
            result.append(text)
    return result[:LIMITS["keywords"]]


def normalize(content: dict, strict: bool = True, drop_empty: bool = False) -> dict:
    """Return a cleaned copy with valid, unique ids. Raises ValueError on invalid links when strict.

    Empty items are kept by default so an editor can add a blank entry and fill it in later;
    importers pass drop_empty=True.
    """
    if not isinstance(content, dict):
        raise ValueError("Resume content must be an object.")
    seen: set = set()
    source = copy.deepcopy(content)
    basics_in = source.get("basics") if isinstance(source.get("basics"), dict) else {}
    basics = {}
    for field in BASICS_FIELDS:
        if field == "url":
            basics[field] = clean_url(basics_in.get(field), strict)
        else:
            basics[field] = clean_text(basics_in.get(field), LIMITS["summary"] if field == "summary" else LIMITS["text"])
    profiles = []
    for raw in (basics_in.get("profiles") or [])[:LIMITS["profiles"]]:
        if not isinstance(raw, dict):
            continue
        profile = {"id": raw.get("id"), "network": clean_text(raw.get("network"), LIMITS["text"]), "url": clean_url(raw.get("url"), strict)}
        if profile["url"] or profile["network"] or not drop_empty:
            _assign_id(profile, ID_PREFIX["profiles"], seen)
            profiles.append(profile)
    basics["profiles"] = profiles
    result = {"schema": SCHEMA_ID, "basics": basics}
    for section in ("work", "projects", "skills", "education", "certificates", "awards", "custom"):
        items = []
        for raw in source.get(section) or []:
            if not isinstance(raw, dict):
                continue
            item = {"id": raw.get("id")}
            for field in ITEM_FIELDS[section]:
                limit = LIMITS["summary"] if field in LONG_FIELDS else LIMITS["text"]
                item[field] = clean_url(raw.get(field), strict) if field in URL_FIELDS else clean_text(raw.get(field), limit)
            if section in ("work", "projects"):
                item["highlights"] = _text_list(raw.get("highlights"), ID_PREFIX["highlights"], LIMITS["highlights"], seen, drop_empty)
            if section in ("projects", "skills"):
                item["keywords"] = _keywords(raw.get("keywords"))
            if section == "education":
                item["courses"] = _keywords(raw.get("courses"))
            if section == "custom":
                item["items"] = _text_list(raw.get("items"), ID_PREFIX["items"], LIMITS["highlights"], seen, drop_empty)
            meaningful = any(value for key, value in item.items() if key != "id")
            if not meaningful and drop_empty:
                continue
            _assign_id(item, ID_PREFIX[section], seen)
            items.append(item)
            if len(items) >= LIMITS["items"]:
                break
        result[section] = items
    meta_in = source.get("meta") if isinstance(source.get("meta"), dict) else {}
    order = [value for value in meta_in.get("section_order") or [] if value in SECTIONS]
    order = list(dict.fromkeys(order + [value for value in DEFAULT_ORDER if value not in order]))
    titles = {}
    for key, default in DEFAULT_TITLES.items():
        title = clean_text((meta_in.get("section_titles") or {}).get(key, ""), 60) if isinstance(meta_in.get("section_titles"), dict) else ""
        titles[key] = title or default
    template = meta_in.get("template") if meta_in.get("template") in TEMPLATES else TEMPLATES[0]
    try:
        page_limit = int(meta_in.get("page_limit", 0))
    except (TypeError, ValueError):
        page_limit = 0
    paper = meta_in.get("paper") if meta_in.get("paper") in PAPERS else PAPERS[0]
    result["meta"] = {"section_order": order, "section_titles": titles, "template": template, "paper": paper,
                      "page_limit": page_limit if page_limit in (0, 1, 2, 3) else 0,
                      "layout": normalize_layout(meta_in.get("layout"), template)}
    return result


# Design settings (FlowCV-style "Customize"). Every value is clamped so a resume can never be
# rendered with unreadable type or text pushed off the page. Templates are presets of these values.
LAYOUT_PRESETS = {
    "ats-classic": {
        "font": "Carlito", "font_size": 10.5, "line_height": 1.4, "margin_x": 18, "margin_y": 15,
        "section_gap": 1.0, "entry_gap": 0.75, "bullet_gap": 0.45, "name_size": 20, "heading_size": 11,
        "header_align": "center", "accent": "#1f4e79", "accent_name": False, "accent_headings": False, "accent_links": True,
        "heading_rule": True, "heading_upper": True, "date_position": "right", "bullet": "•", "contact_separator": "|",
        "skills_inline": False,
    },
    "compact": {
        "font": "Carlito", "font_size": 9.5, "line_height": 1.3, "margin_x": 12.5, "margin_y": 11.5,
        "section_gap": 0.7, "entry_gap": 0.5, "bullet_gap": 0.3, "name_size": 16, "heading_size": 10,
        "header_align": "left", "accent": "#1f4e79", "accent_name": False, "accent_headings": False, "accent_links": True,
        "heading_rule": True, "heading_upper": True, "date_position": "right", "bullet": "•", "contact_separator": "|",
        "skills_inline": False,
    },
}
LAYOUT_RANGES = {
    "font_size": (8.0, 13.0), "line_height": (1.0, 2.0), "margin_x": (5.0, 40.0), "margin_y": (5.0, 40.0),
    "section_gap": (0.2, 2.5), "entry_gap": (0.0, 2.0), "bullet_gap": (0.0, 1.2), "name_size": (12.0, 32.0), "heading_size": (8.0, 16.0),
}
LAYOUT_CHOICES = {
    "font": ("Carlito", "Libertinus Serif", "New Computer Modern"),
    "header_align": ("left", "center", "right"),
    "date_position": ("right", "below"),
    "bullet": ("•", "–", "▪", "◦"),
    "contact_separator": ("|", "•", "·", "/"),
}
ACCENTS = ("#111111", "#1f4e79", "#2675a7", "#0f766e", "#2f6b3a", "#7a1f2b", "#5b3c88", "#4b5563")


def normalize_layout(raw, template: str) -> dict:
    preset = LAYOUT_PRESETS.get(template, LAYOUT_PRESETS[TEMPLATES[0]])
    raw = raw if isinstance(raw, dict) else {}
    layout = {}
    for key, default in preset.items():
        value = raw.get(key, default)
        if key in LAYOUT_RANGES:
            low, high = LAYOUT_RANGES[key]
            try:
                value = round(min(high, max(low, float(value))), 2)
            except (TypeError, ValueError):
                value = default
        elif key in LAYOUT_CHOICES:
            value = value if value in LAYOUT_CHOICES[key] else default
        elif key == "accent":
            value = value if isinstance(value, str) and re.fullmatch(r"#[0-9a-fA-F]{6}", value) else default
        else:
            value = bool(value)
        layout[key] = value
    return layout


def content_hash(content: dict) -> str:
    canonical = json.dumps(content, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def iter_items(content: dict):
    """Yield every editable text field as {target_id, field, text, section, label}."""
    basics = content.get("basics", {})
    for field in BASICS_FIELDS:
        if basics.get(field):
            yield {"target_id": "basics", "field": field, "text": basics[field],
                   "section": "summary" if field == "summary" else "basics", "label": field}
    for profile in basics.get("profiles", []):
        for field in ITEM_FIELDS["profiles"]:
            if profile.get(field):
                yield {"target_id": profile["id"], "field": field, "text": profile[field], "section": "basics", "label": profile.get("network") or "Profile"}
    for section in ("work", "projects", "skills", "education", "certificates", "awards", "custom"):
        for item in content.get(section, []):
            label = item.get("position") or item.get("name") or item.get("institution") or item.get("title") or section
            if section == "work" and item.get("name"):
                label = f"{label} — {item['name']}"
            for field in ITEM_FIELDS[section]:
                if item.get(field):
                    yield {"target_id": item["id"], "field": field, "text": item[field], "section": section, "label": label}
            if item.get("keywords"):
                yield {"target_id": item["id"], "field": "keywords", "text": ", ".join(item["keywords"]), "section": section, "label": label}
            if item.get("courses"):
                yield {"target_id": item["id"], "field": "courses", "text": ", ".join(item["courses"]), "section": section, "label": label}
            for child in item.get("highlights", []) + item.get("items", []):
                yield {"target_id": child["id"], "field": "text", "text": child["text"], "section": section, "label": label}


def find_target(content: dict, target_id: str):
    """Return (node, parent_list, parent_item, section) for an id, or None."""
    if target_id == "basics":
        return content["basics"], None, None, "basics"
    for profile in content["basics"].get("profiles", []):
        if profile["id"] == target_id:
            return profile, content["basics"]["profiles"], None, "basics"
    for section in ("work", "projects", "skills", "education", "certificates", "awards", "custom"):
        for item in content.get(section, []):
            if item["id"] == target_id:
                return item, content[section], None, section
            for key in ("highlights", "items"):
                for child in item.get(key, []):
                    if child["id"] == target_id:
                        return child, item[key], item, section
    return None


def apply_edit(content: dict, target_id: str, field: str, operation: str, text: str) -> dict:
    """Apply one targeted edit to a copy of the content and return the normalized result."""
    updated = copy.deepcopy(content)
    found = find_target(updated, target_id)
    if not found:
        raise ValueError("The resume item for this change no longer exists.")
    node, parent_list, parent_item, section = found
    if operation == "replace":
        if field in ("keywords", "courses"):
            node[field] = _keywords(text)
        elif field in node and field != "id":
            node[field] = text
        else:
            raise ValueError("This field cannot be edited.")
    elif operation == "insert_after":
        if parent_item is not None:
            index = parent_list.index(node) + 1
            parent_list.insert(index, {"id": new_id(ID_PREFIX["highlights"]), "text": text})
        elif section in ("work", "projects"):
            node.setdefault("highlights", []).append({"id": new_id(ID_PREFIX["highlights"]), "text": text})
        elif section == "custom":
            node.setdefault("items", []).append({"id": new_id(ID_PREFIX["items"]), "text": text})
        else:
            raise ValueError("A new line can only be added to experience, projects, or custom sections.")
    elif operation == "add_keyword":
        if section not in ("skills", "projects") or parent_item is not None:
            raise ValueError("Keywords can only be added to a skill group or project.")
        node["keywords"] = _keywords(node.get("keywords", []) + [text])
    else:
        raise ValueError("Unsupported edit operation.")
    return normalize(updated)


def field_text(content: dict, target_id: str, field: str) -> str | None:
    found = find_target(content, target_id)
    if not found:
        return None
    node = found[0]
    value = node.get(field)
    if isinstance(value, list):
        return ", ".join(value)
    return value if isinstance(value, str) else None


def section_has_content(content: dict, section: str) -> bool:
    if section == "summary":
        return bool(content["basics"].get("summary"))
    return bool(content.get(section))


def heading_order(content: dict) -> list:
    """Visible section headings in render order (custom sections use their own titles)."""
    titles = content["meta"]["section_titles"]
    headings = []
    for section in content["meta"]["section_order"]:
        if not section_has_content(content, section):
            continue
        if section == "custom":
            headings.extend(item["title"] for item in content["custom"] if item.get("title"))
        else:
            headings.append(titles[section])
    return headings


def expected_strings(content: dict) -> list:
    """User-entered text that a correct render must contain (dates excluded; templates format them)."""
    values = []
    basics = content["basics"]
    for field in ("name", "label", "email", "phone", "location", "summary"):
        if basics.get(field):
            values.append(basics[field])
    values.extend(heading_order(content))
    for section in ("work", "projects", "skills", "education", "certificates", "awards", "custom"):
        for item in content.get(section, []):
            for field in ITEM_FIELDS[section]:
                if field in URL_FIELDS or field in ("startDate", "endDate", "date"):
                    continue
                if item.get(field) and not (section == "custom" and field == "title"):
                    values.append(item[field])
            values.extend(item.get("keywords", []))
            values.extend(item.get("courses", []))
            values.extend(child["text"] for child in item.get("highlights", []) + item.get("items", []))
    return [value for value in values if value]


def diff(before: dict, after: dict) -> list:
    """Field-level changes between two resume contents, keyed by stable id."""
    old = {(item["target_id"], item["field"]): item for item in iter_items(before)}
    new = {(item["target_id"], item["field"]): item for item in iter_items(after)}
    changes = []
    for key, item in new.items():
        if key not in old:
            changes.append({"type": "added", "section": item["section"], "label": item["label"], "field": key[1], "before": "", "after": item["text"]})
        elif old[key]["text"] != item["text"]:
            changes.append({"type": "changed", "section": item["section"], "label": item["label"], "field": key[1], "before": old[key]["text"], "after": item["text"]})
    for key, item in old.items():
        if key not in new:
            changes.append({"type": "removed", "section": item["section"], "label": item["label"], "field": key[1], "before": item["text"], "after": ""})
    if before.get("meta", {}).get("section_order") != after.get("meta", {}).get("section_order"):
        changes.append({"type": "changed", "section": "layout", "label": "Section order", "field": "section_order",
                        "before": ", ".join(before.get("meta", {}).get("section_order", [])), "after": ", ".join(after["meta"]["section_order"])})
    return changes


def to_json_resume(content: dict) -> dict:
    """Export to standard JSON Resume (custom sections are not part of that schema and are omitted)."""
    basics = {key: value for key, value in content["basics"].items() if key != "profiles"}
    basics["location"] = {"address": content["basics"]["location"]} if content["basics"]["location"] else {}
    basics["profiles"] = [{"network": item["network"], "url": item["url"]} for item in content["basics"]["profiles"]]
    result = {"basics": basics}
    for section in ("work", "projects", "skills", "education", "certificates", "awards"):
        items = []
        for item in content[section]:
            exported = {key: value for key, value in item.items() if key != "id"}
            if "highlights" in exported:
                exported["highlights"] = [child["text"] for child in item["highlights"]]
            items.append(exported)
        result[section] = items
    result["meta"] = {"version": SCHEMA_ID}
    return result


def from_json_resume(data: dict) -> dict:
    basics = dict(data.get("basics") or {})
    location = basics.get("location")
    if isinstance(location, dict):
        basics["location"] = ", ".join(value for value in (location.get("city"), location.get("region"), location.get("countryCode")) if value) or location.get("address", "")
    return normalize({**data, "basics": basics}, strict=False, drop_empty=True)


_NUMBER = re.compile(r"(?<![\w.])[$€£₹]?\d[\d,]*(?:\.\d+)?\s?(?:%|x|k|m|b|\+)?(?![\w])", re.I)
_TERM = re.compile(r"(?<![\w])[A-Za-z][A-Za-z0-9]*(?:[+#.\-/][A-Za-z0-9+#]+)*[+#]*")
_COMMON = {"i", "a", "an", "the", "and", "or", "for", "with", "to", "of", "in", "on", "by", "as", "at"}


def _fold(value: str) -> str:
    return re.sub(r"\s+", " ", unicodedata.normalize("NFKC", value).lower())


_STOPWORDS = _COMMON | {
    "experience", "years", "year", "using", "use", "work", "working", "ability", "strong", "skills", "skill",
    "knowledge", "understanding", "including", "plus", "preferred", "required", "must", "have", "has", "be",
    "is", "are", "will", "you", "your", "our", "we", "team", "teams", "etc", "such", "within", "across", "other",
}


def requirement_terms(requirement: str) -> list:
    """Content words of a job requirement; reusing them in a bullet is a claim worth verifying."""
    words = re.findall(r"[A-Za-z][A-Za-z0-9+#.\-]{2,}", requirement or "")
    return list(dict.fromkeys(word.lower().strip(".-") for word in words if word.lower() not in _STOPWORDS))[:20]


def fact_guard(proposed: str, original: str, corpus: str, sensitive_terms=()) -> list:
    """Flag numbers and specific terms in a suggestion that the verified text does not contain.

    sensitive_terms are words from the job requirement a suggestion targets: adding one that the
    resume never mentioned (e.g. "performance") is a new claim even when it is a common word.
    The guard is deliberately conservative: it marks a suggestion for user verification,
    it never decides that a claim is true.
    """
    known = _fold(original + "\n" + corpus)
    known_compact = re.sub(r"[^a-z0-9+#%]", "", known)
    flags = []
    for match in _NUMBER.finditer(proposed):
        value = match.group(0).strip()
        digits = re.sub(r"[^\d.]", "", value)
        if digits and digits not in re.sub(r"[^\d. ]", " ", known).split() and value.lower() not in known:
            flags.append({"type": "number", "value": value})
    sentence_start = True
    for match in _TERM.finditer(proposed):
        token = match.group(0)
        before = proposed[:match.start()].rstrip()
        sentence_start = not before or before[-1] in ".!?:;•-–—("
        specific = (any(char in token for char in "+#./") and len(token) > 1) or re.search(r"\d", token) or \
            (token[0].isupper() and not sentence_start) or (len(token) > 1 and token.isupper())
        if not specific or token.lower() in _COMMON:
            continue
        folded = token.lower()
        if re.search(r"(?<![a-z0-9])" + re.escape(folded) + r"(?![a-z0-9])", known):
            continue
        if re.sub(r"[^a-z0-9+#%]", "", folded) and re.sub(r"[^a-z0-9+#%]", "", folded) in known_compact:
            continue
        flags.append({"type": "term", "value": token})
    proposed_folded = _fold(proposed)
    for term in sensitive_terms:
        stem = term if len(term) <= 6 else term[:7]  # crude stem: "optimization" ~ "optimized"
        pattern = r"(?<![a-z0-9])" + re.escape(stem)
        if re.search(pattern, proposed_folded) and not re.search(pattern, known):
            flags.append({"type": "requirement_term", "value": term})
    unique = []
    for flag in flags:
        if flag not in unique:
            unique.append(flag)
    return unique[:12]
