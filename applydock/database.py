"""SQLite connection, schema creation, and versioned data migrations (with a backup before each upgrade)."""
from __future__ import annotations

from contextlib import contextmanager
from pathlib import Path
import datetime as dt
import json
import secrets
import sqlite3
import threading
import uuid

from . import ats, config, profile, resume_store, submissions


LOCK = threading.RLock()


@contextmanager
def connect():
    db = sqlite3.connect(config.DB, timeout=15)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA journal_mode=WAL")
    try:
        with db:
            yield db
    finally:
        db.close()


def init_db():
    with connect() as db:
        db.execute("""CREATE TABLE IF NOT EXISTS entries (
          id TEXT PRIMARY KEY, url TEXT NOT NULL UNIQUE, kind TEXT NOT NULL,
          title TEXT NOT NULL, company TEXT NOT NULL DEFAULT '', excerpt TEXT NOT NULL DEFAULT '',
          recipient TEXT NOT NULL DEFAULT '', subject TEXT NOT NULL DEFAULT '', body TEXT NOT NULL DEFAULT '',
          send_at TEXT NOT NULL DEFAULT '', resume_path TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'draft', notion_id TEXT NOT NULL DEFAULT '',
          sync_error TEXT NOT NULL DEFAULT '', send_error TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL, updated_at TEXT NOT NULL, sent_at TEXT NOT NULL DEFAULT ''
        )""")
        columns = {row["name"] for row in db.execute("PRAGMA table_info(entries)")}
        additions = {
            "platform": "TEXT NOT NULL DEFAULT 'Linkedin'",
            "apply_method": "TEXT NOT NULL DEFAULT 'unknown'",
            "apply_url": "TEXT NOT NULL DEFAULT ''",
            "needs_review": "INTEGER NOT NULL DEFAULT 0",
            "delivery_mode": "TEXT NOT NULL DEFAULT 'local'",
            "gmail_draft_id": "TEXT NOT NULL DEFAULT ''",
            "gmail_account": "TEXT NOT NULL DEFAULT ''",
            "gmail_dirty": "INTEGER NOT NULL DEFAULT 0",
            "contact_emails": "TEXT NOT NULL DEFAULT '[]'",
            "post_details": "TEXT NOT NULL DEFAULT ''",
            "resume_id": "TEXT NOT NULL DEFAULT ''",
            "application_stage": "TEXT NOT NULL DEFAULT ''",
            "notion_edited_at": "TEXT NOT NULL DEFAULT ''",
            # The exact resume version this application uses and the file last attached to it.
            "resume_version_id": "TEXT NOT NULL DEFAULT ''",
            "attachment_sha256": "TEXT NOT NULL DEFAULT ''",
            "attachment_filename": "TEXT NOT NULL DEFAULT ''",
            "attached_at": "TEXT NOT NULL DEFAULT ''"
        }
        for name, declaration in additions.items():
            if name not in columns:
                db.execute(f"ALTER TABLE entries ADD COLUMN {name} {declaration}")
        db.execute("""CREATE TABLE IF NOT EXISTS resumes (
          id TEXT PRIMARY KEY, name TEXT NOT NULL, category TEXT NOT NULL DEFAULT 'Uncategorized',
          stored_path TEXT NOT NULL, original_filename TEXT NOT NULL, mime_type TEXT NOT NULL,
          size_bytes INTEGER NOT NULL DEFAULT 0, access_token TEXT NOT NULL UNIQUE,
          is_default INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
          deleted_at TEXT NOT NULL DEFAULT ''
        )""")
        ats.init_schema(db)
        resume_store.init_schema(db)
        profile.init_schema(db)
        submissions.init_schema(db)
        version = db.execute("PRAGMA user_version").fetchone()[0]
        if version < 1:
            for row in list(db.execute("SELECT id,excerpt,recipient,contact_emails FROM entries")):
                if row["contact_emails"] not in ("", "[]"):
                    continue
                found = []
                for address in config.EMAIL_PATTERN.findall(row["excerpt"] + "\n" + row["recipient"]):
                    address = address.lower()
                    if address not in found:
                        found.append(address)
                if found:
                    db.execute("UPDATE entries SET contact_emails=? WHERE id=?", (json.dumps(found[:30]), row["id"]))
            db.execute("PRAGMA user_version=1")
        if version < 2:
            rows = list(db.execute("SELECT id,resume_path FROM entries WHERE resume_path<>'' AND resume_id=''"))
            migrated = {}
            stamp = dt.datetime.now(dt.timezone.utc).isoformat()
            for row in rows:
                relative = row["resume_path"]
                if relative not in migrated:
                    path = (config.DATA / relative).resolve()
                    filename = path.name.split("_", 1)[-1] if "_" in path.name else path.name
                    resume_id = str(uuid.uuid4())
                    extension = path.suffix.lower()
                    mime = "application/pdf" if extension == ".pdf" else "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                    size = path.stat().st_size if path.is_file() else 0
                    db.execute("""INSERT INTO resumes(id,name,category,stored_path,original_filename,mime_type,size_bytes,access_token,created_at,updated_at)
                                  VALUES(?,?,?,?,?,?,?,?,?,?)""",
                               (resume_id, Path(filename).stem[:120] or "Resume", "Uncategorized", relative, filename[:180], mime, size,
                                secrets.token_urlsafe(32), stamp, stamp))
                    migrated[relative] = resume_id
                db.execute("UPDATE entries SET resume_id=? WHERE id=?", (migrated[relative], row["id"]))
            db.execute("PRAGMA user_version=2")
        if version < 3:
            ats.migrate_legacy_resumes(db, config.DATA)
            db.execute("PRAGMA user_version=3")
        if version < 4:
            # v4 adds structured resume editing. All new columns are additive with defaults
            # (existing resumes become masters, existing versions are uploads); the version
            # bump exists so backup_before_migration() keeps a copy of the pre-v4 database.
            db.execute("PRAGMA user_version=4")
        if version < 5:
            # v5 adds the Master Profile, link checks, and submission history (new tables only), plus a
            # profile snapshot column on analysis runs; the bump keeps a backup of the pre-v5 database.
            db.execute("PRAGMA user_version=5")
        ats.refresh_failed_extractions(db, config.DATA)
        if not db.execute("SELECT 1 FROM resumes WHERE deleted_at='' AND is_default=1 LIMIT 1").fetchone():
            first_resume = db.execute("SELECT id FROM resumes WHERE deleted_at='' AND kind='master' ORDER BY created_at LIMIT 1").fetchone()
            if first_resume:
                db.execute("UPDATE resumes SET is_default=1 WHERE id=?", (first_resume["id"],))
        if "apply_method" not in columns:
            db.execute("UPDATE entries SET apply_method='email' WHERE recipient<>''")
        if "needs_review" not in columns:
            db.execute("UPDATE entries SET needs_review=1 WHERE status NOT IN ('approved','sending','sent')")
        stamp = dt.datetime.now(dt.timezone.utc).isoformat()
        db.execute("""UPDATE entries
                      SET needs_review=0,
                          status=CASE WHEN status='approved' THEN 'draft' ELSE status END,
                          updated_at=?
                      WHERE lower(trim(application_stage)) IN ('applied','no answer','offer','rejected')
                        AND (needs_review<>0 OR status='approved')""", (stamp,))


SCHEMA_VERSION = 5


def backup_before_migration():
    """Copy the database once before any schema migration (pre-ats for v<3, otherwise pre-v<SCHEMA_VERSION>)."""
    if not config.DB.exists():
        return
    source = sqlite3.connect(config.DB)
    try:
        version = source.execute("PRAGMA user_version").fetchone()[0]
        if version >= SCHEMA_VERSION:
            return
        stamp = dt.datetime.now().strftime("%Y%m%d-%H%M%S")
        destination = config.DATA / (f"capture.pre-ats-{stamp}.sqlite3" if version < 3 else f"capture.pre-v{SCHEMA_VERSION}-{stamp}.sqlite3")
        backup = sqlite3.connect(destination)
        try:
            source.backup(backup)
        finally:
            backup.close()
    finally:
        source.close()
