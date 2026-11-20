"""Hiring-post emails that build themselves once the tailored resume is saved.

A hiring post with an email address and no apply link can only be answered by email, so after you save the tailored
resume for it the helper drafts the email (Codex, grounded in your profile and that resume's own headline and skills),
adds your signature, and leaves it in the Email tab beside the attached resume. It only fills an empty draft, never
overwrites your text, never approves and never sends.
"""
from __future__ import annotations

import re
import threading

from . import ai_draft, applications, config, database, events, profile, resume_store

_running = set()
_guard = threading.Lock()
LOCKED_STATUSES = ("sending", "sent", "approved")


def eligible(entry):
    """True for a hiring post answered by email only: an address, no apply link, nothing written yet, not locked."""
    if not entry or entry["kind"] != "post" or entry["apply_url"] or entry["apply_method"] not in ("unknown", "email"):
        return False
    if not (entry["contact_emails"] or entry["recipient"]):
        return False
    if entry["subject"].strip() or entry["body"].strip():
        return False
    return entry["status"] not in LOCKED_STATUSES and entry["delivery_mode"] != "gmail_scheduled" and bool(entry["resume_id"])


def signature():
    """Your sign-off: the custom text from Settings, else built from the Master Profile's personal details."""
    custom = str(config.SETTINGS.get("email_signature", "")).strip()
    if custom:
        return custom
    with database.connect() as db:
        details = profile.personal(db)["data"]
    lines = [details.get("name", "")]
    for key in ("email", "phone", "website", "linkedin", "github"):
        value = str(details.get(key, "")).strip()
        if key in ("website", "github"):  # shown bare ("github.com/name"); LinkedIn keeps its full link
            value = re.sub(r"^https?://", "", value).rstrip("/")
        if value:
            lines.append(f"- {value}")
    lines = [line for line in lines if line.strip()]
    return ("Warm regards,\n" + "\n".join(lines)) if lines else ""


# A closing is a line that is only the sign-off ("Best regards,"), plus whatever follows it (a name the model added).
_CLOSING = re.compile(r"\n[ \t]*(?:warm |kind |best |with )?(?:regards|thanks|thank you|sincerely|best wishes|cheers)[ \t]*[,!.]?[ \t]*(?:\n.*)?\Z", re.I | re.S)


def with_signature(body):
    """The body without any closing the model added, followed by the real signature."""
    text = _CLOSING.sub("", str(body or "").rstrip()).rstrip()
    sign_off = signature()
    return f"{text}\n\n{sign_off}" if sign_off else text


def resume_highlights(resume_id):
    """The tailored resume's headline and skills: facts already in the saved file, so the email can lean on them."""
    with database.connect() as db:
        draft = resume_store.get_draft(db, resume_id)
    content = (draft or {}).get("content") or {}
    headline = str((content.get("basics") or {}).get("label") or "").strip()
    skills = [str(skill.get("name", "")).strip() for skill in (content.get("skills") or []) if isinstance(skill, dict)]
    return {"headline": headline, "skills": [skill for skill in skills if skill][:25]}


def build_draft(entry):
    """Subject and body (with signature) for an entry, through the same Codex path as the manual button."""
    draft = ai_draft.generate_ai_draft(entry, resume_highlights(entry["resume_id"]) if entry["resume_id"] else None)
    return {**draft, "body": with_signature(draft["body"])}


def _run(entry_id):
    try:
        entry = applications.get_entry(entry_id)
        if not eligible(entry):
            return
        draft = build_draft(entry)
        latest = applications.get_entry(entry_id)
        if not eligible(latest):  # you wrote or locked it while Codex was working
            return
        recipient = latest["recipient"] or latest["contact_emails"][0]
        applications.update_entry(entry_id, {"subject": draft["subject"], "body": draft["body"], "recipient": recipient, "apply_method": "email"})
        events.application_changed(entry_id)
    except Exception as error:  # a failed background draft must never break saving the resume
        print(f"[ApplyDock auto email] could not draft: {type(error).__name__}", flush=True)
    finally:
        with _guard:
            _running.discard(entry_id)


def start(entry_id, background=True):
    """Begin drafting if this entry qualifies. Returns 'started' or 'skipped'."""
    entry = applications.get_entry(entry_id) if entry_id else None
    if not eligible(entry):
        return "skipped"
    with _guard:
        if entry_id in _running:
            return "started"
        _running.add(entry_id)
    if background:
        threading.Thread(target=_run, args=(entry_id,), daemon=True).start()
    else:
        _run(entry_id)
    return "started"
