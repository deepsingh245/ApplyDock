"""Gmail OAuth (PKCE, gmail.compose scope) and draft creation with the application's exact resume attached."""
from __future__ import annotations

import base64
import email.message
import hashlib
import hmac
import json
import re
import secrets
import time
import urllib.error
import urllib.parse
import urllib.request

from . import applications, config, database, events, resumes


GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.compose"


GMAIL_REDIRECT = f"http://{config.HOST}:{config.PORT}/oauth/google/callback"


GMAIL_ATTACHMENT_LIMIT = 18_000_000  # Gmail rejects messages above ~25 MB once base64-encoded


OAUTH_PENDING = {}


def configure_gmail_client(data):
    installed = data.get("installed", {})
    if not isinstance(installed, dict):
        raise ValueError("Choose a Google OAuth Desktop app client JSON file.")
    client_id = str(installed.get("client_id", "")).strip()
    client_secret = str(installed.get("client_secret", "")).strip()
    if not re.fullmatch(r"[A-Za-z0-9_-]+\.apps\.googleusercontent\.com", client_id):
        raise ValueError("Choose a Google OAuth Desktop app client JSON file.")
    if installed.get("auth_uri") != "https://accounts.google.com/o/oauth2/auth" or installed.get("token_uri") != "https://oauth2.googleapis.com/token":
        raise ValueError("OAuth endpoints in the client file are not Google's expected endpoints.")
    previous_id = config.SETTINGS.get("gmail_client_id")
    config.SETTINGS["gmail_client_id"] = client_id
    config.SETTINGS["gmail_client_secret"] = config.protect(client_secret) if client_secret else ""
    if previous_id != client_id:
        config.SETTINGS.pop("gmail_refresh_token", None)
        config.SETTINGS.pop("gmail_address", None)
    config.save_config(config.SETTINGS)


def begin_gmail_oauth():
    client_id = config.SETTINGS.get("gmail_client_id", "")
    if not client_id:
        raise ValueError("Add a Google OAuth Desktop app client JSON file first.")
    state = secrets.token_urlsafe(32)
    verifier = secrets.token_urlsafe(64)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    with database.LOCK:
        OAUTH_PENDING.clear()
        OAUTH_PENDING.update({"state": state, "verifier": verifier, "expires": time.time() + 600})
    query = urllib.parse.urlencode({
        "client_id": client_id, "redirect_uri": GMAIL_REDIRECT, "response_type": "code",
        "scope": GMAIL_SCOPE, "access_type": "offline", "prompt": "consent",
        "state": state, "code_challenge": challenge, "code_challenge_method": "S256"
    })
    return "https://accounts.google.com/o/oauth2/v2/auth?" + query


def google_token_request(fields):
    body = urllib.parse.urlencode(fields).encode()
    request = urllib.request.Request("https://oauth2.googleapis.com/token", data=body, method="POST",
        headers={"Content-Type": "application/x-www-form-urlencoded"})
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            return json.load(response)
    except urllib.error.HTTPError:
        raise RuntimeError("Google authorization failed. Reconnect Gmail and check your OAuth client setup.") from None


def gmail_api_request(method, path, access_token, payload=None):
    body = json.dumps(payload).encode() if payload is not None else None
    request = urllib.request.Request("https://gmail.googleapis.com/gmail/v1" + path, data=body, method=method,
        headers={"Authorization": "Bearer " + access_token, "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        if error.code == 404:
            raise ValueError("The Gmail draft is no longer in Drafts. Check Gmail Scheduled before creating another.") from None
        raise RuntimeError(f"Gmail request failed ({error.code}). Check the connected account and try again.") from None


def complete_gmail_oauth(query):
    state = query.get("state", [""])[0]
    with database.LOCK:
        pending = OAUTH_PENDING.copy()
        OAUTH_PENDING.clear()
    if not pending or time.time() > pending["expires"] or not hmac.compare_digest(state, pending["state"]):
        raise ValueError("This Gmail connection request expired. Start Connect Gmail again.")
    if query.get("error"):
        raise ValueError("Google authorization was cancelled or denied.")
    code = query.get("code", [""])[0]
    if not code:
        raise ValueError("Google did not return an authorization code.")
    fields = {
        "code": code, "client_id": config.SETTINGS["gmail_client_id"],
        "redirect_uri": GMAIL_REDIRECT, "grant_type": "authorization_code",
        "code_verifier": pending["verifier"]
    }
    secret = config.unprotect(config.SETTINGS.get("gmail_client_secret", ""))
    if secret:
        fields["client_secret"] = secret
    token = google_token_request(fields)
    if GMAIL_SCOPE not in token.get("scope", "").split():
        raise ValueError("Gmail draft permission was not granted.")
    if not token.get("refresh_token"):
        raise ValueError("Google did not return offline access. Reconnect and allow Gmail access.")
    profile = gmail_api_request("GET", "/users/me/profile", token["access_token"])
    address = str(profile.get("emailAddress", "")).strip()
    if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", address):
        raise RuntimeError("Could not verify the connected Gmail account.")
    config.SETTINGS["gmail_refresh_token"] = config.protect(token["refresh_token"])
    config.SETTINGS["gmail_address"] = address
    config.save_config(config.SETTINGS)
    return address


def gmail_access_token():
    refresh = config.unprotect(config.SETTINGS.get("gmail_refresh_token", ""))
    if not refresh:
        raise ValueError("Connect Gmail in Settings first.")
    fields = {"client_id": config.SETTINGS["gmail_client_id"], "refresh_token": refresh, "grant_type": "refresh_token"}
    secret = config.unprotect(config.SETTINGS.get("gmail_client_secret", ""))
    if secret:
        fields["client_secret"] = secret
    result = google_token_request(fields)
    if not result.get("access_token"):
        raise RuntimeError("Could not refresh Gmail access. Reconnect Gmail.")
    return result["access_token"]


def gmail_message(entry):
    """Build the Gmail draft MIME and return (raw, version) for the exact attached resume version."""
    _, resume, version = resumes.resume_file_for_entry(entry)
    content = resumes.attachment_bytes(resume, version)
    if len(content) > GMAIL_ATTACHMENT_LIMIT:
        raise ValueError("The resume is too large for a Gmail draft attachment. Use a smaller PDF.")
    msg = email.message.EmailMessage()
    msg["From"] = config.SETTINGS["gmail_address"]
    msg["To"] = entry["recipient"]
    msg["Subject"] = entry["subject"]
    msg.set_content(entry["body"])
    mime = "application/pdf" if resume.suffix.lower() == ".pdf" else "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    maintype, subtype = mime.split("/", 1)
    msg.add_attachment(content, maintype=maintype, subtype=subtype, filename=version["original_filename"])
    return base64.urlsafe_b64encode(msg.as_bytes()).decode().rstrip("="), version


def save_gmail_draft(entry_id, prepare_schedule=False):
    with database.LOCK, database.connect() as db:
        row = db.execute("SELECT * FROM entries WHERE id=?", (entry_id,)).fetchone()
        if not row:
            raise ValueError("Entry not found.")
        entry = dict(row)
        if entry["status"] in ("sending", "sent"):
            raise ValueError("This application is already sending or sent.")
        if entry["delivery_mode"] == "gmail_scheduled":
            raise ValueError("This item was marked scheduled in Gmail. Check Gmail before making another draft.")
        if not config.SETTINGS.get("gmail_refresh_token"):
            raise ValueError("Connect Gmail in Settings first.")
        if entry["gmail_draft_id"] and entry["gmail_account"] and entry["gmail_account"].lower() != config.SETTINGS.get("gmail_address", "").lower():
            raise ValueError("This draft belongs to a different Gmail account. Reconnect that account before updating it.")
        if entry["apply_method"] != "email":
            raise ValueError("Choose Email as the application method.")
        if not all(entry[k] for k in ("recipient", "subject", "body", "resume_id")):
            raise ValueError("Recipient, subject, body, and resume are required for a Gmail draft.")
        raw, attached_version = gmail_message(entry)
        stamp = config.now_iso()
        db.execute("UPDATE entries SET status='draft',updated_at=? WHERE id=? AND status NOT IN ('sending','sent')",
                   (stamp, entry_id))
    access_token = gmail_access_token()
    draft_id = entry["gmail_draft_id"]
    if draft_id and not re.fullmatch(r"[A-Za-z0-9_-]+", draft_id):
        raise ValueError("Saved Gmail draft ID is invalid.")
    if draft_id and entry["gmail_dirty"] == 0:
        gmail_api_request("GET", "/users/me/drafts/" + draft_id, access_token)
    elif draft_id:
        gmail_api_request("PUT", "/users/me/drafts/" + draft_id, access_token, {"message": {"raw": raw}})
    else:
        result = gmail_api_request("POST", "/users/me/drafts", access_token, {"message": {"raw": raw}})
        draft_id = result.get("id", "")
        if not re.fullmatch(r"[A-Za-z0-9_-]+", draft_id):
            raise RuntimeError("Gmail did not return a valid draft ID.")
    mode = "gmail_schedule_pending" if prepare_schedule else "gmail_draft"
    with database.LOCK, database.connect() as db:
        changed_during_export = db.execute("SELECT updated_at FROM entries WHERE id=?", (entry_id,)).fetchone()["updated_at"] != stamp
        db.execute("UPDATE entries SET delivery_mode=?,gmail_draft_id=?,gmail_account=?,gmail_dirty=?,status='draft',updated_at=? WHERE id=?",
                   (mode, draft_id, config.SETTINGS["gmail_address"], int(changed_during_export), config.now_iso(), entry_id))
        if draft_id and (entry["gmail_dirty"] or not entry["gmail_draft_id"]):
            # Record (and pin) exactly what the Gmail draft now contains.
            record = resumes.attachment_record(attached_version)
            db.execute("UPDATE entries SET resume_version_id=?,attachment_sha256=?,attachment_filename=?,attached_at=? WHERE id=?",
                       (attached_version["id"], record["attachment_sha256"], record["attachment_filename"], record["attached_at"], entry_id))
    events.application_changed(entry_id)
    if changed_during_export:
        raise ValueError("The local application changed during Gmail export. Update the Gmail draft before scheduling it.")
    return applications.get_entry(entry_id)


def mark_gmail_scheduled(entry_id):
    with database.LOCK, database.connect() as db:
        row = db.execute("SELECT * FROM entries WHERE id=?", (entry_id,)).fetchone()
        if not row or row["delivery_mode"] != "gmail_schedule_pending" or not row["gmail_draft_id"] or row["gmail_dirty"]:
            raise ValueError("Prepare an up-to-date Gmail draft before marking it scheduled.")
        db.execute("UPDATE entries SET delivery_mode='gmail_scheduled',updated_at=? WHERE id=?", (config.now_iso(), entry_id))
    return applications.get_entry(entry_id)
