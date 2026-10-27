"""Resume library: upload validation, versions, current/pinned file selection, access links, and deletion."""
from __future__ import annotations

from pathlib import Path
import base64
import hashlib
import html
import io
import secrets
import urllib.error
import urllib.parse
import urllib.request
import uuid
import xml.etree.ElementTree as ET
import zipfile

from . import ats, config, database, events, resume_store, submissions


def resume_file_url(resume):
    if not resume or not resume.get("access_token"):
        return ""
    return f"http://{config.HOST}:{config.PORT}/api/resumes/{resume['id']}/file?access={urllib.parse.quote(resume['access_token'])}"


def version_file_url(resume_id, version):
    """Stable link to one exact version (its token never rotates, unlike the 'current file' link)."""
    if not version or not version["access_token"]:
        return ""
    return f"http://{config.HOST}:{config.PORT}/api/resumes/{resume_id}/versions/{version['id']}/file?access={urllib.parse.quote(version['access_token'])}"


def public_resume(row, include_token=False):
    if not row:
        return None
    resume = dict(row)
    path = (config.DATA / resume["stored_path"]).resolve()
    available = not resume["deleted_at"] and path.is_relative_to((config.DATA / "resumes").resolve()) and path.is_file()
    with database.connect() as db:
        version = ats.current_version(db, resume["id"])
        version_count = db.execute("SELECT COUNT(*) FROM resume_versions WHERE resume_id=?", (resume["id"],)).fetchone()[0]
        analysis_count = db.execute("""SELECT COUNT(*) FROM analysis_runs ar JOIN resume_versions rv ON rv.id=ar.resume_version_id
                                       WHERE rv.resume_id=?""", (resume["id"],)).fetchone()[0]
        has_draft = bool(db.execute("SELECT 1 FROM resume_drafts WHERE resume_id=?", (resume["id"],)).fetchone())
        submission_count = db.execute("SELECT COUNT(*) FROM application_submissions WHERE resume_id=? AND active=1", (resume["id"],)).fetchone()[0]
    result = {
        "id": resume["id"], "name": resume["name"], "category": resume["category"],
        "original_filename": resume["original_filename"], "mime_type": resume["mime_type"],
        "size_bytes": resume["size_bytes"], "is_default": bool(resume["is_default"]),
        "available": available, "created_at": resume["created_at"], "updated_at": resume["updated_at"],
        "file_url": resume_file_url(resume) if available else "",
        "preview_url": (resume_file_url(resume) + ("&preview=1" if resume["mime_type"].endswith("wordprocessingml.document") else "")) if available else "",
        "version_count": version_count,
        "analysis_count": analysis_count,
        "current_version_id": resume.get("current_version_id", ""),
        "current_version_number": version["version_number"] if version else 0,
        "current_version_source": version["source"] if version else "",
        "extraction_status": version["extraction_status"] if version else "missing",
        "extraction_error": version["extraction_error"] if version else "Resume version is unavailable.",
        "parse_status": version["parse_status"] if version else "not_parsed",
        "kind": resume.get("kind") or "master",
        "parent_resume_id": resume.get("parent_resume_id", ""),
        "entry_id": resume.get("entry_id", ""),
        "has_draft": has_draft,
        "submission_count": submission_count,
    }
    if include_token:
        result["access_token"] = resume["access_token"]
        result["stored_path"] = resume["stored_path"]
        result["deleted_at"] = resume["deleted_at"]
    return result


def get_resume(resume_id, include_deleted=False, include_token=False):
    if not resume_id:
        return None
    with database.connect() as db:
        row = db.execute("SELECT * FROM resumes WHERE id=?" + ("" if include_deleted else " AND deleted_at=''"), (resume_id,)).fetchone()
    return public_resume(row, include_token=include_token)


def resumes():
    with database.connect() as db:
        rows = list(db.execute("SELECT * FROM resumes WHERE deleted_at='' ORDER BY is_default DESC,category COLLATE NOCASE,name COLLATE NOCASE"))
    return [public_resume(row) for row in rows]


def default_resume_id():
    with database.connect() as db:
        row = db.execute("SELECT id FROM resumes WHERE deleted_at='' AND is_default=1 AND kind='master' LIMIT 1").fetchone()
    if not row:
        return ""
    resume = get_resume(row["id"])
    return row["id"] if resume and resume["available"] else ""


def validate_resume_file(name, content):
    filename = Path(str(name or "")).name[:180]
    extension = Path(filename).suffix.lower()
    if extension not in (".pdf", ".docx"):
        raise ValueError("Resume must be PDF or DOCX.")
    try:
        raw = base64.b64decode(content, validate=True)
    except Exception:
        raise ValueError("Invalid resume data.") from None
    if not raw or len(raw) > config.MAX_RESUME_BYTES:
        raise ValueError("Resume must be under 8 MB.")
    if extension == ".pdf" and not raw.startswith(b"%PDF-"):
        raise ValueError("The selected file is not a valid PDF.")
    if extension == ".docx":
        try:
            with zipfile.ZipFile(io.BytesIO(raw)) as archive:
                if "[Content_Types].xml" not in archive.namelist() or "word/document.xml" not in archive.namelist():
                    raise ValueError
        except (ValueError, zipfile.BadZipFile, KeyError):
            raise ValueError("The selected file is not a valid DOCX.") from None
    mime = "application/pdf" if extension == ".pdf" else "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    return filename, extension, mime, raw


def docx_preview(raw, filename):
    try:
        with zipfile.ZipFile(io.BytesIO(raw)) as archive:
            root = ET.fromstring(archive.read("word/document.xml"))
    except (ValueError, zipfile.BadZipFile, KeyError, ET.ParseError):
        raise ValueError("This DOCX file cannot be previewed.") from None
    namespace = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
    paragraphs = []
    for paragraph in root.iter(namespace + "p"):
        text = "".join(node.text or "" for node in paragraph.iter(namespace + "t")).strip()
        if text:
            paragraphs.append(f"<p>{html.escape(text)}</p>")
    body = "".join(paragraphs) or "<p class='empty'>This document has no previewable text.</p>"
    return ("<!doctype html><html><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'>"
            f"<title>{html.escape(filename)}</title><style>body{{margin:0;background:#f3f5f4;color:#1b292f;font:15px/1.65 Segoe UI,system-ui,sans-serif}}"
            ".page{max-width:760px;min-height:960px;margin:28px auto;padding:68px 76px;background:#fff;box-shadow:0 12px 35px #23343a18}"
            "h1{margin:0 0 28px;padding-bottom:16px;border-bottom:1px solid #dce4e3;font-size:18px;overflow-wrap:anywhere}"
            "p{margin:0 0 12px;white-space:pre-wrap;overflow-wrap:anywhere}.empty{color:#68777e}@media(max-width:700px){.page{margin:0;padding:30px 22px;min-height:100vh}}"
            f"</style></head><body><main class='page'><h1>{html.escape(filename)}</h1>{body}</main></body></html>").encode("utf-8")


def create_resume(data):
    filename, extension, mime, raw = validate_resume_file(data.get("filename") or data.get("name"), data.get("content", ""))
    name = str(data.get("display_name") or Path(filename).stem).strip()[:120]
    category = str(data.get("category") or "Uncategorized").strip()[:80]
    if not name:
        raise ValueError("Resume name is required.")
    resume_id = str(uuid.uuid4())
    stamp = config.now_iso()
    with database.LOCK, database.connect() as db:
        make_default = bool(data.get("is_default")) or db.execute("SELECT COUNT(*) FROM resumes WHERE deleted_at='' AND is_default=1").fetchone()[0] == 0
        if make_default:
            db.execute("UPDATE resumes SET is_default=0")
        db.execute("""INSERT INTO resumes(id,name,category,stored_path,original_filename,mime_type,size_bytes,access_token,is_default,created_at,updated_at)
                      VALUES(?,?,?,?,?,?,?,?,?,?,?)""",
                   (resume_id, name, category or "Uncategorized", "", filename, mime, len(raw), secrets.token_urlsafe(32), int(make_default), stamp, stamp))
        version, document, _ = ats.add_resume_version(db, config.DATA, resume_id, filename, extension, mime, raw)
        db.execute("UPDATE resumes SET current_version_id=?,stored_path=?,size_bytes=? WHERE id=?",
                   (version["id"], document["stored_path"], document["size_bytes"], resume_id))
    return get_resume(resume_id)


def register_legacy_resume(relative):
    path = (config.DATA / relative).resolve()
    if not path.is_relative_to((config.DATA / "resumes").resolve()) or not path.is_file() or path.suffix.lower() not in (".pdf", ".docx"):
        raise ValueError("Invalid or missing resume file.")
    filename = path.name.split("_", 1)[-1] if "_" in path.name else path.name
    resume_id = str(uuid.uuid4())
    mime = "application/pdf" if path.suffix.lower() == ".pdf" else "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    stamp = config.now_iso()
    with database.LOCK, database.connect() as db:
        make_default = db.execute("SELECT COUNT(*) FROM resumes WHERE deleted_at='' AND is_default=1").fetchone()[0] == 0
        db.execute("""INSERT INTO resumes(id,name,category,stored_path,original_filename,mime_type,size_bytes,access_token,is_default,created_at,updated_at)
                      VALUES(?,?,?,?,?,?,?,?,?,?,?)""",
                   (resume_id, Path(filename).stem[:120] or "Resume", "Uncategorized", relative, filename[:180], mime,
                    path.stat().st_size, secrets.token_urlsafe(32), int(make_default), stamp, stamp))
        version, document, _ = ats.add_resume_version(db, config.DATA, resume_id, filename[:180], path.suffix.lower(), mime, path.read_bytes())
        db.execute("UPDATE resumes SET current_version_id=?,stored_path=?,size_bytes=? WHERE id=?",
                   (version["id"], document["stored_path"], document["size_bytes"], resume_id))
    return resume_id


def update_resume(resume_id, data):
    existing = get_resume(resume_id, include_deleted=False, include_token=True)
    if not existing:
        raise ValueError("Resume not found.")
    fields = {}
    if "name" in data:
        name = str(data["name"]).strip()[:120]
        if not name:
            raise ValueError("Resume name is required.")
        fields["name"] = name
    if "category" in data:
        fields["category"] = str(data["category"]).strip()[:80] or "Uncategorized"
    replacement = None
    if data.get("content") is not None:
        ensure_not_sending(resume_id, "Replace it")
        replacement = validate_resume_file(data.get("filename"), data.get("content", ""))
    make_default = data.get("is_default")
    if make_default is True and existing["kind"] != "master":
        raise ValueError("A tailored resume belongs to one application and cannot be the default.")
    with database.LOCK, database.connect() as db:
        if make_default is True:
            db.execute("UPDATE resumes SET is_default=0")
            fields["is_default"] = 1
        elif make_default is False:
            fields["is_default"] = 0
        file_replaced = False
        if fields:
            fields["updated_at"] = config.now_iso()
            assignments = ",".join(f"{key}=?" for key in fields)
            db.execute(f"UPDATE resumes SET {assignments} WHERE id=? AND deleted_at=''", (*fields.values(), resume_id))
        if replacement:
            filename, extension, mime, raw = replacement
            version, document, _ = ats.add_resume_version(db, config.DATA, resume_id, filename, extension, mime, raw)
            file_replaced = activate_version(db, resume_id, version, document)
    after_current_changed(resume_id, file_replaced)
    return get_resume(resume_id)


def activate_version(db, resume_id, version, document):
    """Make a version the resume's current file. Returns True when the current file changed.

    The 'current file' access token rotates so old current-file links stop working; links to
    an exact version keep their own token.
    """
    current = db.execute("SELECT current_version_id FROM resumes WHERE id=?", (resume_id,)).fetchone()
    changed = not current or current["current_version_id"] != version["id"]
    if changed:
        db.execute("""UPDATE resumes SET current_version_id=?,stored_path=?,original_filename=?,mime_type=?,size_bytes=?,
                      access_token=?,updated_at=? WHERE id=?""",
                   (version["id"], document["stored_path"], version["original_filename"], document["mime_type"],
                    document["size_bytes"], secrets.token_urlsafe(32), config.now_iso(), resume_id))
    return changed


def linked_entry_ids(resume_id, *, unpinned_only=False):
    query = "SELECT id FROM entries WHERE resume_id=?" + (" AND resume_version_id=''" if unpinned_only else "") + " ORDER BY created_at DESC"
    with database.connect() as db:
        return [row["id"] for row in db.execute(query, (resume_id,))]


def after_current_changed(resume_id, file_changed):
    """Applications that follow the resume's current file go back to draft; pinned ones keep their exact file."""
    unpinned = set(linked_entry_ids(resume_id, unpinned_only=True))
    for entry_id in linked_entry_ids(resume_id):
        if file_changed and entry_id in unpinned:
            with database.connect() as db:
                db.execute("""UPDATE entries SET resume_path=(SELECT stored_path FROM resumes WHERE id=?),
                              status=CASE WHEN status='approved' THEN 'draft' ELSE status END,
                              gmail_dirty=CASE WHEN gmail_draft_id<>'' THEN 1 ELSE gmail_dirty END,updated_at=? WHERE id=?""",
                           (resume_id, config.now_iso(), entry_id))
        events.application_changed(entry_id)


def ensure_not_sending(resume_id, action):
    with database.connect() as db:
        sending = db.execute("SELECT COUNT(*) FROM entries WHERE resume_id=? AND status='sending'", (resume_id,)).fetchone()[0]
    if sending:
        raise ValueError(f"This resume is attached to an email currently sending. {action} after the send finishes.")


def restore_version(resume_id, version_id):
    """Make an earlier version current again. No version is copied or deleted."""
    if not get_resume(resume_id):
        raise ValueError("Resume not found.")
    ensure_not_sending(resume_id, "Restore it")
    with database.LOCK, database.connect() as db:
        version = db.execute("SELECT * FROM resume_versions WHERE id=? AND resume_id=?", (version_id, resume_id)).fetchone()
        if not version:
            raise ValueError("Version not found.")
        document = db.execute("SELECT * FROM resume_documents WHERE id=?", (version["document_id"],)).fetchone()
        if not document or not (config.DATA / document["stored_path"]).is_file():
            raise ValueError("That version's file is unavailable.")
        changed = activate_version(db, resume_id, dict(version), dict(document))
    after_current_changed(resume_id, changed)
    return get_resume(resume_id)


def delete_resume(resume_id):
    existing = get_resume(resume_id, include_deleted=False, include_token=True)
    if not existing:
        raise ValueError("Resume not found.")
    with database.connect() as db:
        sending = db.execute("SELECT COUNT(*) FROM entries WHERE resume_id=? AND status='sending'", (resume_id,)).fetchone()[0]
    if sending:
        raise ValueError("This resume is attached to an email currently sending. Try again after it finishes.")
    with database.LOCK, database.connect() as db:
        db.execute("UPDATE resumes SET deleted_at=?,is_default=0,updated_at=? WHERE id=? AND deleted_at=''", (config.now_iso(), config.now_iso(), resume_id))
        if existing["is_default"]:
            replacement = db.execute("SELECT id FROM resumes WHERE deleted_at='' AND kind='master' ORDER BY created_at LIMIT 1").fetchone()
            if replacement:
                db.execute("UPDATE resumes SET is_default=1,updated_at=? WHERE id=?", (config.now_iso(), replacement["id"]))
        resume_store.purge(db, resume_id, config.DATA)
        ats.purge_resume(db, config.DATA, resume_id, submissions.kept_document_ids(db))
    affected = linked_entry_ids(resume_id)
    for entry_id in affected:
        with database.connect() as db:
            db.execute("UPDATE entries SET resume_version_id='',status=CASE WHEN status='approved' THEN 'draft' ELSE status END,gmail_dirty=CASE WHEN gmail_draft_id<>'' THEN 1 ELSE gmail_dirty END,updated_at=? WHERE id=?", (config.now_iso(), entry_id))
        events.application_changed(entry_id)
    return len(affected)


def resume_file_for_entry(entry):
    """The exact file an application attaches: (resume, path, version). Honors a pinned version."""
    resume = get_resume(entry.get("resume_id", ""), include_deleted=False, include_token=True)
    if not resume or not resume["available"]:
        raise ValueError("Resume missing. Select an available resume before continuing.")
    with database.connect() as db:
        version = ats.effective_version(db, entry)
        if entry.get("resume_version_id") and (not version or version["id"] != entry["resume_version_id"]):
            raise ValueError("The resume version selected for this application is unavailable. Select the resume again.")
    if not version:
        raise ValueError("Resume missing. Select an available resume before continuing.")
    path = (config.DATA / version["stored_path"]).resolve()
    if not path.is_relative_to((config.DATA / "resumes").resolve()) or not path.is_file():
        raise ValueError("Resume missing. Select an available resume before continuing.")
    return resume, path, dict(version)


def attachment_bytes(path, version):
    """Read the attachment and confirm it is byte-for-byte the stored version."""
    raw = path.read_bytes()
    if hashlib.sha256(raw).hexdigest() != version["sha256"]:
        raise ValueError("The resume file on disk does not match its saved version. Select or regenerate the resume.")
    return raw


def attachment_record(version):
    return {"attachment_sha256": version["sha256"], "attachment_filename": version["original_filename"], "attached_at": config.now_iso()}
