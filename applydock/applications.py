"""Captured jobs and hiring posts ("entries"): URL canonicalization, capture, editing rules, approval, stages."""
from __future__ import annotations

import datetime as dt
import ipaddress
import json
import re
import urllib.error
import urllib.parse
import urllib.request
import uuid

from . import ats, config, database, resumes, submissions


def public_https_url(value):
    parsed = urllib.parse.urlparse(str(value or ""))
    host = (parsed.hostname or "").lower()
    if parsed.scheme != "https" or not host or parsed.username or parsed.password:
        raise ValueError("Choose a public HTTPS job or hiring-post link.")
    if host == "localhost" or host.endswith((".localhost", ".local", ".internal", ".test", ".invalid")):
        raise ValueError("Local and private links cannot be captured.")
    try:
        ipaddress.ip_address(host)
    except ValueError:
        pass
    else:
        raise ValueError("IP-address links cannot be captured.")
    try:
        port = parsed.port
    except ValueError:
        raise ValueError("Invalid HTTPS port.") from None
    if port not in (None, 443):
        raise ValueError("Only standard HTTPS links can be captured.")
    if not parsed.path or parsed.path == "/":
        raise ValueError("Open a specific job or hiring post, not a site homepage.")
    return parsed, host


def platform_for_host(host):
    for domain, label in (
        ("linkedin.com", "Linkedin"), ("indeed.com", "Indeed"), ("indeed.co.in", "Indeed"),
        ("wellfound.com", "Wellfound"), ("naukri.com", "Naukri"),
        ("greenhouse.io", "Greenhouse"), ("lever.co", "Lever"),
        ("ashbyhq.com", "Ashby"), ("myworkdayjobs.com", "Workday")
    ):
        if host == domain or host.endswith("." + domain):
            return label
    return "Other"


def canonical_url(value, requested_kind="job"):
    parsed, host = public_https_url(value)
    path = parsed.path.rstrip("/") + "/"
    if host in ("linkedin.com", "www.linkedin.com"):
        job = re.search(r"/jobs/view/(\d+)", path)
        query = urllib.parse.parse_qs(parsed.query)
        if job or ("/jobs/" in path and query.get("currentJobId", [""])[0].isdigit()):
            number = job.group(1) if job else query["currentJobId"][0]
            return f"https://www.linkedin.com/jobs/view/{number}/", "job"
        if re.match(r"^/(feed/update/[^/]+|posts/[^/]+|pulse/[^/]+)/", path):
            return "https://www.linkedin.com" + path, "post"
        raise ValueError("Open a specific LinkedIn job or post. Feed and search pages cannot be saved.")
    if requested_kind not in ("job", "post"):
        raise ValueError("Choose job or hiring post.")
    query = urllib.parse.urlencode([
        (key, val) for key, val in urllib.parse.parse_qsl(parsed.query, keep_blank_values=True)
        if not (key.lower().startswith("utm_") or key.lower() in ("ref", "source", "trk", "fbclid", "gclid"))
    ])
    return urllib.parse.urlunsplit(("https", host, parsed.path.rstrip("/") or "/", query, "")), requested_kind


def get_entry(entry_id):
    with database.connect() as db:
        row = db.execute("SELECT * FROM entries WHERE id=?", (entry_id,)).fetchone()
    return public_entry(row) if row else None


def public_entry(row):
    entry = dict(row)
    try:
        emails = json.loads(entry["contact_emails"])
        entry["contact_emails"] = emails if isinstance(emails, list) else []
    except (TypeError, ValueError):
        entry["contact_emails"] = []
    resume = resumes.get_resume(entry.get("resume_id", ""), include_deleted=True)
    entry["resume"] = resume
    entry["resume_status"] = "Resume Selected" if resume and resume["available"] else "Resume Missing"
    entry["readiness_status"] = "Ready to Send" if (
        entry.get("apply_method") == "email" and resume and resume["available"] and
        all(entry.get(key) for key in ("recipient", "subject", "body"))
    ) else entry["resume_status"]
    entry["resume_version"] = None
    if resume and resume["available"]:
        with database.connect() as db:
            version = ats.effective_version(db, entry)
        if version:
            entry["resume_version"] = {
                "id": version["id"], "version_number": version["version_number"], "pinned": bool(entry.get("resume_version_id")),
                "is_current": version["id"] == resume.get("current_version_id"), "filename": version["original_filename"],
                "sha256": version["sha256"], "source": version["source"], "file_url": resumes.version_file_url(resume["id"], version),
            }
    with database.connect() as db:
        entry["submission"] = submissions.active_for_entry(db, entry["id"])
    entry["analysis"] = ats.analysis_summary(config.DB, entry)
    if entry["analysis"]["status"] == "not_analyzed" and resume and resume.get("extraction_status") == "limited":
        entry["analysis"] = {"status": "extraction_limited", "label": "Resume Extraction Limited", "stale": False,
                             "error": resume.get("extraction_error", "Upload a text-based PDF or DOCX.")}
    return entry


def entries():
    with database.connect() as db:
        return [public_entry(r) for r in db.execute("SELECT * FROM entries ORDER BY created_at DESC")]


DEFAULT_APPLICATION_STAGES = ["Initiated", "To apply", "No Answer", "Applied", "Offer", "Rejected"]


APPLICATION_STAGES_AFTER_APPLY = {"applied", "no answer", "offer", "rejected"}


def stage_is_after_apply(value):
    return str(value or "").strip().lower() in APPLICATION_STAGES_AFTER_APPLY


def application_stage_options():
    configured = config.SETTINGS.get("notion_mapping", {}).get("application_stage_options", [])
    values = list(configured)
    values.extend(DEFAULT_APPLICATION_STAGES)
    with database.connect() as db:
        values.extend(row[0] for row in db.execute("SELECT DISTINCT application_stage FROM entries WHERE application_stage<>'' ORDER BY application_stage COLLATE NOCASE"))
    result = []
    for value in values:
        value = str(value or "").strip()
        if value and value.lower() not in {item.lower() for item in result}:
            result.append(value)
    return result


def extract_emails(text):
    found = []
    for match in config.EMAIL_PATTERN.findall(str(text or "")):
        address = match.lower()
        if address not in found:
            found.append(address)
    return found[:30]


def contact_emails(value, *sources):
    values = value if isinstance(value, list) else [value]
    found = []
    for item in [*values, *sources]:
        for address in extract_emails(item):
            if address not in found:
                found.append(address)
    return found[:30]


def capture(data):
    url, kind = canonical_url(data.get("url"), data.get("kind") or "job")
    platform = platform_for_host(urllib.parse.urlparse(url).hostname or "")
    title = str(data.get("title") or ("Job opportunity" if kind == "job" else "Hiring post")).strip()[:300]
    company = str(data.get("company") or "").strip()[:300]
    excerpt = str(data.get("excerpt") or "").strip()[:8000]
    post_details = str(data.get("post_details") or "").strip()[:4000]
    emails = contact_emails(data.get("contact_emails") or [], excerpt, post_details)
    method = str(data.get("apply_method") or "unknown").strip().lower()
    if method not in ("unknown", "email", "external_form"):
        raise ValueError("Choose a valid application method.")
    apply_url = str(data.get("apply_url") or "").strip()
    if apply_url:
        public_https_url(apply_url)
    recipient = str(data.get("recipient") or "").strip()
    if kind == "post" and not recipient and emails:
        recipient = emails[0]
    if kind == "post" and method == "unknown" and recipient:
        method = "email"
    if recipient and not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", recipient):
        raise ValueError("Enter a valid recipient email.")
    emails = contact_emails(emails, recipient)
    resume_id = str(data.get("resume_id") or resumes.default_resume_id()).strip()
    selected_resume = resumes.get_resume(resume_id) if resume_id else None
    if resume_id and (not selected_resume or not selected_resume["available"]):
        raise ValueError("Selected resume is unavailable. Choose another resume.")
    if selected_resume and selected_resume["kind"] != "master":
        raise ValueError("A tailored resume belongs to another application. Choose a master resume.")
    needs_review = int(data.get("needs_review", True) is not False)
    with database.LOCK, database.connect() as db:
        existing = db.execute("SELECT id FROM entries WHERE url=?", (url,)).fetchone()
        if existing:
            return get_entry(existing["id"]), True
        entry_id = str(uuid.uuid4())
        stamp = config.now_iso()
        db.execute("""INSERT INTO entries(id,url,kind,title,company,excerpt,recipient,send_at,created_at,updated_at,
                    platform,apply_method,apply_url,needs_review,contact_emails,post_details,resume_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                   (entry_id, url, kind, title, company, excerpt, recipient, config.tomorrow_nine(), stamp, stamp,
                    platform, method, apply_url, needs_review, json.dumps(emails), post_details, resume_id))
    return get_entry(entry_id), False


def delete_local_entry(entry_id, notion_id=None):
    """Remove a local record only; this function never calls the Notion API."""
    with database.LOCK, database.connect() as db:
        if notion_id is None:
            return db.execute("DELETE FROM entries WHERE id=? AND status<>'sending'", (entry_id,)).rowcount
        return db.execute("DELETE FROM entries WHERE id=? AND notion_id=? AND status<>'sending'", (entry_id, notion_id)).rowcount


def update_entry(entry_id, data):
    entry = get_entry(entry_id)
    if not entry:
        raise ValueError("Entry not found.")
    requested = set(data).intersection({
        "title", "company", "excerpt", "post_details", "recipient", "subject", "body",
        "send_at", "resume_path", "resume_id", "resume_version_id", "apply_method", "apply_url", "application_stage",
        "contact_emails", "needs_review", "approved"
    })
    stage_only = "application_stage" in requested and requested <= {"application_stage"}
    if entry["status"] in ("sending", "sent"):
        raise ValueError("A sending or sent entry cannot be edited.")
    if entry["delivery_mode"] == "gmail_scheduled" and not stage_only:
        raise ValueError("This item was marked scheduled in Gmail. Only its application stage can be changed here.")
    fields = {k: str(data[k]).strip() for k in ("title", "company", "excerpt", "post_details", "recipient", "subject", "body", "send_at", "resume_path", "resume_id", "resume_version_id", "apply_method", "apply_url", "application_stage") if k in data}
    if "excerpt" in fields:
        fields["excerpt"] = fields["excerpt"][:8000]
    if "post_details" in fields:
        fields["post_details"] = fields["post_details"][:4000]
    if "application_stage" in fields:
        fields["application_stage"] = fields["application_stage"][:120]
    if "contact_emails" in data:
        fields["contact_emails"] = json.dumps(contact_emails(data["contact_emails"]))
    elif "excerpt" in fields or "post_details" in fields:
        fields["contact_emails"] = json.dumps(contact_emails(entry["contact_emails"], fields.get("excerpt", ""), fields.get("post_details", "")))
    if "needs_review" in data:
        fields["needs_review"] = int(bool(data["needs_review"]))
    if "application_stage" in fields and stage_is_after_apply(fields["application_stage"]):
        fields["needs_review"] = 0
    if "apply_method" in fields and fields["apply_method"] not in ("unknown", "email", "external_form"):
        raise ValueError("Choose a valid application method.")
    if entry["gmail_draft_id"] and fields.get("apply_method", "email") != "email":
        raise ValueError("This item already has a Gmail draft. Keep Email selected and manage that draft in Gmail.")
    if "apply_url" in fields and fields["apply_url"]:
        public_https_url(fields["apply_url"])
    if "title" in fields and not fields["title"]:
        raise ValueError("Title is required.")
    if "recipient" in fields and fields["recipient"] and not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", fields["recipient"]):
        raise ValueError("Enter a valid recipient email.")
    if "send_at" in fields:
        try: dt.datetime.fromisoformat(fields["send_at"]).astimezone(dt.timezone.utc)
        except Exception: raise ValueError("Invalid send time.") from None
    if "resume_id" in fields:
        selected = resumes.get_resume(fields["resume_id"], include_token=True) if fields["resume_id"] else None
        if fields["resume_id"] and (not selected or not selected["available"]):
            raise ValueError("Selected resume is unavailable. Choose another resume.")
        if selected and selected["kind"] == "tailored" and selected["entry_id"] != entry_id:
            raise ValueError("That tailored resume belongs to another application. Choose a master resume or tailor one for this job.")
        fields["resume_path"] = selected["stored_path"] if selected else ""
        if fields["resume_id"] != entry["resume_id"] and "resume_version_id" not in fields:
            fields["resume_version_id"] = ""  # a different resume never keeps another resume's pinned version
    elif "resume_path" in fields and fields["resume_path"]:
        with database.connect() as db:
            legacy = db.execute("SELECT id FROM resumes WHERE stored_path=? AND deleted_at=''", (fields["resume_path"],)).fetchone()
        fields["resume_id"] = legacy["id"] if legacy else resumes.register_legacy_resume(fields["resume_path"])
        fields["resume_version_id"] = ""
    if fields.get("resume_version_id"):
        with database.connect() as db:
            pinned = db.execute("SELECT * FROM resume_versions WHERE id=?", (fields["resume_version_id"],)).fetchone()
        if not pinned or pinned["resume_id"] != fields.get("resume_id", entry["resume_id"]):
            raise ValueError("That resume version does not belong to the selected resume.")
        with database.connect() as db:
            document = db.execute("SELECT stored_path FROM resume_documents WHERE id=?", (pinned["document_id"],)).fetchone()
        fields["resume_path"] = document["stored_path"] if document else fields.get("resume_path", entry["resume_path"])
    merged = {**entry, **fields}
    approval_sensitive = {
        "title", "company", "excerpt", "post_details", "recipient", "subject", "body",
        "send_at", "resume_path", "resume_id", "resume_version_id", "apply_method", "apply_url", "contact_emails", "needs_review"
    }
    if entry["status"] == "approved" and any(
        key in approval_sensitive and
        (json.dumps(entry[key]) if key == "contact_emails" else str(entry[key])) != str(value)
        for key, value in fields.items()
    ):
        fields["status"] = "draft"
    if entry["gmail_draft_id"] and any(key in fields and str(entry[key]) != str(fields[key]) for key in ("recipient", "subject", "body", "resume_path", "resume_id", "resume_version_id", "apply_method")):
        fields["gmail_dirty"] = 1
    if data.get("approved") is True:
        if entry["gmail_draft_id"]:
            raise ValueError("This item has a Gmail draft. Check Gmail before using the local sender.")
        if merged["apply_method"] != "email":
            raise ValueError("Only email applications can be scheduled. Choose Email as the application method.")
        if not all(merged[k] for k in ("recipient", "subject", "body", "send_at", "resume_id")):
            raise ValueError("Recipient, subject, body, send time, and resume are required before approval.")
        _, _, approved_version = resumes.resume_file_for_entry(merged)
        fields["resume_version_id"] = approved_version["id"]  # approval locks the exact file that will be sent
        if not config.SETTINGS.get("smtp_verified"):
            raise ValueError("Verify an email account before approval.")
        send_time = dt.datetime.fromisoformat(merged["send_at"])
        if send_time.tzinfo is None:
            raise ValueError("Send time must include a timezone.")
        local_send = send_time.astimezone()
        if (local_send.hour, local_send.minute) != (9, 0):
            raise ValueError("Choose 9:00 AM in this computer's local timezone.")
        if send_time <= dt.datetime.now(dt.timezone.utc):
            raise ValueError("Choose a future 9:00 AM send time.")
        fields["status"] = "approved"
        fields["send_error"] = ""
    elif data.get("approved") is False:
        fields["status"] = "draft"
    if not fields:
        return entry
    fields["updated_at"] = config.now_iso()
    with database.LOCK, database.connect() as db:
        assignments = ",".join(f"{key}=?" for key in fields)
        changed = db.execute(f"UPDATE entries SET {assignments} WHERE id=?", (*fields.values(), entry_id)).rowcount
        if not changed:
            raise ValueError("This item was removed from ApplyDock. Refresh the list.")
    return get_entry(entry_id)
