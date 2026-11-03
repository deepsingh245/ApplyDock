"""HR contact and WhatsApp outreach helpers.

This keeps the assisted-sending workflow local-first: ApplyDock prepares the message,
stores the contact, schedules it, and opens the conversation at the due time without
claiming the message was sent automatically.
"""
from __future__ import annotations

import csv
import datetime as dt
import io
import json
import re
import uuid

from . import database, resumes

CONTACT_STATUSES = [
    "Not Sent",
    "Mailed/Messaged",
    "Application Sent",
    "Reached / In Discussion",
    "Scheduled",
    "On Hold",
    "Rejected",
    "No Response",
    "New",
    "Interested",
    "Contacted",
    "Replied",
    "Follow-up required",
    "Not interested",
    "Do not contact",
]

SCHEDULE_STATUS = ["pending", "ready", "sent", "skipped", "failed"]
SCHEDULE_RESULTS = ["pending", "sent", "skipped", "failed"]


def _now_iso():
    return dt.datetime.now(dt.timezone.utc).isoformat()


def normalize_phone(value):
    text = str(value or "").strip()
    if not text:
        raise ValueError("WhatsApp phone number is required.")
    text = text.replace("tel:", "", 1).strip()
    if re.search(r"\d(?:\.\d+)?e\+?\d+", text, re.I):
        raise ValueError("Phone looks like scientific notation (a spreadsheet mangled it). Format the column as text and re-export.")
    # Sheets often hold several numbers in one cell ("98765 43210 / 91234 56789"); use the first.
    text = re.split(r"\s*(?:/|;|,|\bor\b|\n)\s*", text, maxsplit=1)[0]
    international = text.lstrip().startswith("+") or text.lstrip().startswith("00")
    digits = "".join(ch for ch in text if ch.isdigit())
    if text.lstrip().startswith("00"):
        digits = digits[2:]
    if not digits:
        raise ValueError("Enter a valid WhatsApp number with country code.")
    if not international:
        digits = digits.lstrip("0") if len(digits) == 11 and digits.startswith("0") else digits
        # A bare 10-digit mobile number is assumed to be Indian (the app's default timezone).
        if len(digits) == 10 and digits[0] in "6789":
            digits = "91" + digits
    if len(digits) < 10 or len(digits) > 15:
        raise ValueError("Enter a valid WhatsApp number with country code.")
    return "+" + digits


def _coerce_bool(value):
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    return str(value or "").strip().lower() in {"1", "true", "yes", "y", "on"}


def _status_label(value):
    value = str(value or "").strip()
    return value if value else "New"


def normalize_contact_status(value):
    status = str(value or "").strip()
    if not status:
        return "Not Sent"
    aliases = {
        "not sent": "Not Sent",
        "not_sent": "Not Sent",
        "not contacted": "New",
        "not_contacted": "New",
        "new": "New",
        "mailed messaged": "Mailed/Messaged",
        "mailed": "Mailed/Messaged",
        "messaged": "Mailed/Messaged",
        "application sent": "Application Sent",
        "reached in discussion": "Reached / In Discussion",
        "scheduled": "Scheduled",
        "on hold": "On Hold",
        "rejected": "Rejected",
        "no response": "No Response",
        "contacted": "Contacted",
        "sent": "Contacted",
        "replied": "Replied",
        "follow up required": "Follow-up required",
        "follow up": "Follow-up required",
        "follow-up required": "Follow-up required",
        "follow-up": "Follow-up required",
        "not interested": "Not interested",
        "not_interested": "Not interested",
        "do not contact": "Do not contact",
        "do_not_contact": "Do not contact",
    }
    normalized = re.sub(r"[^a-z0-9]+", " ", status.lower()).strip()
    return aliases.get(normalized, status)


def _call(db, query, params=()):
    return db.execute(query, params)


def _public_contact(row):
    if not row:
        return None
    item = dict(row)
    item["consent"] = bool(item.get("consent", 0))
    item["status"] = _status_label(item.get("status"))
    if not item.get("phone"):
        item["phone"] = item.get("phone_e164", "")
    return item


def _public_template(row):
    if not row:
        return None
    item = dict(row)
    item["variables"] = json.loads(item.get("variables", "[]")) if item.get("variables") else []
    return item


def _public_schedule(row, contact=None, template=None, resume=None):
    if not row:
        return None
    item = dict(row)
    item["status"] = str(item.get("status") or "pending")
    item["result"] = str(item.get("result") or "pending")
    item["contact"] = contact or {}
    item["template"] = template or {}
    item["resume"] = resume or {}
    return item


def init_schema(db):
    db.execute("""CREATE TABLE IF NOT EXISTS outreach_contacts (
        id TEXT PRIMARY KEY,
        full_name TEXT NOT NULL DEFAULT '',
        phone TEXT NOT NULL DEFAULT '',
        company TEXT NOT NULL DEFAULT '',
        designation TEXT NOT NULL DEFAULT '',
        email TEXT NOT NULL DEFAULT '',
        linkedin_url TEXT NOT NULL DEFAULT '',
        job_title TEXT NOT NULL DEFAULT '',
        job_description TEXT NOT NULL DEFAULT '',
        source TEXT NOT NULL DEFAULT '',
        notes TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'New',
        contact_permission TEXT NOT NULL DEFAULT '',
        consent INTEGER NOT NULL DEFAULT 0,
        last_contacted_at TEXT NOT NULL DEFAULT '',
        follow_up_at TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        communication_history TEXT NOT NULL DEFAULT '[]'
    )""")
    db.execute("CREATE UNIQUE INDEX IF NOT EXISTS outreach_contacts_phone ON outreach_contacts(phone)")
    db.execute("CREATE INDEX IF NOT EXISTS outreach_contacts_status ON outreach_contacts(status, updated_at DESC)")

    db.execute("""CREATE TABLE IF NOT EXISTS outreach_templates (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        body TEXT NOT NULL DEFAULT '',
        variables TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    )""")
    db.execute("CREATE INDEX IF NOT EXISTS outreach_templates_name ON outreach_templates(name COLLATE NOCASE)")

    db.execute("""CREATE TABLE IF NOT EXISTS outreach_schedules (
        id TEXT PRIMARY KEY,
        contact_id TEXT NOT NULL,
        template_id TEXT NOT NULL,
        resume_id TEXT NOT NULL DEFAULT '',
        message TEXT NOT NULL DEFAULT '',
        send_at TEXT NOT NULL DEFAULT '',
        time_window_start TEXT NOT NULL DEFAULT '',
        time_window_end TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'pending',
        result TEXT NOT NULL DEFAULT 'pending',
        notes TEXT NOT NULL DEFAULT '',
        opened_at TEXT NOT NULL DEFAULT '',
        sent_at TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(contact_id) REFERENCES outreach_contacts(id),
        FOREIGN KEY(template_id) REFERENCES outreach_templates(id)
    )""")
    db.execute("CREATE INDEX IF NOT EXISTS outreach_schedules_contact ON outreach_schedules(contact_id, send_at)")
    db.execute("CREATE INDEX IF NOT EXISTS outreach_schedules_status ON outreach_schedules(status, send_at)")


def list_contacts(db=None):
    if db is None:
        with database.connect() as db:
            return [
                _public_contact(row) for row in db.execute("SELECT * FROM outreach_contacts ORDER BY created_at DESC")
            ]
    return [_public_contact(row) for row in db.execute("SELECT * FROM outreach_contacts ORDER BY created_at DESC")]


def get_contact(contact_id, db=None):
    if db is None:
        with database.connect() as db:
            row = db.execute("SELECT * FROM outreach_contacts WHERE id=?", (contact_id,)).fetchone()
            return _public_contact(row)
    row = db.execute("SELECT * FROM outreach_contacts WHERE id=?", (contact_id,)).fetchone()
    return _public_contact(row)


def _validate_contact_payload(data):
    payload = dict(data or {})
    full_name = str(payload.get("full_name") or payload.get("name") or "").strip()
    company = str(payload.get("company") or "").strip()
    phone = normalize_phone(payload.get("phone") or payload.get("phone_number") or payload.get("whatsapp") or "")
    status = normalize_contact_status(payload.get("status") or "Not Sent")
    if status not in CONTACT_STATUSES:
        raise ValueError("Choose a valid contact status.")
    if not full_name:
        raise ValueError("Contact name is required.")
    if not company:
        raise ValueError("Company name is required.")
    email = str(payload.get("email") or "").strip()
    if email and "@" not in email:
        raise ValueError("Enter a valid email address.")
    linkedin = str(payload.get("linkedin_url") or "").strip()
    if linkedin and not linkedin.startswith(("http://", "https://")):
        raise ValueError("LinkedIn URL must start with http:// or https://.")
    notes = str(payload.get("notes") or "").strip()[:4000]
    communication_history = payload.get("communication_history")
    if communication_history is None:
        communication_history = []
    try:
        parsed = json.loads(communication_history) if isinstance(communication_history, str) else communication_history
        if not isinstance(parsed, list):
            parsed = [parsed]
        communication_history = json.dumps(parsed, ensure_ascii=False)
    except (TypeError, ValueError):
        communication_history = json.dumps([str(communication_history or "")], ensure_ascii=False)
    consent = _coerce_bool(payload.get("consent"))
    allowed = {"name": full_name, "full_name": full_name, "phone": phone, "phone_number": phone, "company": company,
               "designation": str(payload.get("designation") or payload.get("hr_designation") or "").strip()[:200],
               "email": email, "linkedin_url": linkedin, "job_title": str(payload.get("job_title") or "").strip()[:200],
               "job_description": str(payload.get("job_description") or "").strip()[:4000],
               "source": str(payload.get("source") or "").strip()[:200], "notes": notes,
               "status": status, "contact_permission": str(payload.get("contact_permission") or ("yes" if consent else "no")).strip()[:200],
               "consent": int(consent), "communication_history": communication_history}
    return allowed


def create_contact(data):
    payload = _validate_contact_payload(data)
    if payload["status"] == "Do not contact":
        payload["status"] = "Do not contact"
    with database.LOCK, database.connect() as db:
        existing = db.execute(
            "SELECT id FROM outreach_contacts WHERE phone=? OR (? != '' AND email=?)",
            (payload["phone"], payload["email"], payload["email"]),
        ).fetchone()
        if existing:
            raise ValueError("A contact with the same phone or email already exists.")
        contact_id = str(uuid.uuid4())
        stamp = _now_iso()
        db.execute("""INSERT INTO outreach_contacts(
            id, full_name, phone, company, designation, email, linkedin_url, job_title, job_description,
            source, notes, status, contact_permission, consent, created_at, updated_at, communication_history
        ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                   (contact_id, payload["name"], payload["phone"], payload["company"], payload["designation"], payload["email"],
                    payload["linkedin_url"], payload["job_title"], payload["job_description"], payload["source"], payload["notes"],
                    payload["status"], payload["contact_permission"], payload["consent"], stamp, stamp, payload["communication_history"]))
    return get_contact(contact_id)


def update_contact(contact_id, data):
    contact = get_contact(contact_id)
    if not contact:
        raise ValueError("Contact not found.")
    payload = _validate_contact_payload({**contact, **(data or {})})
    if payload["status"] == "Do not contact":
        payload["status"] = "Do not contact"
    with database.LOCK, database.connect() as db:
        duplicate = db.execute(
            "SELECT id FROM outreach_contacts WHERE (phone=? OR (? != '' AND email=?)) AND id<>?",
            (payload["phone"], payload["email"], payload["email"], contact_id),
        ).fetchone()
        if duplicate:
            raise ValueError("Another contact already uses this phone or email.")
        db.execute("""UPDATE outreach_contacts SET
            full_name=?, phone=?, company=?, designation=?, email=?, linkedin_url=?, job_title=?, job_description=?,
            source=?, notes=?, status=?, contact_permission=?, consent=?, updated_at=?, communication_history=?
            WHERE id=?""",
                   (payload["name"], payload["phone"], payload["company"], payload["designation"], payload["email"],
                    payload["linkedin_url"], payload["job_title"], payload["job_description"], payload["source"], payload["notes"],
                    payload["status"], payload["contact_permission"], payload["consent"], _now_iso(), payload["communication_history"], contact_id))
    return get_contact(contact_id)


def delete_contact(contact_id):
    with database.LOCK, database.connect() as db:
        rows = db.execute("DELETE FROM outreach_contacts WHERE id=?", (contact_id,)).rowcount
    return rows


def import_contacts_csv(csv_text):
    text = str(csv_text or "").lstrip("\ufeff").strip()
    if not text:
        print("[ApplyDock outreach import] rejected: empty input", flush=True)
        raise ValueError("No contact rows were found to import.")
    print(f"[ApplyDock outreach import] received chars={len(text)}", flush=True)
    # Count delimiters on the first line instead of csv.Sniffer, which misreads sheets whose notes contain commas.
    first_line = next((line for line in text.splitlines() if line.strip()), "")
    delimiter = "\t" if "\t" in first_line else max((",", ";"), key=first_line.count)
    delimiter_name = {",": "comma", "\t": "tab", ";": "semicolon"}[delimiter]
    rows = [row for row in csv.reader(io.StringIO(text), delimiter=delimiter) if any(value.strip() for value in row)]
    if not rows:
        print("[ApplyDock outreach import] rejected: no non-empty rows after parsing", flush=True)
        raise ValueError("No contact rows were found to import.")

    def normalize_column(value):
        return re.sub(r"[^a-z0-9]+", "_", str(value or "").strip().lower()).strip("_")

    mapping = {
        "name": "full_name",
        "full_name": "full_name",
        "contact_name": "full_name",
        "contact_person": "full_name",
        "recruiter": "full_name",
        "recruiter_name": "full_name",
        "recruiter_contact": "full_name",
        "recruiter_contact_name": "full_name",
        "contact": "full_name",
        "hr_contact": "full_name",
        "phone": "phone",
        "phone_number": "phone",
        "mobile": "phone",
        "mobile_number": "phone",
        "whatsapp": "phone",
        "company": "company",
        "company_name": "company",
        "designation": "designation",
        "hr_designation": "designation",
        "email": "email",
        "linkedin": "linkedin_url",
        "linkedin_url": "linkedin_url",
        "job_title": "job_title",
        "job_description": "job_description",
        "source": "source",
        "notes": "notes",
        "status": "status",
        "contact_status": "status",
        "consent": "consent",
    }
    headers = [str(value or "").strip() for value in rows[0]]
    normalized_headers = [normalize_column(value) for value in headers]
    has_header = sum(column in mapping for column in normalized_headers) >= 2
    data_rows = rows[1:] if has_header else rows
    print(
        f"[ApplyDock outreach import] parsed delimiter={delimiter_name} header={has_header} rows={len(data_rows)}",
        flush=True,
    )
    positional_headers = ["company", "full_name", "phone", "email", "status", "notes"]
    imported = 0
    skipped = 0
    invalid = []
    for row_number, row in enumerate(data_rows, start=2 if has_header else 1):
        source_headers = headers if has_header else positional_headers
        source_row = dict(zip(source_headers, row, strict=False))
        payload = {}
        for key, value in source_row.items():
            mapped = mapping.get(normalize_column(key))
            if mapped:
                payload[mapped] = normalize_contact_status(value) if mapped == "status" else value
        # Be forgiving about sheet quirks so one odd cell doesn't reject a whole row.
        if not str(payload.get("full_name") or "").strip() and payload.get("company"):
            payload["full_name"] = "Recruiter"
        if payload.get("email") and "@" not in str(payload["email"]):
            payload["email"] = ""
        if payload.get("status") and payload["status"] not in CONTACT_STATUSES:
            note = f"Sheet status: {payload['status']}"
            payload["notes"] = f"{payload.get('notes') or ''}\n{note}".strip()
            payload["status"] = "Not Sent"
        try:
            create_contact(payload)
            imported += 1
            print(f"[ApplyDock outreach import] row={row_number} imported", flush=True)
        except ValueError as error:
            if "already exists" in str(error).lower():
                skipped += 1
                print(f"[ApplyDock outreach import] row={row_number} skipped: duplicate contact", flush=True)
            else:
                invalid.append({"row_number": row_number, "row": source_row, "error": str(error)})
                print(f"[ApplyDock outreach import] row={row_number} invalid: {error}", flush=True)
    print(
        f"[ApplyDock outreach import] finished imported={imported} skipped={skipped} invalid={len(invalid)}",
        flush=True,
    )
    return {"imported": imported, "skipped": skipped, "invalid": invalid, "summary": {"total": imported + skipped + len(invalid)}}


def export_contacts_csv():
    with database.connect() as db:
        rows = db.execute("SELECT * FROM outreach_contacts ORDER BY company, full_name").fetchall()
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["full_name", "phone", "company", "designation", "email", "linkedin_url", "job_title", "job_description", "source", "notes", "status", "consent"])
    for row in rows:
        writer.writerow([
            row["full_name"], row["phone"], row["company"], row["designation"], row["email"], row["linkedin_url"],
            row["job_title"], row["job_description"], row["source"], row["notes"], row["status"], bool(row["consent"])
        ])
    return output.getvalue()


def list_templates(db=None):
    if db is None:
        with database.connect() as db:
            return [_public_template(row) for row in db.execute("SELECT * FROM outreach_templates ORDER BY created_at DESC")]
    return [_public_template(row) for row in db.execute("SELECT * FROM outreach_templates ORDER BY created_at DESC")]


def get_template(template_id, db=None):
    if db is None:
        with database.connect() as db:
            row = db.execute("SELECT * FROM outreach_templates WHERE id=?", (template_id,)).fetchone()
            return _public_template(row)
    row = db.execute("SELECT * FROM outreach_templates WHERE id=?", (template_id,)).fetchone()
    return _public_template(row)


def create_template(data):
    payload = data or {}
    name = str(payload.get("name") or "").strip()
    body = str(payload.get("body") or "").strip()
    if not name:
        raise ValueError("Template name is required.")
    if not body:
        raise ValueError("Template body is required.")
    with database.LOCK, database.connect() as db:
        template_id = str(uuid.uuid4())
        stamp = _now_iso()
        variables = payload.get("variables") or []
        db.execute("INSERT INTO outreach_templates(id,name,body,variables,created_at,updated_at) VALUES(?,?,?,?,?,?)",
                   (template_id, name, body, json.dumps(variables, ensure_ascii=False), stamp, stamp))
    return get_template(template_id)


def update_template(template_id, data):
    template = get_template(template_id)
    if not template:
        raise ValueError("Template not found.")
    payload = dict(template)
    payload.update(data or {})
    name = str(payload.get("name") or "").strip()
    body = str(payload.get("body") or "").strip()
    if not name:
        raise ValueError("Template name is required.")
    if not body:
        raise ValueError("Template body is required.")
    with database.LOCK, database.connect() as db:
        db.execute("UPDATE outreach_templates SET name=?, body=?, variables=?, updated_at=? WHERE id=?",
                   (name, body, json.dumps(payload.get("variables") or [], ensure_ascii=False), _now_iso(), template_id))
    return get_template(template_id)


def delete_template(template_id):
    with database.LOCK, database.connect() as db:
        return db.execute("DELETE FROM outreach_templates WHERE id=?", (template_id,)).rowcount


def list_schedules(db=None):
    if db is None:
        with database.connect() as db:
            return [
                _public_schedule(row) for row in db.execute("SELECT * FROM outreach_schedules ORDER BY send_at ASC, created_at DESC")
            ]
    return [_public_schedule(row) for row in db.execute("SELECT * FROM outreach_schedules ORDER BY send_at ASC, created_at DESC")]


def schedule_message(data):
    payload = data or {}
    contact = get_contact(payload.get("contact_id"))
    if not contact:
        raise ValueError("Contact not found.")
    if contact["status"] == "Do not contact":
        raise ValueError("This contact is marked Do not contact.")
    template = get_template(payload.get("template_id"))
    if not template:
        raise ValueError("Template not found.")
    resume_id = str(payload.get("resume_id") or "").strip()
    if resume_id:
        resume = resumes.get_resume(resume_id)
        if not resume or not resume["available"]:
            raise ValueError("Selected resume is unavailable. Choose another resume.")
        if resume.get("kind") == "tailored" and resume.get("entry_id"):
            pass
    if payload.get("send_at"):
        try:
            dt.datetime.fromisoformat(str(payload["send_at"]).replace("Z", "+00:00")).astimezone(dt.timezone.utc)
        except ValueError:
            raise ValueError("Send time must be an ISO-8601 timestamp.") from None
    else:
        payload["send_at"] = (dt.datetime.now(dt.timezone.utc) + dt.timedelta(hours=1)).isoformat()
    message = str(payload.get("message") or template["body"]).strip()
    if not message:
        raise ValueError("Message body is required.")
    with database.LOCK, database.connect() as db:
        schedule_id = str(uuid.uuid4())
        stamp = _now_iso()
        db.execute("""INSERT INTO outreach_schedules(
            id, contact_id, template_id, resume_id, message, send_at, time_window_start, time_window_end,
            status, result, notes, created_at, updated_at
        ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                   (schedule_id, contact["id"], template["id"], resume_id, message,
                    str(payload["send_at"]), str(payload.get("time_window_start") or ""),
                    str(payload.get("time_window_end") or ""), "pending", "pending",
                    str(payload.get("notes") or "").strip()[:1000], stamp, stamp))
    return get_schedule(schedule_id)


def get_schedule(schedule_id, db=None):
    if db is None:
        with database.connect() as db:
            row = db.execute("SELECT * FROM outreach_schedules WHERE id=?", (schedule_id,)).fetchone()
            if not row:
                return None
            contact = get_contact(row["contact_id"], db=db)
            template = get_template(row["template_id"], db=db)
            resume = resumes.get_resume(row["resume_id"], include_deleted=True) if row["resume_id"] else None
            return _public_schedule(row, contact, template, resume)
    row = db.execute("SELECT * FROM outreach_schedules WHERE id=?", (schedule_id,)).fetchone()
    if not row:
        return None
    contact = get_contact(row["contact_id"], db=db)
    template = get_template(row["template_id"], db=db)
    resume = resumes.get_resume(row["resume_id"], include_deleted=True) if row["resume_id"] else None
    return _public_schedule(row, contact, template, resume)


def overview():
    with database.connect() as db:
        total_contacts = db.execute("SELECT COUNT(*) FROM outreach_contacts").fetchone()[0]
        total_scheduled = db.execute("SELECT COUNT(*) FROM outreach_schedules").fetchone()[0]
        awaiting_action = db.execute("SELECT COUNT(*) FROM outreach_schedules WHERE status IN ('pending','ready')").fetchone()[0]
        sent = db.execute("SELECT COUNT(*) FROM outreach_schedules WHERE result='sent'").fetchone()[0]
        failed = db.execute("SELECT COUNT(*) FROM outreach_schedules WHERE result IN ('failed','skipped')").fetchone()[0]
        today = dt.datetime.now().astimezone().date().isoformat()
        today_scheduled = db.execute("SELECT COUNT(*) FROM outreach_schedules WHERE date(send_at) = ?", (today,)).fetchone()[0]
        upcoming = db.execute("SELECT COUNT(*) FROM outreach_schedules WHERE send_at > ?", (_now_iso(),)).fetchone()[0]
        return {
            "total_contacts": total_contacts,
            "total_scheduled": total_scheduled,
            "awaiting_action": awaiting_action,
            "sent_successfully": sent,
            "failed_or_skipped": failed,
            "today_scheduled": today_scheduled,
            "upcoming_outreach": upcoming,
            "resume_usage": {},
        }


def mark_schedule_result(schedule_id, result, notes="", status=None):
    allowed = {"sent", "skipped", "failed"}
    if result not in allowed:
        raise ValueError("Choose a valid result status.")
    if status is None:
        status = result
    with database.LOCK, database.connect() as db:
        row = db.execute("SELECT * FROM outreach_schedules WHERE id=?", (schedule_id,)).fetchone()
        if not row:
            raise ValueError("Message schedule not found.")
        stamp = _now_iso()
        db.execute("UPDATE outreach_schedules SET status=?, result=?, notes=?, updated_at=?, sent_at=?, opened_at=? WHERE id=?",
                   (status, result, str(notes or row["notes"] or "").strip()[:1000], stamp,
                    (stamp if result == "sent" else row["sent_at"]), (stamp if result == "sent" else row["opened_at"]), schedule_id))
    return get_schedule(schedule_id)
