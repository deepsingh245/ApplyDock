"""Local SMTP delivery: credential checks and the 9 AM sender loop that sends approved applications."""
from __future__ import annotations

import datetime as dt
import email.message
import email.utils
import re
import smtplib
import ssl
import time

from . import applications, ats, config, database, events, notion, resumes, submissions


def send_mail(entry):
    settings = config.SETTINGS.get("smtp", {})
    if not config.SETTINGS.get("smtp_verified"):
        raise RuntimeError("Email account has not been verified.")
    password = config.unprotect(settings.get("password", ""))
    if not password:
        raise RuntimeError("Email account is not connected.")
    _, resume, version = resumes.resume_file_for_entry(entry)
    msg = email.message.EmailMessage()
    msg["From"] = settings["from"]
    msg["To"] = entry["recipient"]
    msg["Subject"] = entry["subject"]
    msg["Message-ID"] = email.utils.make_msgid(domain="applydock.local")
    msg.set_content(entry["body"])
    mime = "application/pdf" if resume.suffix.lower() == ".pdf" else "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    maintype, subtype = mime.split("/", 1)
    msg.add_attachment(resumes.attachment_bytes(resume, version), maintype=maintype, subtype=subtype, filename=version["original_filename"])
    context = ssl.create_default_context()
    host, port = settings["host"], int(settings["port"])
    if port == 465:
        with smtplib.SMTP_SSL(host, port, timeout=30, context=context) as smtp:
            smtp.login(settings["username"], password)
            smtp.send_message(msg)
    else:
        with smtplib.SMTP(host, port, timeout=30) as smtp:
            smtp.ehlo()
            smtp.starttls(context=context)
            smtp.ehlo()
            smtp.login(settings["username"], password)
            smtp.send_message(msg)
    return {**version, "message_id": msg["Message-ID"]}


def test_smtp_login(settings, password):
    """Authenticate without sending an email before accepting SMTP credentials."""
    context = ssl.create_default_context()
    host, port = settings["host"], int(settings["port"])
    try:
        if port == 465:
            with smtplib.SMTP_SSL(host, port, timeout=20, context=context) as smtp:
                smtp.login(settings["username"], password)
                smtp.noop()
        else:
            with smtplib.SMTP(host, port, timeout=20) as smtp:
                smtp.ehlo()
                smtp.starttls(context=context)
                smtp.ehlo()
                smtp.login(settings["username"], password)
                smtp.noop()
    except smtplib.SMTPAuthenticationError:
        raise ValueError("Email sign-in failed. Check the full email username and your provider's app password.") from None
    except (OSError, smtplib.SMTPException) as error:
        raise ValueError(f"Could not verify the email connection: {type(error).__name__}.") from None


def prepare_smtp_settings(data):
    host = str(data.get("host", "")).strip()
    port = int(data.get("port", 0))
    username = str(data.get("username", "")).strip()
    sender = str(data.get("from", "")).strip()
    password = str(data.get("password", ""))
    if not host or port not in (465, 587) or not username or not sender or not (password or config.SETTINGS.get("smtp", {}).get("password")):
        raise ValueError("Provide SMTP host, port 465 or 587, username, From address, and password.")
    if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", sender):
        raise ValueError("Invalid From email.")
    if host.lower() == "smtp.gmail.com":
        if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", username):
            raise ValueError("For Gmail, Username must be your full email address.")
        password = password.replace(" ", "") if password else password
        if password and len(password) != 16:
            raise ValueError("For Gmail, enter the 16-character Google app password, not your regular password.")
    actual_password = password or config.unprotect(config.SETTINGS["smtp"]["password"])
    return {"host": host, "port": port, "username": username, "from": sender}, actual_password


def process_due(current=None):
    current = current or dt.datetime.now().astimezone()
    if (current.hour, current.minute) != (9, 0):
        return 0
    current_utc = current.astimezone(dt.timezone.utc)
    due = [e for e in applications.entries() if e["status"] == "approved" and e["delivery_mode"] == "local" and dt.datetime.fromisoformat(e["send_at"]).astimezone(dt.timezone.utc) <= current_utc]
    attempted = 0
    for entry in due:
        if entry["notion_id"] and config.SETTINGS.get("notion_token"):
            try:
                if notion.notion_page_trashed(entry):
                    applications.delete_local_entry(entry["id"], entry["notion_id"])
                    continue
            except Exception as error:
                with database.connect() as db:
                    db.execute("UPDATE entries SET sync_error=? WHERE id=?", ("Could not verify Notion before sending: " + str(error)[:850], entry["id"]))
                continue
        with database.LOCK, database.connect() as db:
            changed = db.execute("UPDATE entries SET status='sending',updated_at=? WHERE id=? AND status='approved' AND delivery_mode='local'", (config.now_iso(), entry["id"])).rowcount
        if not changed:
            continue
        attempted += 1
        # 'sending' is deliberately never retried automatically after a crash: delivery may be uncertain.
        try:
            sent_version = send_mail(entry)
            record = resumes.attachment_record(sent_version) if isinstance(sent_version, dict) else {"attachment_sha256": "", "attachment_filename": "", "attached_at": ""}
            with database.connect() as db:
                db.execute("UPDATE entries SET status='sent',sent_at=?,updated_at=?,attachment_sha256=?,attachment_filename=?,attached_at=? WHERE id=?",
                           (config.now_iso(), config.now_iso(), record["attachment_sha256"], record["attachment_filename"], record["attached_at"], entry["id"]))
            record_sent_submission(entry, sent_version)
        except Exception as error:
            with database.connect() as db:
                db.execute("UPDATE entries SET status='failed',send_error=?,updated_at=? WHERE id=?", (str(error)[:1000], config.now_iso(), entry["id"]))
        events.application_changed(entry["id"])
    return attempted


def record_sent_submission(entry, sent_version):
    """The SMTP server accepted the message: a verified submission of exactly the attached version."""
    if not isinstance(sent_version, dict) or not sent_version.get("id"):
        return
    try:
        with database.LOCK, database.connect() as db:
            version = ats.version_by_id(db, sent_version["id"])
            resume = db.execute("SELECT name FROM resumes WHERE id=?", (version["resume_id"],)).fetchone() if version else None
            submissions.record(db, config.DATA, entry, version, resume["name"] if resume else "", "email", "verified",
                               message_ref=sent_version.get("message_id", ""))
            if not applications.stage_is_after_apply(entry.get("application_stage")):
                db.execute("UPDATE entries SET application_stage='Applied',needs_review=0 WHERE id=?", (entry["id"],))
    except Exception as error:
        print("Could not record the submission:", type(error).__name__, flush=True)


def scheduler():
    while True:
        try: process_due()
        except Exception as error: print("Scheduler error:", error, flush=True)
        try: notion.reconcile_notion_deletions()
        except Exception as error: print("Notion change check error:", error, flush=True)
        time.sleep(10)
