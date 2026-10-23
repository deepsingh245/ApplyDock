"""Submission history: which exact resume file was sent to which application, and how.

Database helpers take an open connection. Invariants:
- A submission row snapshots everything needed to find the file later (resume name, version number,
  document id, sha256, filename) and is never edited. Changing the record adds a new row and marks the
  old one replaced (replaced_by, replaced_at), so the audit trail survives.
- The submitted file is a content-addressed resume document; resume deletion keeps documents that a
  submission references (see kept_document_ids), so the exact PDF stays retrievable.
- A Gmail draft is not a submission. Rows are 'verified' only when ApplyDock itself sent the email
  (SMTP accepted it); everything else is 'user_reported'.
"""
from __future__ import annotations

import datetime as dt
import hashlib
import secrets
import urllib.parse
import uuid
from pathlib import Path

from . import config

CHANNELS = {"email": "Email sent by ApplyDock", "gmail": "Gmail", "external": "Company site or portal", "other": "Other"}
EVIDENCE = {"verified": "Confirmed by ApplyDock", "user_reported": "Recorded by you"}


def now_iso():
    return dt.datetime.now(dt.timezone.utc).isoformat()


def init_schema(db):
    db.execute("""CREATE TABLE IF NOT EXISTS application_submissions (
      id TEXT PRIMARY KEY, entry_id TEXT NOT NULL, company TEXT NOT NULL DEFAULT '', title TEXT NOT NULL DEFAULT '',
      resume_id TEXT NOT NULL, resume_name TEXT NOT NULL DEFAULT '', resume_version_id TEXT NOT NULL,
      version_number INTEGER NOT NULL DEFAULT 0, document_id TEXT NOT NULL, sha256 TEXT NOT NULL, filename TEXT NOT NULL,
      mime_type TEXT NOT NULL DEFAULT 'application/pdf', channel TEXT NOT NULL, evidence TEXT NOT NULL,
      submitted_at TEXT NOT NULL DEFAULT '', recorded_at TEXT NOT NULL, message_ref TEXT NOT NULL DEFAULT '',
      note TEXT NOT NULL DEFAULT '', active INTEGER NOT NULL DEFAULT 1, replaced_by TEXT NOT NULL DEFAULT '',
      replaced_at TEXT NOT NULL DEFAULT '', access_token TEXT NOT NULL UNIQUE
    )""")
    db.execute("CREATE INDEX IF NOT EXISTS submissions_entry ON application_submissions(entry_id, recorded_at DESC)")
    db.execute("CREATE INDEX IF NOT EXISTS submissions_resume ON application_submissions(resume_id, recorded_at DESC)")


def file_url(row) -> str:
    return f"http://{config.HOST}:{config.PORT}/api/submissions/{row['id']}/file?access={urllib.parse.quote(row['access_token'])}"


def public(row) -> dict:
    item = {key: row[key] for key in ("id", "entry_id", "company", "title", "resume_id", "resume_name", "resume_version_id",
                                      "version_number", "sha256", "filename", "channel", "evidence", "submitted_at", "recorded_at",
                                      "message_ref", "note", "replaced_by", "replaced_at")}
    item["active"] = bool(row["active"])
    item["channel_label"] = CHANNELS.get(row["channel"], row["channel"])
    item["evidence_label"] = EVIDENCE.get(row["evidence"], row["evidence"])
    item["file_url"] = file_url(row)
    item["download_url"] = item["file_url"] + "&download=1"
    return item


def _clean_date(value) -> str:
    value = str(value or "").strip()
    if not value:
        return ""
    try:
        parsed = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        raise ValueError("Enter the submission date as YYYY-MM-DD.") from None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=dt.datetime.now().astimezone().tzinfo)
    if parsed > dt.datetime.now(dt.timezone.utc) + dt.timedelta(days=1):
        raise ValueError("The submission date cannot be in the future.")
    return parsed.isoformat()


def record(db, data_dir: Path, entry: dict, version, resume_name: str, channel: str, evidence: str = "user_reported",
           submitted_at: str = "", note: str = "", message_ref: str = "") -> dict:
    """Store an immutable submission of one exact resume version. Replaces (but keeps) the previous record."""
    if channel not in CHANNELS:
        raise ValueError("Choose how the application was submitted.")
    if evidence not in EVIDENCE:
        raise ValueError("Unknown submission evidence.")
    if not version:
        raise ValueError("Choose the resume version that was submitted.")
    path = (data_dir / version["stored_path"]).resolve()
    if not path.is_relative_to((data_dir / "resumes").resolve()) or not path.is_file():
        raise ValueError("That resume file is unavailable, so it cannot be recorded as submitted.")
    if hashlib.sha256(path.read_bytes()).hexdigest() != version["sha256"]:
        raise ValueError("The resume file on disk does not match its saved version.")
    stamp = now_iso()
    submission_id = str(uuid.uuid4())
    db.execute("""INSERT INTO application_submissions(id,entry_id,company,title,resume_id,resume_name,resume_version_id,version_number,
                  document_id,sha256,filename,mime_type,channel,evidence,submitted_at,recorded_at,message_ref,note,access_token)
                  VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
               (submission_id, entry["id"], str(entry.get("company", ""))[:200], str(entry.get("title", ""))[:300], version["resume_id"],
                str(resume_name or "")[:120], version["id"], int(version["version_number"]), version["document_id"], version["sha256"],
                version["original_filename"], version["mime_type"], channel, evidence, _clean_date(submitted_at) or stamp, stamp,
                str(message_ref or "")[:300], str(note or "").strip()[:1000], secrets.token_urlsafe(32)))
    db.execute("""UPDATE application_submissions SET active=0,replaced_by=?,replaced_at=? WHERE entry_id=? AND active=1 AND id<>?""",
               (submission_id, stamp, entry["id"], submission_id))
    return public(get(db, submission_id))


def get(db, submission_id: str):
    return db.execute("SELECT * FROM application_submissions WHERE id=?", (submission_id,)).fetchone()


def for_entry(db, entry_id: str) -> list:
    return [public(row) for row in db.execute("SELECT * FROM application_submissions WHERE entry_id=? ORDER BY recorded_at DESC", (entry_id,))]


def active_for_entry(db, entry_id: str):
    row = db.execute("SELECT * FROM application_submissions WHERE entry_id=? AND active=1 ORDER BY recorded_at DESC LIMIT 1", (entry_id,)).fetchone()
    return public(row) if row else None


def for_resume(db, resume_id: str) -> list:
    """Active submissions of any version of this resume (newest first): where the resume was used."""
    return [public(row) for row in db.execute(
        "SELECT * FROM application_submissions WHERE resume_id=? AND active=1 ORDER BY submitted_at DESC", (resume_id,))]


def counts_by_resume(db) -> dict:
    return {row[0]: row[1] for row in db.execute("SELECT resume_id,COUNT(*) FROM application_submissions WHERE active=1 GROUP BY resume_id")}


def kept_document_ids(db) -> set:
    """Resume documents that must survive resume deletion because an application was submitted with them."""
    return {row[0] for row in db.execute("SELECT DISTINCT document_id FROM application_submissions")}


def file_for(db, data_dir: Path, submission_id: str):
    """(row, path) of a submitted file, or (None, None)."""
    row = get(db, submission_id)
    if not row:
        return None, None
    document = db.execute("SELECT stored_path FROM resume_documents WHERE id=?", (row["document_id"],)).fetchone()
    if not document:
        return row, None
    path = (data_dir / document["stored_path"]).resolve()
    if not path.is_relative_to((data_dir / "resumes").resolve()) or not path.is_file():
        return row, None
    return row, path
