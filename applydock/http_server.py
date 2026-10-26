"""Local HTTP API and dashboard file server.

Security model: the server binds to 127.0.0.1 only; every /api route requires the pairing key in
`X-Local-Key` (constant-time compare) plus a matching Host and, when present, a dashboard or
Chrome-extension Origin. The only exceptions are the Gmail OAuth callback and resume file links
that carry their own unguessable `?access=` token, so the browser can preview/download them.

Routes are registered with @route(method, pattern). A handler receives (request, match, data)
and returns a dict (sent as 200 JSON), a FileResponse, or calls request.respond() itself.
"""
from __future__ import annotations

import datetime as dt
import hmac
import html
import http.server
import json
from pathlib import Path
import re
import urllib.parse

from . import (ai_draft, applications, ats, career, config, database, delivery, events, gmail, notion, resume_model,
               resume_render, resume_store, resume_workflows, resumes, submissions)
from .resume_store import ConflictError

ROUTES = []   # (method, compiled pattern, handler)
STATIC_TYPES = {".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".woff2": "font/woff2"}


class NotFound(Exception):
    """Respond 404 with this message."""


class FileResponse:
    def __init__(self, content_type, payload, headers=None):
        self.content_type, self.payload, self.headers = content_type, payload, headers or {}


def route(method, pattern):
    def register(handler):
        ROUTES.append((method, re.compile(pattern), handler))
        return handler
    return register


def find_route(method, path):
    for route_method, pattern, handler in ROUTES:
        if route_method == method:
            match = pattern.fullmatch(path)
            if match:
                return handler, match
    return None, None


def allowed_origins():
    return (f"http://{config.HOST}:{config.PORT}", f"http://localhost:{config.PORT}")


def allowed_hosts():
    return (f"{config.HOST}:{config.PORT}", f"localhost:{config.PORT}")


def query_value(path, name, default=""):
    return urllib.parse.parse_qs(urllib.parse.urlsplit(path).query).get(name, [default])[0]


# ---------------------------------------------------------------- dispatch

def send_result(request, result):
    if isinstance(result, FileResponse):
        request.respond_bytes(200, result.content_type, result.payload, result.headers)
    elif result is not None:
        request.respond(200, result)


def handle_errors(request, call):
    try:
        send_result(request, call())
    except NotFound as error:
        request.respond(404, {"error": str(error) or "Not found."})
    except ConflictError as error:
        request.respond(409, {"error": str(error), "draft": error.draft})
    except (ValueError, KeyError) as error:
        request.respond(400, {"error": str(error)})
    except Exception as error:
        request.respond(500, {"error": str(error)})


def dispatch_get(request):
    path = urllib.parse.urlsplit(request.path)
    if serve_public_get(request, path):
        return
    if not request.authorized():
        return
    handler, match = find_route("GET", path.path)
    if not handler:
        request.respond(404, {"error": "Not found."})
        return
    handle_errors(request, lambda: handler(request, match, None))


def dispatch_mutation(request, method):
    if not request.authorized():
        return
    path = urllib.parse.urlsplit(request.path).path

    def call():
        handler, match = find_route(method, path)
        # DELETE routes take no body; every other mutation is JSON (read before routing, as before).
        if method == "DELETE" and handler:
            return handler(request, match, None)
        data = request.body()
        if not handler:
            raise NotFound("Not found.")
        return handler(request, match, data)
    handle_errors(request, call)


# ---------------------------------------------------------------- unauthenticated GETs

def serve_public_get(request, path):
    """OAuth callback, token-protected resume files, and dashboard files. Returns True when handled."""
    if path.path == "/oauth/google/callback":
        if request.headers.get("Host") != f"{config.HOST}:{config.PORT}":
            request.respond_html(403, "Invalid callback host.")
            return True
        try:
            address = gmail.complete_gmail_oauth(urllib.parse.parse_qs(path.query))
            request.respond_html(200, f"Connected Gmail account: {address}.")
        except Exception as error:
            request.respond_html(400, str(error))
        return True
    file_match = re.fullmatch(r"/api/resumes/([a-f0-9-]+)/file", path.path)
    if file_match:
        serve_current_resume_file(request, file_match.group(1), urllib.parse.parse_qs(path.query))
        return True
    version_match = re.fullmatch(r"/api/resumes/([a-f0-9-]+)/versions/([a-f0-9-]+)/file", path.path)
    if version_match:
        serve_version_file(request, *version_match.groups(), urllib.parse.parse_qs(path.query))
        return True
    submission_match = re.fullmatch(r"/api/submissions/([a-f0-9-]+)/file", path.path)
    if submission_match:
        serve_submission_file(request, submission_match.group(1), urllib.parse.parse_qs(path.query))
        return True
    static_file = dashboard_file(path.path)
    if static_file:
        content = static_file.read_bytes()
        request.send_response(200)
        request.send_header("Content-Type", STATIC_TYPES[static_file.suffix])
        request.send_header("Content-Length", str(len(content)))
        # Fonts never change between releases; scripts and styles must always be fresh.
        request.send_header("Cache-Control", "max-age=31536000, immutable" if static_file.suffix == ".woff2" else "no-store")
        request.send_header("X-Content-Type-Options", "nosniff")
        request.end_headers()
        request.wfile.write(content)
        return True
    return False


def dashboard_file(url_path):
    """Map "/" and dashboard asset paths to files inside dashboard/, refusing anything outside it."""
    if url_path == "/":
        return config.DASHBOARD_DIR / "index.html"
    if url_path.startswith("/api/") or Path(url_path).suffix not in (".js", ".css", ".woff2"):
        return None
    root = config.DASHBOARD_DIR.resolve()
    candidate = (root / url_path.lstrip("/")).resolve()
    return candidate if candidate.is_relative_to(root) and candidate.is_file() else None


def serve_current_resume_file(request, resume_id, query):
    if request.headers.get("Host") not in allowed_hosts():
        request.respond(403, {"error": "Invalid host."})
        return
    resume = resumes.get_resume(resume_id, include_deleted=False, include_token=True)
    supplied_token = query.get("access", [""])[0]
    key_ok = hmac.compare_digest(request.headers.get("X-Local-Key", ""), config.SETTINGS["pairing_key"])
    token_ok = bool(resume and supplied_token and hmac.compare_digest(supplied_token, resume["access_token"]))
    if not resume or not resume["available"]:
        request.respond(404, {"error": "Resume file is unavailable."})
        return
    if not (key_ok or token_ok):
        request.respond(401, {"error": "Resume access is required."})
        return
    file_path = (config.DATA / resume["stored_path"]).resolve()
    if not file_path.is_relative_to((config.DATA / "resumes").resolve()) or not file_path.is_file():
        request.respond(404, {"error": "Resume file is unavailable."})
        return
    content = file_path.read_bytes()
    disposition = "attachment" if query.get("download", [""])[0] == "1" else "inline"
    if disposition == "inline" and query.get("preview", [""])[0] == "1" and resume["mime_type"].endswith("wordprocessingml.document"):
        preview = resumes.docx_preview(content, resume["original_filename"])
        request.send_response(200)
        request.cors()
        request.send_header("Content-Type", "text/html; charset=utf-8")
        request.send_header("Content-Length", str(len(preview)))
        request.send_header("Cache-Control", "private, no-store")
        request.send_header("Referrer-Policy", "no-referrer")
        request.send_header("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'")
        request.send_header("X-Content-Type-Options", "nosniff")
        request.end_headers()
        request.wfile.write(preview)
        return
    request.respond_bytes(200, resume["mime_type"], content, {
        "Content-Disposition": f"{disposition}; filename*=UTF-8''{urllib.parse.quote(resume['original_filename'])}",
        "Referrer-Policy": "no-referrer"})


def serve_version_file(request, resume_id, version_id, query):
    # One exact, immutable version. Its token never rotates; the resume's current-file token is not accepted here.
    if request.headers.get("Host") not in allowed_hosts():
        request.respond(403, {"error": "Invalid host."})
        return
    with database.connect() as db:
        version = ats.version_by_id(db, version_id)
    resume = resumes.get_resume(resume_id, include_deleted=False)
    supplied_token = query.get("access", [""])[0]
    key_ok = hmac.compare_digest(request.headers.get("X-Local-Key", ""), config.SETTINGS["pairing_key"])
    if not resume or not version or version["resume_id"] != resume_id:
        request.respond(404, {"error": "Resume version is unavailable."})
        return
    if not (key_ok or (supplied_token and hmac.compare_digest(supplied_token, version["access_token"]))):
        request.respond(401, {"error": "Resume access is required."})
        return
    file_path = (config.DATA / version["stored_path"]).resolve()
    if not file_path.is_relative_to((config.DATA / "resumes").resolve()) or not file_path.is_file():
        request.respond(404, {"error": "Resume version is unavailable."})
        return
    disposition = "attachment" if query.get("download", [""])[0] == "1" else "inline"
    request.respond_bytes(200, version["mime_type"], file_path.read_bytes(), {
        "Content-Disposition": f"{disposition}; filename*=UTF-8''{urllib.parse.quote(version['original_filename'])}",
        "Referrer-Policy": "no-referrer"})


def serve_submission_file(request, submission_id, query):
    # The exact file recorded as submitted. It stays available after the resume itself is deleted or edited.
    if request.headers.get("Host") not in allowed_hosts():
        request.respond(403, {"error": "Invalid host."})
        return
    with database.connect() as db:
        row, file_path = submissions.file_for(db, config.DATA, submission_id)
    supplied_token = query.get("access", [""])[0]
    key_ok = hmac.compare_digest(request.headers.get("X-Local-Key", ""), config.SETTINGS["pairing_key"])
    if not row or not file_path:
        request.respond(404, {"error": "The submitted file is unavailable."})
        return
    if not (key_ok or (supplied_token and hmac.compare_digest(supplied_token, row["access_token"]))):
        request.respond(401, {"error": "Resume access is required."})
        return
    disposition = "attachment" if query.get("download", [""])[0] == "1" else "inline"
    request.respond_bytes(200, row["mime_type"], file_path.read_bytes(), {
        "Content-Disposition": f"{disposition}; filename*=UTF-8''{urllib.parse.quote(row['filename'])}",
        "Referrer-Policy": "no-referrer"})


# ---------------------------------------------------------------- state and settings

@route("GET", r"/api/state")
def get_state(request, match, data):
    settings = config.SETTINGS
    return {
        "entries": applications.entries(), "resumes": resumes.resumes(),
        "application_stage_options": applications.application_stage_options(),
        "notion_connected": bool(settings.get("notion_token") and settings.get("notion_data_source_id")),
        "notion_data_source_id": settings.get("notion_data_source_id", ""),
        "notion_sync_checked_at": notion.NOTION_CHECK_STATE["checked_at"],
        "notion_sync_error": notion.NOTION_CHECK_STATE["error"],
        "smtp": {k: v for k, v in settings.get("smtp", {}).items() if k != "password"},
        "smtp_connected": bool(settings.get("smtp_verified")),
        "gmail_client_ready": bool(settings.get("gmail_client_id")),
        "gmail_client_id": settings.get("gmail_client_id", ""),
        "gmail_connected": bool(settings.get("gmail_refresh_token")),
        "gmail_address": settings.get("gmail_address", ""),
        "candidate_profile": settings.get("candidate_profile", ""),
        "profile_saved": bool(settings.get("candidate_profile_saved", settings.get("candidate_profile"))),
        "codex": ats.codex_status(),
        "ats_usage": ats.usage_summary(config.DB),
        "local_time": dt.datetime.now().astimezone().isoformat(),
        "profile_hash": career.profile_hash(),
    }


@route("GET", r"/api/settings/codex")
def get_codex_settings(request, match, data):
    return {"codex": ats.codex_status(), "usage": ats.usage_summary(config.DB)}


@route("POST", r"/api/settings/codex/check")
def check_codex(request, match, data):
    return {"codex": ats.codex_status(force=True), "usage": ats.usage_summary(config.DB)}


@route("POST", r"/api/settings/notion")
def save_notion_settings(request, match, data):
    settings = config.SETTINGS
    source_id = re.sub(r"[^a-fA-F0-9-]", "", str(data.get("data_source_id", "")))
    token = str(data.get("token", "")).strip()
    if not source_id or not (token or settings.get("notion_token")):
        raise ValueError("Notion token and data source ID are required.")
    previous = settings.copy()
    try:
        if token:
            settings["notion_token"] = config.protect(token)
        mapping = notion.ensure_notion_schema(source_id)
        settings["notion_data_source_id"] = source_id
        settings["notion_mapping"] = mapping
        config.save_config(settings)
    except Exception:
        settings.clear()
        settings.update(previous)
        raise
    for entry in applications.entries():
        notion.sync_entry(entry["id"])
    return {"ok": True}


@route("POST", r"/api/settings/smtp")
def save_smtp_settings(request, match, data):
    new_settings, actual_password = delivery.prepare_smtp_settings(data)
    delivery.test_smtp_login(new_settings, actual_password)
    config.SETTINGS["smtp"] = {**new_settings, "password": config.protect(actual_password)}
    config.SETTINGS["smtp_verified"] = True
    config.save_config(config.SETTINGS)
    with database.connect() as db:
        db.execute("UPDATE entries SET status='draft',updated_at=? WHERE status='approved'", (config.now_iso(),))
    return {"ok": True}


@route("POST", r"/api/settings/gmail/client")
def save_gmail_client(request, match, data):
    gmail.configure_gmail_client(data)
    return {"ok": True}


@route("POST", r"/api/settings/gmail/connect")
def connect_gmail(request, match, data):
    return {"authorization_url": gmail.begin_gmail_oauth()}


@route("POST", r"/api/settings/profile")
def save_profile(request, match, data):
    config.SETTINGS["candidate_profile"] = str(data.get("profile", "")).strip()[:4000]
    config.SETTINGS["candidate_profile_saved"] = True
    config.save_config(config.SETTINGS)
    return {"ok": True}


@route("POST", r"/api/sync")
def sync_all(request, match, data):
    reconciliation = notion.reconcile_notion_deletions(force=True)
    for entry in applications.entries():
        notion.sync_entry(entry["id"])
    return {"entries": applications.entries(), "reconciliation": reconciliation}


# ---------------------------------------------------------------- applications

@route("POST", r"/api/capture")
def capture(request, match, data):
    entry, duplicate = applications.capture(data)
    if not duplicate:
        events.application_changed(entry["id"])
    return {"entry": applications.get_entry(entry["id"]), "duplicate": duplicate}


@route("PATCH", r"/api/entries/([a-f0-9-]+)")
def update_entry(request, match, data):
    entry = applications.update_entry(match.group(1), data)
    events.application_changed(entry["id"])
    return {"entry": applications.get_entry(entry["id"])}


@route("DELETE", r"/api/entries/([a-f0-9-]+)")
def delete_entry(request, match, data):
    if not applications.delete_local_entry(match.group(1)):
        raise ValueError("Entry not found or currently sending. No Notion page was changed.")
    return {"ok": True, "notion_unchanged": True}


@route("POST", r"/api/entries/([a-f0-9-]+)/ai-draft")
def write_ai_draft(request, match, data):
    entry = applications.get_entry(match.group(1))
    if not entry:
        raise ValueError("Entry not found.")
    if entry["status"] in ("sending", "sent"):
        raise ValueError("This application has already been sent or is sending.")
    return {"draft": ai_draft.generate_ai_draft(entry)}


@route("POST", r"/api/entries/([a-f0-9-]+)/(gmail-draft|gmail-prepare|gmail-scheduled)")
def gmail_action(request, match, data):
    entry_id, action = match.groups()
    if action == "gmail-scheduled":
        return {"entry": gmail.mark_gmail_scheduled(entry_id)}
    return {"entry": gmail.save_gmail_draft(entry_id, prepare_schedule=action == "gmail-prepare")}


@route("POST", r"/api/entries/([a-f0-9-]+)/tailor")
def tailor_resume(request, match, data):
    resume, created = resume_workflows.tailor_resume(match.group(1), str(data.get("base_resume_id", "")))
    return {"resume": resume, "created": created}


@route("POST", r"/api/entries/([a-f0-9-]+)/pin-resume")
def pin_resume(request, match, data):
    entry_id = match.group(1)
    fields = {"resume_id": str(data.get("resume_id", ""))}
    if "resume_version_id" in data:
        fields["resume_version_id"] = str(data.get("resume_version_id") or "")
    else:
        current = resumes.get_resume(fields["resume_id"])
        fields["resume_version_id"] = current["current_version_id"] if current else ""
    applications.update_entry(entry_id, fields)
    events.application_changed(entry_id)
    return {"entry": applications.get_entry(entry_id)}


# ---------------------------------------------------------------- ATS analysis

@route("GET", r"/api/analyses/queue")
def analysis_queue(request, match, data):
    return {"queue": ats.analysis_queue(config.DB)}


@route("GET", r"/api/analyses/([a-f0-9-]+)")
def get_analysis(request, match, data):
    analysis = ats.get_analysis(config.DB, match.group(1))
    if not analysis:
        raise NotFound("Analysis not found.")
    return {"analysis": analysis}


@route("GET", r"/api/entries/([a-f0-9-]+)/analyses")
def analysis_history(request, match, data):
    if not applications.get_entry(match.group(1)):
        raise NotFound("Application not found.")
    return {"analyses": ats.analysis_history(config.DB, match.group(1))}


@route("POST", r"/api/entries/([a-f0-9-]+)/analyses")
def queue_analysis(request, match, data):
    entry = applications.get_entry(match.group(1))
    if not entry:
        raise ValueError("Application not found.")
    candidate = str(data.get("resume_version_id") or "")
    if candidate and not resume_workflows.candidate_version_allowed(entry, candidate):
        raise ValueError("That resume version does not belong to this application.")
    # The Master Profile is compared too (as a snapshot), unless the request opts out.
    blocks = career.profile_evidence() if data.get("use_profile", True) else []
    run, cached = ats.queue_analysis(config.DB, entry, retry=bool(data.get("retry")), require_codex=True, resume_version_id=candidate,
                                     profile_blocks=blocks)
    events.application_changed(entry["id"])
    return {"analysis": ats.get_analysis(config.DB, run["id"]), "cached": cached}


@route("PATCH", r"/api/analyses/([a-f0-9-]+)/recommendations/([A-Za-z0-9_-]+)")
def update_checklist(request, match, data):
    ats.update_checklist(config.DB, match.group(1), match.group(2), str(data.get("state", "")))
    return {"analysis": ats.get_analysis(config.DB, match.group(1))}


@route("POST", r"/api/analyses/([a-f0-9-]+)/suggestions")
def queue_suggestions(request, match, data):
    return resume_workflows.queue_suggestions(match.group(1), str(data.get("resume_id", "")))


# ---------------------------------------------------------------- resume library

@route("POST", r"/api/resumes?")
def create_resume(request, match, data):
    if match.group(0) == "/api/resume":   # legacy extension endpoint
        data = {**data, "filename": data.get("name"), "display_name": Path(str(data.get("name", "Resume"))).stem}
    resume = resumes.create_resume(data)
    internal = resumes.get_resume(resume["id"], include_token=True)
    return {"resume": resume, "resume_id": resume["id"], "resume_path": internal["stored_path"]}


@route("PATCH", r"/api/resumes/([a-f0-9-]+)")
def update_resume(request, match, data):
    return {"resume": resumes.update_resume(match.group(1), data)}


@route("DELETE", r"/api/resumes/([a-f0-9-]+)")
def delete_resume(request, match, data):
    return {"ok": True, "applications_needing_resume": resumes.delete_resume(match.group(1))}


@route("GET", r"/api/resumes/([a-f0-9-]+)/versions")
def list_versions(request, match, data):
    if not resumes.get_resume(match.group(1), include_deleted=True):
        raise NotFound("Resume not found.")
    return {"versions": ats.list_versions(config.DB, config.DATA, match.group(1))}


@route("POST", r"/api/resumes/([a-f0-9-]+)/versions")
def upload_version(request, match, data):
    resume = resumes.update_resume(match.group(1), {"filename": data.get("filename"), "content": data.get("content")})
    return {"resume": resume, "versions": ats.list_versions(config.DB, config.DATA, resume["id"])}


@route("POST", r"/api/resumes/([a-f0-9-]+)/versions/([a-f0-9-]+)/restore")
def restore_version(request, match, data):
    resume = resumes.restore_version(*match.groups())
    return {"resume": resume, "versions": ats.list_versions(config.DB, config.DATA, resume["id"])}


@route("GET", r"/api/resumes/([a-f0-9-]+)/versions/([a-f0-9-]+)/content")
def version_content(request, match, data):
    resume_id, version_id = match.groups()
    compare_with = query_value(request.path, "draft_of", resume_id)
    with database.connect() as db:
        content = resume_store.version_content(db, version_id)
        draft = resume_store.get_draft(db, compare_with)
    if not content or content["resume_id"] != resume_id:
        raise NotFound("Version not found.")
    changes = resume_model.diff(resume_model.normalize(content["content"]), draft["content"]) if content["content"] and draft else None
    return {"version": content, "changes_to_draft": changes}


# ---------------------------------------------------------------- resume editor

@route("GET", r"/api/resumes/([a-f0-9-]+)/draft")
def get_editor_state(request, match, data):
    return resume_workflows.editor_state(match.group(1))


@route("PATCH", r"/api/resumes/([a-f0-9-]+)/draft")
def save_draft(request, match, data):
    with database.LOCK, database.connect() as db:
        draft = resume_store.save_draft(db, match.group(1), data.get("content"), data.get("expected_revision"),
                                        reviewed=data.get("reviewed") is True)
    return {"draft": draft}


@route("POST", r"/api/resumes/([a-f0-9-]+)/draft/import")
def import_draft(request, match, data):
    return resume_workflows.import_draft(match.group(1), str(data.get("mode", "")), data.get("expected_revision"))


@route("POST", r"/api/resumes/([a-f0-9-]+)/draft/reset")
def reset_draft(request, match, data):
    return {"draft": resume_workflows.reset_draft(match.group(1), data.get("expected_revision"), str(data.get("version_id", "")))}


@route("POST", r"/api/resumes/([a-f0-9-]+)/draft/(preview|validate|fit)")
def render_draft(request, match, data):
    resume_id, action = match.groups()
    if not resumes.get_resume(resume_id):
        raise ValueError("Resume not found.")
    content = resume_model.normalize(data.get("content") or {})
    if action == "fit":
        return resume_render.fit_to_pages(content, int(data.get("page_limit") or content["meta"]["page_limit"] or 1))
    pdf = resume_render.render(content)
    if action == "preview":
        return FileResponse("application/pdf", pdf, {"X-Page-Count": str(resume_render.page_count(pdf))})
    return {"validation": resume_render.validate(pdf, content)}


@route("GET", r"/api/resumes/([a-f0-9-]+)/draft/profile-entries")
def draft_profile_entries(request, match, data):
    return resume_workflows.profile_entries(match.group(1))


@route("POST", r"/api/resumes/([a-f0-9-]+)/draft/add-from-profile")
def add_from_profile(request, match, data):
    return resume_workflows.add_from_profile(match.group(1), data.get("key", ""), data.get("expected_revision"),
                                             bool(data.get("confirm_unverified")), bool(data.get("replace")))


@route("POST", r"/api/resumes/([a-f0-9-]+)/draft/analyze")
def analyze_draft(request, match, data):
    return resume_workflows.analyze_draft(match.group(1), str(data.get("entry_id", "")), data.get("expected_revision"))


@route("POST", r"/api/resumes/([a-f0-9-]+)/versions/from-draft")
def save_editor_version(request, match, data):
    return resume_workflows.save_editor_version(match.group(1), data.get("expected_revision"), data.get("label", ""))


@route("GET", r"/api/resume-jobs/([a-f0-9-]+)")
def get_job(request, match, data):
    with database.connect() as db:
        job = resume_store.get_job(db, match.group(1))
    if not job:
        raise NotFound("Job not found.")
    return {"job": job}


@route("GET", r"/api/resumes/([a-f0-9-]+)/suggestions")
def list_suggestions(request, match, data):
    with database.connect() as db:
        return {"suggestions": resume_store.list_suggestions(db, match.group(1), query_value(request.path, "analysis_id"))}


@route("POST", r"/api/resume-suggestions/([a-f0-9-]+)/accept")
def accept_suggestion(request, match, data):
    with database.LOCK, database.connect() as db:
        draft, suggestion = resume_store.accept_suggestion(db, match.group(1), data.get("expected_revision"),
                                                           data.get("text"), data.get("confirm_verified") is True)
    return {"draft": draft, "suggestion": suggestion}


@route("POST", r"/api/resume-suggestions/([a-f0-9-]+)/revert")
def revert_suggestion(request, match, data):
    with database.LOCK, database.connect() as db:
        draft, suggestion = resume_store.revert_suggestion(db, match.group(1), data.get("expected_revision"))
    return {"draft": draft, "suggestion": suggestion}


@route("PATCH", r"/api/resume-suggestions/([a-f0-9-]+)")
def update_suggestion(request, match, data):
    with database.LOCK, database.connect() as db:
        suggestion = resume_store.set_suggestion_status(db, match.group(1), str(data.get("status", "")))
    return {"draft": None, "suggestion": suggestion}


# ---------------------------------------------------------------- Master Profile

@route("GET", r"/api/profile")
def get_profile(request, match, data):
    return {"profile": career.get_profile()}


@route("PATCH", r"/api/profile/personal")
def save_personal(request, match, data):
    return {"profile": career.save_personal(data)}


@route("POST", r"/api/profile/items")
def create_profile_item(request, match, data):
    return career.create_item(data)


@route("PATCH", r"/api/profile/items/([a-f0-9-]+)")
def update_profile_item(request, match, data):
    return career.update_item(match.group(1), data)


@route("DELETE", r"/api/profile/items/([a-f0-9-]+)")
def delete_profile_item(request, match, data):
    return career.delete_item(match.group(1))


@route("POST", r"/api/profile/import")
def import_profile(request, match, data):
    return career.import_from_resume(str(data.get("resume_id", "")), data.get("verified", True))


@route("POST", r"/api/profile/verify-links")
def verify_profile_links(request, match, data):
    return career.verify_links(str(data.get("item_id") or ""))


# ---------------------------------------------------------------- submission history

@route("GET", r"/api/entries/([a-f0-9-]+)/submissions")
def list_submissions(request, match, data):
    return career.entry_submissions(match.group(1))


@route("POST", r"/api/entries/([a-f0-9-]+)/submissions")
def record_submission(request, match, data):
    return career.record_submission(match.group(1), data)


@route("GET", r"/api/resumes/([a-f0-9-]+)/usage")
def resume_usage(request, match, data):
    return career.resume_usage(match.group(1))


# ---------------------------------------------------------------- request handler

class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        # API paths can carry ids and tokens; keep them out of the console.
        if not self.path.startswith(("/api/", "/oauth/google/callback")):
            super().log_message(format, *args)

    def cors(self):
        origin = self.headers.get("Origin", "")
        if origin.startswith("chrome-extension://") or origin in allowed_origins():
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Allow-Headers", "Content-Type, X-Local-Key")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS")
            self.send_header("Access-Control-Expose-Headers", "X-Page-Count")

    def respond(self, code, data):
        payload = json.dumps(data).encode()
        self.send_response(code)
        self.cors()
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(payload)

    def respond_bytes(self, code, content_type, payload, headers=None):
        self.send_response(code)
        self.cors()
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "private, no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        for name, value in (headers or {}).items():
            self.send_header(name, value)
        self.end_headers()
        self.wfile.write(payload)

    def respond_html(self, code, message):
        content = ("<!doctype html><meta charset='utf-8'><title>Gmail connection</title>"
                   "<main style='font:16px system-ui;max-width:34rem;margin:4rem auto;line-height:1.5'>"
                   "<h1>Gmail connection</h1><p>" + html.escape(message) +
                   f"</p><p><a href='http://{config.HOST}:{config.PORT}/'>Return to the local dashboard</a>, or close this tab and return to the Applications sidebar.</p></main>").encode()
        self.send_response(code)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(content)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'")
        self.end_headers()
        self.wfile.write(content)

    def do_OPTIONS(self):
        self.send_response(204)
        self.cors()
        self.end_headers()

    def authorized(self):
        if self.headers.get("Host") not in allowed_hosts():
            self.respond(403, {"error": "Invalid host."})
            return False
        origin = self.headers.get("Origin", "")
        if origin and not (origin.startswith("chrome-extension://") or origin in allowed_origins()):
            self.respond(403, {"error": "Invalid origin."})
            return False
        if not hmac.compare_digest(self.headers.get("X-Local-Key", ""), config.SETTINGS["pairing_key"]):
            self.respond(401, {"error": "Pairing key required."})
            return False
        return True

    def body(self):
        if self.headers.get("Content-Type", "").split(";", 1)[0] != "application/json":
            raise ValueError("Expected application/json.")
        length = int(self.headers.get("Content-Length", "0"))
        if length < 1 or length > config.MAX_REQUEST_BYTES:
            raise ValueError("Request too large or empty.")
        return json.loads(self.rfile.read(length))

    def do_GET(self):
        dispatch_get(self)

    def do_POST(self):
        self.mutate("POST")

    def do_PATCH(self):
        self.mutate("PATCH")

    def do_DELETE(self):
        self.mutate("DELETE")

    def mutate(self, method):
        dispatch_mutation(self, method)
