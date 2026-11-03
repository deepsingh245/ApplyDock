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

from . import database, outreach_schedule, resumes

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

SCHEDULE_STATUS = outreach_schedule.STATUSES
MISSED_AFTER_MINUTES = 30
# Guard rails for the extension sender: pace messages and cap a day, so a batch never looks like a blast.
AUTO_SEND_GAP_SECONDS = 90
AUTO_SEND_DAILY_CAP = 25
DEFAULT_FOLLOWUP_DAYS = [3, 7]
SCHEDULE_RESULTS = ["pending", "sent", "skipped", "failed", "cancelled"]


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
    item["is_default"] = bool(item.get("is_default"))
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


def migrate_v8(db):
    db.execute("""CREATE TABLE IF NOT EXISTS outreach_batches (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL DEFAULT '',
        scheduled_date TEXT NOT NULL DEFAULT '',
        window_start TEXT NOT NULL DEFAULT '',
        window_end TEXT NOT NULL DEFAULT '',
        timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata',
        mode TEXT NOT NULL DEFAULT 'even',
        recipient_count INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    )""")
    existing = {row["name"] for row in db.execute("PRAGMA table_info(outreach_schedules)")}
    for column, ddl in (("batch_id", "TEXT NOT NULL DEFAULT ''"), ("timezone", "TEXT NOT NULL DEFAULT 'Asia/Kolkata'"),
                        ("resume_version_id", "TEXT NOT NULL DEFAULT ''"), ("cancelled_at", "TEXT NOT NULL DEFAULT ''")):
        if column not in existing:
            db.execute(f"ALTER TABLE outreach_schedules ADD COLUMN {column} {ddl}")
    db.execute("UPDATE outreach_schedules SET status='scheduled' WHERE status='pending'")
    db.execute("CREATE INDEX IF NOT EXISTS outreach_schedules_batch ON outreach_schedules(batch_id)")


def migrate_v9(db):
    existing = {row["name"] for row in db.execute("PRAGMA table_info(outreach_templates)")}
    for column, ddl in (("category", "TEXT NOT NULL DEFAULT ''"), ("is_default", "INTEGER NOT NULL DEFAULT 0")):
        if column not in existing:
            db.execute(f"ALTER TABLE outreach_templates ADD COLUMN {column} {ddl}")
    db.execute("""CREATE TABLE IF NOT EXISTS outreach_followups (
        id TEXT PRIMARY KEY,
        schedule_id TEXT NOT NULL,
        contact_id TEXT NOT NULL,
        step INTEGER NOT NULL DEFAULT 1,
        due_at TEXT NOT NULL,
        message TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'pending',
        completed_at TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        FOREIGN KEY(schedule_id) REFERENCES outreach_schedules(id) ON DELETE CASCADE,
        FOREIGN KEY(contact_id) REFERENCES outreach_contacts(id) ON DELETE CASCADE
    )""")
    db.execute("CREATE INDEX IF NOT EXISTS outreach_followups_due ON outreach_followups(status, due_at)")


def migrate_v10(db):
    existing = {row["name"] for row in db.execute("PRAGMA table_info(outreach_schedules)")}
    for column, ddl in (("auto_send", "INTEGER NOT NULL DEFAULT 0"), ("sent_by", "TEXT NOT NULL DEFAULT ''")):
        if column not in existing:
            db.execute(f"ALTER TABLE outreach_schedules ADD COLUMN {column} {ddl}")


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
        # Deleting a contact removes its outreach history too (no orphaned schedules or follow-ups).
        db.execute("DELETE FROM outreach_followups WHERE contact_id=?", (contact_id,))
        db.execute("DELETE FROM outreach_schedules WHERE contact_id=?", (contact_id,))
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
        make_default = _coerce_bool(payload.get("is_default"))
        if make_default:
            db.execute("UPDATE outreach_templates SET is_default=0")
        db.execute("INSERT INTO outreach_templates(id,name,body,variables,category,is_default,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)",
                   (template_id, name, body, json.dumps(variables, ensure_ascii=False), str(payload.get("category") or "").strip()[:60],
                    int(make_default), stamp, stamp))
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
        make_default = _coerce_bool(payload.get("is_default"))
        if make_default:
            db.execute("UPDATE outreach_templates SET is_default=0")
        db.execute("UPDATE outreach_templates SET name=?, body=?, variables=?, category=?, is_default=?, updated_at=? WHERE id=?",
                   (name, body, json.dumps(payload.get("variables") or [], ensure_ascii=False),
                    str(payload.get("category") or "").strip()[:60], int(make_default), _now_iso(), template_id))
    return get_template(template_id)


def delete_template(template_id):
    with database.LOCK, database.connect() as db:
        return db.execute("DELETE FROM outreach_templates WHERE id=?", (template_id,)).rowcount


def list_schedules(db=None):
    if db is None:
        with database.connect() as db:
            return list_schedules(db)
    ids = [row["id"] for row in db.execute("SELECT id FROM outreach_schedules ORDER BY send_at ASC, created_at DESC")]
    return [get_schedule(schedule_id, db=db) for schedule_id in ids]


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
    resume_version_id = _pin_resume(resume_id) if resume_id else ""
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
            id, contact_id, template_id, resume_id, resume_version_id, message, send_at, time_window_start, time_window_end,
            status, result, notes, created_at, updated_at
        ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                   (schedule_id, contact["id"], template["id"], resume_id, resume_version_id, message,
                    str(payload["send_at"]), str(payload.get("time_window_start") or ""),
                    str(payload.get("time_window_end") or ""), "scheduled", "pending",
                    str(payload.get("notes") or "").strip()[:1000], stamp, stamp))
    return get_schedule(schedule_id)


def get_schedule(schedule_id, db=None):
    if db is None:
        with database.connect() as db:
            return get_schedule(schedule_id, db=db)
    row = db.execute("SELECT * FROM outreach_schedules WHERE id=?", (schedule_id,)).fetchone()
    if not row:
        return None
    contact = get_contact(row["contact_id"], db=db)
    template = get_template(row["template_id"], db=db)
    resume = resumes.get_resume(row["resume_id"], include_deleted=True) if row["resume_id"] else None
    item = _public_schedule(row, contact, template, resume)
    version = _pinned_version(db, row)
    item["resume_file_url"] = resumes.version_file_url(row["resume_id"], version) if version else ""
    item["resume_filename"] = version["original_filename"] if version else ""
    item["auto_send"] = bool(item.get("auto_send"))
    return item


def _pinned_version(db, row):
    """The exact resume version pinned when the message was scheduled (None if it is gone)."""
    if not row["resume_id"] or not row["resume_version_id"]:
        return None
    return db.execute("SELECT * FROM resume_versions WHERE id=? AND resume_id=?", (row["resume_version_id"], row["resume_id"])).fetchone()


def overview():
    with database.connect() as db:
        total_contacts = db.execute("SELECT COUNT(*) FROM outreach_contacts").fetchone()[0]
        total_scheduled = db.execute("SELECT COUNT(*) FROM outreach_schedules").fetchone()[0]
        awaiting_action = db.execute("SELECT COUNT(*) FROM outreach_schedules WHERE status IN ('scheduled','ready','opened','awaiting_confirmation')").fetchone()[0]
        sent = db.execute("SELECT COUNT(*) FROM outreach_schedules WHERE result='sent'").fetchone()[0]
        failed = db.execute("SELECT COUNT(*) FROM outreach_schedules WHERE result IN ('failed','skipped')").fetchone()[0]
        today = dt.datetime.now().astimezone().date().isoformat()
        today_scheduled = db.execute("SELECT COUNT(*) FROM outreach_schedules WHERE date(send_at) = ?", (today,)).fetchone()[0]
        upcoming = db.execute("SELECT COUNT(*) FROM outreach_schedules WHERE send_at > ? AND status IN ('scheduled','ready')", (_now_iso(),)).fetchone()[0]
        grace = (dt.datetime.now(dt.timezone.utc) - dt.timedelta(minutes=MISSED_AFTER_MINUTES)).isoformat()
        missed = db.execute("SELECT COUNT(*) FROM outreach_schedules WHERE status IN ('scheduled','ready') AND send_at < ?", (grace,)).fetchone()[0]
        resume_usage = {}
        for row in db.execute("SELECT resume_id, COUNT(*) AS n FROM outreach_schedules WHERE resume_id<>'' AND status<>'cancelled' GROUP BY resume_id"):
            resume = resumes.get_resume(row["resume_id"], include_deleted=True)
            resume_usage[(resume or {}).get("name") or "Deleted resume"] = row["n"]
        return {
            "total_contacts": total_contacts,
            "total_scheduled": total_scheduled,
            "awaiting_action": awaiting_action,
            "sent_successfully": sent,
            "failed_or_skipped": failed,
            "today_scheduled": today_scheduled,
            "upcoming_outreach": upcoming,
            "missed": missed,
            "pending_followups": db.execute("SELECT COUNT(*) FROM outreach_followups WHERE status='pending' AND due_at<=?", (_now_iso(),)).fetchone()[0],
            "resume_usage": resume_usage,
        }


def _pin_resume(resume_id):
    """The resume's current version id, or an error when the resume or its file is gone."""
    resume = resumes.get_resume(resume_id)
    if not resume or not resume["available"]:
        raise ValueError("Selected resume is unavailable. Choose another resume.")
    return resume.get("current_version_id", "")


def _set_status(schedule_id, target, **fields):
    """Move a schedule to `target` if the status machine allows it; extra columns are written alongside."""
    with database.LOCK, database.connect() as db:
        row = db.execute("SELECT status FROM outreach_schedules WHERE id=?", (schedule_id,)).fetchone()
        if not row:
            raise ValueError("Message schedule not found.")
        if not outreach_schedule.can_transition(row["status"], target):
            raise ValueError(f"A {row['status'].replace('_', ' ')} message cannot become {target.replace('_', ' ')}.")
        columns = {"status": target, "updated_at": _now_iso(), **fields}
        db.execute(f"UPDATE outreach_schedules SET {','.join(f'{name}=?' for name in columns)} WHERE id=?",
                   (*columns.values(), schedule_id))
    return get_schedule(schedule_id)


def mark_schedule_result(schedule_id, result, notes="", status=None, followup_days=None, sent_by=""):
    if result not in {"sent", "skipped", "failed"}:
        raise ValueError("Choose a valid result status.")
    extra = {"result": result}
    if notes:
        extra["notes"] = str(notes).strip()[:1000]
    if result == "sent":
        extra["sent_at"] = _now_iso()
        extra["sent_by"] = sent_by
    schedule = _set_status(schedule_id, status or result, **extra)
    if result == "sent":
        _after_sent(schedule, followup_days)
    return schedule


def _after_sent(schedule, followup_days):
    """Record the contact history and queue follow-up reminders (never sent automatically)."""
    contact = schedule["contact"]
    if not contact:
        return
    stamp = _now_iso()
    history = json.loads(contact.get("communication_history") or "[]")
    history.append({"at": stamp, "channel": "whatsapp", "note": "Application message sent"})
    status = "Application Sent" if contact["status"] in {"Not Sent", "New", "Scheduled", "Interested"} else contact["status"]
    with database.LOCK, database.connect() as db:
        db.execute("UPDATE outreach_contacts SET last_contacted_at=?, status=?, communication_history=?, updated_at=? WHERE id=?",
                   (stamp, status, json.dumps(history[-50:], ensure_ascii=False), stamp, contact["id"]))
        days = DEFAULT_FOLLOWUP_DAYS if followup_days is None else [int(d) for d in followup_days if int(d) > 0][:5]
        zone = outreach_schedule.parse_timezone(schedule.get("timezone"))
        sent_day = dt.datetime.now(zone).date()
        role = contact.get("job_title") or "the open role"
        for step, count in enumerate(sorted(set(days)), start=1):
            due = dt.datetime.combine(outreach_schedule.add_working_days(sent_day, count), dt.time(9, 0), tzinfo=zone)
            message = (f"Hi {contact['full_name']}, just following up on my application for {role} at {contact['company']}. "
                       "Happy to share anything else you need. Thank you!")
            db.execute("INSERT INTO outreach_followups(id,schedule_id,contact_id,step,due_at,message,created_at) VALUES(?,?,?,?,?,?,?)",
                       (str(uuid.uuid4()), schedule["id"], contact["id"], step, due.astimezone(dt.timezone.utc).isoformat(), message, stamp))


def list_followups():
    with database.connect() as db:
        rows = db.execute("SELECT * FROM outreach_followups ORDER BY status='pending' DESC, due_at").fetchall()
        return [{**dict(row), "contact": get_contact(row["contact_id"], db=db)} for row in rows]


def finish_followup(followup_id, action):
    """The user confirms they sent the follow-up (done) or drops it (dismissed)."""
    if action not in {"done", "dismissed"}:
        raise ValueError("Choose done or dismissed.")
    with database.LOCK, database.connect() as db:
        row = db.execute("SELECT * FROM outreach_followups WHERE id=?", (followup_id,)).fetchone()
        if not row:
            raise ValueError("Follow-up not found.")
        if row["status"] != "pending":
            raise ValueError("That follow-up is already finished.")
        stamp = _now_iso()
        db.execute("UPDATE outreach_followups SET status=?, completed_at=? WHERE id=?", (action, stamp, followup_id))
        if action == "done":
            db.execute("UPDATE outreach_contacts SET last_contacted_at=?, updated_at=? WHERE id=?", (stamp, stamp, row["contact_id"]))
        return {**dict(db.execute("SELECT * FROM outreach_followups WHERE id=?", (followup_id,)).fetchone()), "contact": get_contact(row["contact_id"], db=db)}


def reschedule(schedule_id, send_at):
    try:
        moment = dt.datetime.fromisoformat(str(send_at).replace("Z", "+00:00"))
    except ValueError:
        raise ValueError("Send time must be an ISO-8601 timestamp.") from None
    if moment.tzinfo is None:
        raise ValueError("Send time must include a timezone.")
    return _set_status(schedule_id, "scheduled", send_at=moment.astimezone(dt.timezone.utc).isoformat(), result="pending")


def cancel_schedule(schedule_id):
    return _set_status(schedule_id, "cancelled", result="cancelled", cancelled_at=_now_iso())


def mark_opened(schedule_id):
    """Opening WhatsApp is not sending: the message waits for the user's confirmation."""
    return _set_status(schedule_id, "awaiting_confirmation", opened_at=_now_iso())


def find_duplicates(contact):
    """Queued or already-sent schedules for this contact (a repeat needs explicit confirmation)."""
    with database.connect() as db:
        rows = db.execute(
            "SELECT id, send_at, status FROM outreach_schedules WHERE contact_id=? AND status IN "
            "('scheduled','ready','opened','awaiting_confirmation','sent','draft')", (contact["id"],)).fetchall()
    return [dict(row) for row in rows]


def _contact_values(contact):
    return {"hr_name": contact["full_name"], "full_name": contact["full_name"], "company_name": contact["company"],
            "company": contact["company"], "job_title": contact.get("job_title", "")}


def preview_batch(data):
    """Dry run: the slot for every selected contact with its rendered message and any problems. Writes nothing."""
    payload = data or {}
    contact_ids = list(dict.fromkeys(payload.get("contact_ids") or []))
    if not contact_ids:
        raise ValueError("Select at least one contact.")
    template = get_template(payload.get("template_id"))
    if not template:
        raise ValueError("Choose a message template.")
    resume_id = str(payload.get("resume_id") or "").strip()
    if not resume_id:
        raise ValueError("Choose the resume to send with this batch.")
    resume = resumes.get_resume(resume_id)
    resume_error = "" if resume and resume["available"] else "The selected resume file is missing. Choose another resume."

    rows = []
    for contact_id in contact_ids:
        contact = get_contact(contact_id)
        row = {"contact_id": contact_id, "errors": [], "warnings": [], "send_at": "", "message": "", "duplicate": False}
        if not contact:
            row["errors"].append("Contact no longer exists.")
        else:
            row.update(name=contact["full_name"], company=contact["company"], phone=contact["phone"])
            if contact["status"] == "Do not contact":
                row["errors"].append("Marked Do not contact.")
            if resume_error:
                row["errors"].append(resume_error)
            text, missing = outreach_schedule.render_template(template["body"], _contact_values(contact))
            row["message"] = text
            if missing:
                row["warnings"].append("Missing: " + ", ".join(missing))
            if find_duplicates(contact):
                row["duplicate"] = True
                row["warnings"].append("Already queued or sent to this contact.")
        rows.append(row)

    valid = [row for row in rows if not row["errors"]]
    plan = outreach_schedule.compute_slots(
        payload.get("date"), payload.get("start"), payload.get("end"), len(valid), payload.get("mode") or "even",
        payload.get("interval_minutes"), payload.get("manual_times"), payload.get("max_per_window"),
        _coerce_bool(payload.get("skip_weekends")), payload.get("timezone") or outreach_schedule.DEFAULT_TIMEZONE)
    for row, slot in zip(valid, plan["slots"], strict=False):
        row["send_at"] = slot
    for row in valid[len(plan["slots"]):]:
        row["errors"].append("No free slot in this window.")
    overflow = plan["overflow"]
    return {"rows": rows, "overflow": overflow, "resume": {"id": resume_id, "name": (resume or {}).get("name", "")},
            "notice": f"{overflow} contact(s) do not fit in this window. Widen it or schedule them in another window." if overflow else ""}


def commit_batch(data):
    """Create the batch and its schedules from the (possibly edited) preview rows, all or nothing."""
    payload = data or {}
    rows = payload.get("rows") or []
    if not rows:
        raise ValueError("There are no messages to schedule.")
    template = get_template(payload.get("template_id"))
    if not template:
        raise ValueError("Choose a message template.")
    resume_id = str(payload.get("resume_id") or "").strip()
    if not resume_id:
        raise ValueError("Choose the resume to send with this batch.")
    version_id = _pin_resume(resume_id)
    auto_send = int(_coerce_bool(payload.get("auto_send")))
    allow = set(payload.get("allow_duplicate_ids") or [])
    timezone_name = payload.get("timezone") or outreach_schedule.DEFAULT_TIMEZONE
    zone = outreach_schedule.parse_timezone(timezone_name)
    prepared, seen = [], set()
    for row in rows:
        contact = get_contact(row.get("contact_id"))
        if not contact:
            raise ValueError("A selected contact no longer exists.")
        name = contact["full_name"]
        if contact["status"] == "Do not contact":
            raise ValueError(f"{name} is marked Do not contact.")
        if contact["id"] in seen:
            raise ValueError(f"{name} appears twice in this batch.")
        seen.add(contact["id"])
        if find_duplicates(contact) and contact["id"] not in allow:
            raise ValueError(f"{name} was already queued or sent. Confirm the duplicate to continue.")
        message = str(row.get("message") or "").strip()
        if not message:
            raise ValueError(f"The message for {name} is empty.")
        if "{{" in message:
            raise ValueError(f"The message for {name} still has an unfilled variable.")
        try:
            send_at = dt.datetime.fromisoformat(str(row.get("send_at")).replace("Z", "+00:00"))
        except ValueError:
            raise ValueError(f"Choose a valid time for {name}.") from None
        if send_at.tzinfo is None:
            send_at = send_at.replace(tzinfo=zone)
        prepared.append((contact, message, send_at.astimezone(dt.timezone.utc).isoformat()))

    stamp = _now_iso()
    batch_id = str(uuid.uuid4())
    start, end = str(payload.get("start") or ""), str(payload.get("end") or "")
    with database.LOCK, database.connect() as db:
        db.execute("""INSERT INTO outreach_batches(id,name,scheduled_date,window_start,window_end,timezone,mode,recipient_count,status,created_at,updated_at)
                      VALUES(?,?,?,?,?,?,?,?,?,?,?)""",
                   (batch_id, str(payload.get("name") or "").strip()[:120], str(payload.get("date") or ""), start, end,
                    str(timezone_name), str(payload.get("mode") or "even"), len(prepared), "active", stamp, stamp))
        for contact, message, send_at in prepared:
            db.execute("""INSERT INTO outreach_schedules(id,contact_id,template_id,resume_id,resume_version_id,message,send_at,
                          time_window_start,time_window_end,status,result,batch_id,timezone,auto_send,created_at,updated_at)
                          VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                       (str(uuid.uuid4()), contact["id"], template["id"], resume_id, version_id, message, send_at,
                        start, end, "scheduled", "pending", batch_id, str(timezone_name), auto_send, stamp, stamp))
    return get_batch(batch_id)


def get_batch(batch_id):
    with database.connect() as db:
        row = db.execute("SELECT * FROM outreach_batches WHERE id=?", (batch_id,)).fetchone()
        if not row:
            return None
        batch = dict(row)
        batch["schedules"] = [get_schedule(r["id"], db=db) for r in
                              db.execute("SELECT id FROM outreach_schedules WHERE batch_id=? ORDER BY send_at", (batch_id,))]
    return batch


def list_batches():
    with database.connect() as db:
        return [dict(row) for row in db.execute("SELECT * FROM outreach_batches ORDER BY created_at DESC")]


def set_batch_paused(batch_id, paused):
    """Pausing parks the batch's still-scheduled messages as drafts; resuming schedules them again."""
    source, target = ("scheduled", "draft") if paused else ("draft", "scheduled")
    with database.LOCK, database.connect() as db:
        if not db.execute("SELECT 1 FROM outreach_batches WHERE id=?", (batch_id,)).fetchone():
            raise ValueError("Batch not found.")
        stamp = _now_iso()
        db.execute("UPDATE outreach_schedules SET status=?,updated_at=? WHERE batch_id=? AND status=?", (target, stamp, batch_id, source))
        db.execute("UPDATE outreach_batches SET status=?,updated_at=? WHERE id=?", ("paused" if paused else "active", stamp, batch_id))
    return get_batch(batch_id)


def cancel_batch(batch_id):
    batch = get_batch(batch_id)
    if not batch:
        raise ValueError("Batch not found.")
    for item in batch["schedules"]:
        if outreach_schedule.can_transition(item["status"], "cancelled"):
            cancel_schedule(item["id"])
    with database.LOCK, database.connect() as db:
        db.execute("UPDATE outreach_batches SET status='cancelled',updated_at=? WHERE id=?", (_now_iso(), batch_id))
    return get_batch(batch_id)


# ---------------------------------------------------------------- extension sender
# The Chrome extension polls claim() while the user's WhatsApp Web tab is available. It opens the chat, attaches
# the pinned resume with the message as its caption and, only for auto_send messages, presses Send, then report()s.

def extension_claim():
    """Hand the extension the next due message (marking it opened so it is never handed out twice)."""
    now = dt.datetime.now(dt.timezone.utc)
    with database.connect() as db:
        recent = [row["opened_at"] for row in db.execute("SELECT opened_at FROM outreach_schedules WHERE opened_at<>''")]
        day_ago = (now - dt.timedelta(hours=24)).isoformat()
        sent_today = db.execute("SELECT COUNT(*) FROM outreach_schedules WHERE sent_by='extension' AND sent_at>?", (day_ago,)).fetchone()[0]
        rows = db.execute("SELECT id, send_at, auto_send FROM outreach_schedules WHERE status IN ('scheduled','ready') ORDER BY send_at").fetchall()
    gap = dt.timedelta(seconds=AUTO_SEND_GAP_SECONDS)
    if any(now - dt.datetime.fromisoformat(value) < gap for value in recent):
        return {"item": None, "reason": "pacing"}
    for row in rows:
        due = dt.datetime.fromisoformat(row["send_at"])
        if due > now or now - due > dt.timedelta(minutes=MISSED_AFTER_MINUTES):
            continue  # not due yet, or missed: stale messages are left for the user to decide on
        if row["auto_send"] and sent_today >= AUTO_SEND_DAILY_CAP:
            continue
        try:
            schedule = _set_status(row["id"], "awaiting_confirmation", opened_at=_now_iso())
        except ValueError:
            continue
        contact = schedule["contact"] or {}
        if not contact.get("phone"):
            _set_status(schedule["id"], "failed", result="failed", notes="Contact has no phone number.")
            continue
        return {"item": {
            "id": schedule["id"], "phone": contact["phone"], "message": schedule["message"], "auto_send": schedule["auto_send"],
            "resume_file_url": schedule["resume_file_url"], "resume_filename": schedule["resume_filename"]}}
    return {"item": None, "reason": "none due"}


def extension_report(schedule_id, outcome, detail=""):
    """The extension's result. Only a verified delivery marks Sent; anything else waits for the user."""
    detail = str(detail or "").strip()[:200]
    if outcome == "sent":
        return mark_schedule_result(schedule_id, "sent", "Sent by the ApplyDock extension.", sent_by="extension")
    if outcome == "failed":
        return mark_schedule_result(schedule_id, "failed", f"Extension could not send: {detail or 'unknown error'}")
    notes = {"attached": "Chat opened with the resume attached. Press Send in WhatsApp, then confirm here.",
             "unverified": "Send was pressed but delivery could not be confirmed. Check WhatsApp, then confirm here."}
    if outcome not in notes:
        raise ValueError("Unknown outcome.")
    with database.LOCK, database.connect() as db:
        db.execute("UPDATE outreach_schedules SET notes=?, updated_at=? WHERE id=?", (notes[outcome], _now_iso(), schedule_id))
    return get_schedule(schedule_id)
