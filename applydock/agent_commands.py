"""Compact, local agent operations composed from ApplyDock's existing domain workflows."""
from __future__ import annotations

import datetime as dt

from . import applications, ats, auto_email, career, config, database, resume_model, resume_store, resume_workflows, resumes


def _job_state(status, updated_at, started_at=""):
    if status == "cancelled": return "cancelled"
    if status in ("failed", "plan_limit", "insufficient_jd"): return "failed"
    if status == "complete": return "done"
    stamp = updated_at or started_at
    try:
        age = (dt.datetime.now(dt.timezone.utc) - dt.datetime.fromisoformat(stamp.replace("Z", "+00:00"))).total_seconds()
    except (AttributeError, ValueError, TypeError):
        age = 0
    return "stuck" if age > ats.JOB_STUCK_MINUTES * 60 else "running"


def applications_list(status="", q=""):
    query = str(q or "").casefold()
    result = []
    for entry in applications.entries():
        ident = applications.identity(entry)
        if status and entry.get("status") != status:
            continue
        if query and query not in (ident["label"] + " " + str(entry.get("excerpt", ""))).casefold():
            continue
        resume = entry.get("resume") or {}
        result.append({"identity": ident, "status": entry.get("status"), "stage": entry.get("application_stage"),
                       "delivery": entry.get("delivery_mode"), "resume": {k: resume.get(k) for k in ("id", "name", "kind", "available")},
                       "analysis_score": (entry.get("analysis") or {}).get("overall_score")})
    return result


def application_get(entry_id):
    entry = applications.get_entry(entry_id)
    if not entry:
        raise ValueError("Application not found.")
    analysis = entry.get("analysis") or {}
    resume = entry.get("resume") or {}
    return {"identity": applications.identity(entry), "status": entry.get("status"),
            "email_preview": {"to": entry.get("recipient", ""), "subject": entry.get("subject", ""),
                              "body": (entry.get("body", "")[:300] + ("…" if len(entry.get("body", "")) > 300 else ""))},
            "resume": {k: resume.get(k) for k in ("id", "name", "kind", "available")}, "resume_version": entry.get("resume_version"),
            "analysis": {k: analysis.get(k) for k in ("status", "overall_score", "label", "stale")},
            "available_commands": ["analysis_run", "resume_tailor", "resume_edit", "resume_save_and_attach", "email_preview"]}


def analysis_run(entry_id):
    entry = applications.get_entry(entry_id)
    if not entry:
        raise ValueError("Application not found.")
    run, cached = ats.queue_analysis(config.DB, entry, require_codex=True, profile_blocks=career.profile_evidence())
    return {"job_id": run["id"], "status": run["status"], "cached": cached}


def analysis_summary(analysis_id):
    analysis = ats.get_analysis(config.DB, analysis_id)
    if not analysis:
        raise ValueError("Analysis not found.")
    data = analysis.get("result") or {}
    requirements = [{"id": item.get("id"), "text": item.get("requirement"), "met": item.get("status"),
                     "evidence": [ev.get("text", "")[:300] for ev in item.get("resume_evidence", [])[:4]]}
                    for item in data.get("requirements", [])]
    return {"id": analysis_id, "status": analysis.get("status"), "score": analysis.get("overall_score"),
            "label": analysis.get("label"), "requirements": requirements,
            "gaps": [item for item in requirements if item["met"] in ("missing", "uncertain")],
            "missing_mandatory": analysis.get("missing_mandatory", 0)}


def resume_tailor(entry_id, base_resume_id):
    resume, created = resume_workflows.tailor_resume(entry_id, base_resume_id)
    return {"resume_id": resume["id"], "created": created}


def resume_edit(resume_id, content, expected_revision):
    with database.connect() as db:
        old = resume_store.get_draft(db, resume_id)
    if not old:
        raise ValueError("Open the resume in the editor first.")
    normalized = resume_model.normalize(content)
    changed = []
    def walk(a, b, path=""):
        if isinstance(a, dict) and isinstance(b, dict):
            for key in sorted(set(a) | set(b)):
                walk(a.get(key), b.get(key), f"{path}.{key}" if path else key)
        elif isinstance(a, list) and isinstance(b, list):
            if a != b: changed.append(path)
        elif a != b:
            changed.append(path)
    walk(old["content"], normalized)
    updated = resume_workflows.save_draft(resume_id, normalized, expected_revision)
    return {"revision": updated["revision"], "changed_fields": changed}


def resume_save_and_attach(resume_id, application_id, expected_revision):
    resume = resumes.get_resume(resume_id)
    entry = applications.get_entry(application_id)
    if not resume or not entry:
        raise ValueError("Resume or application not found.")
    ident = applications.identity(entry)
    if resume.get("kind") == "tailored" and resume.get("entry_id") != application_id:
        raise ValueError("That tailored resume belongs to a different application.")
    if entry.get("status") in ("sending", "sent") or entry.get("delivery_mode") == "gmail_scheduled":
        raise ValueError("This application is locked while sending or scheduled in Gmail.")
    saved = resume_workflows.save_editor_version(resume_id, expected_revision)
    applications.update_entry(application_id, {"resume_id": resume_id, "resume_version_id": saved["version_id"]})
    from . import events
    events.application_changed(application_id)
    with database.connect() as db:
        draft = resume_store.get_draft(db, resume_id)
        version = resume_store.version_content(db, saved["version_id"])
    synced = bool(saved.get("draft_in_sync", draft and version and resume_model.content_hash(draft["content"]) == resume_model.content_hash(version["content"])))
    latest = applications.get_entry(application_id)
    return {"version_id": saved["version_id"], "version_number": saved["version_number"], "created": saved["created"],
            "unchanged": saved["unchanged"], "draft_in_sync": synced, "validation": saved["validation"],
            "attached": {"application_id": application_id, "identity": ident, "resume_version_id": latest.get("resume_version_id") or saved["version_id"],
                         "pinned": bool(latest.get("resume_version_id"))}, "sha256": saved["sha256"]}


def email_preview(entry_id):
    entry = applications.get_entry(entry_id)
    if not entry:
        raise ValueError("Application not found.")
    draft = auto_email.build_draft(entry)
    resume = entry.get("resume_version") or {}
    attachment = None
    if resume:
        attachment = {"filename": resume.get("filename"), "sha256": resume.get("sha256"), "version_id": resume.get("id")}
    sender = (config.SETTINGS.get("smtp") or {}).get("from", "")
    recipient = entry.get("recipient") or next(iter(entry.get("contact_emails") or []), "")
    warnings = []
    if not recipient:
        warnings.append("No recipient is set.")
    if not attachment:
        warnings.append("No saved resume version is attached.")
    return {"from": sender, "to": recipient, "subject": draft.get("subject", ""),
            "body": draft.get("body", ""), "attachment": attachment, "warnings": warnings}


def job_status(job_id):
    analysis = ats.get_analysis(config.DB, job_id)
    if analysis:
        latest = (analysis.get("events") or [{}])[-1]
        return {"id": job_id, "kind": "analysis", "status": analysis["status"], "percent": analysis.get("progress_percent", 0),
                "stage": analysis.get("progress_stage", ""), "started_at": analysis.get("started_at", ""),
                "updated_at": latest.get("created_at", ""), "state": _job_state(analysis["status"], latest.get("created_at", ""), analysis.get("started_at", ""))}
    with database.connect() as db:
        row = db.execute("SELECT * FROM resume_ai_jobs WHERE id=?", (job_id,)).fetchone()
        job = resume_store.public_job(row)
    if not job:
        raise ValueError("Job not found.")
    with ats._JOB_PROGRESS_LOCK:
        progress_at = ats._JOB_PROGRESS_AT.get(job_id)
    started = row["started_at"]
    updated = progress_at or started or job["created_at"]
    return {"id": job_id, "kind": "resume", "status": job["status"], "percent": job["percent"],
            "stage": job["message"], "started_at": started, "updated_at": job["completed_at"] or updated,
            "state": _job_state(job["status"], updated, started)}


def job_logs(job_id):
    analysis = ats.get_analysis(config.DB, job_id)
    if analysis:
        return {"logs": analysis.get("events", [])}
    with database.connect() as db:
        job = resume_store.get_job(db, job_id)
    if not job:
        raise ValueError("Job not found.")
    return {"logs": [{"stage": job["status"], "message": job["message"], "percent": job["percent"]}]}


def job_cancel(job_id):
    result = ats.cancel_job(config.DB, job_id)
    if result is None:
        raise ValueError("Job not found.")
    return result


def _input(properties, required=()):
    return {"type": "object", "properties": properties, "required": list(required)}


_ID = {"id": {"type": "string", "description": "The application, resume, analysis, or job ID for this command."}}
COMMANDS = {
    "applications_list": {"method": "GET", "path": "/api/agent/applications", "summary": "List applications with stable identities", "call": applications_list,
                          "input_schema": _input({"status": {"type": "string"}, "q": {"type": "string"}})},
    "application_get": {"method": "GET", "path": "/api/agent/applications/{id}", "summary": "Get compact application context", "call": application_get,
                         "input_schema": _input(_ID, ("id",))},
    "analysis_run": {"method": "POST", "path": "/api/agent/applications/{id}/analysis", "summary": "Queue an analysis", "call": analysis_run,
                     "input_schema": _input(_ID, ("id",))},
    "analysis_summary": {"method": "GET", "path": "/api/agent/analyses/{id}", "summary": "Get an analysis summary", "call": analysis_summary,
                         "input_schema": _input(_ID, ("id",))},
    "resume_tailor": {"method": "POST", "path": "/api/agent/applications/{id}/tailor", "summary": "Create a tailored resume", "call": resume_tailor,
                      "input_schema": _input({**_ID, "base_resume_id": {"type": "string"}}, ("id",))},
    "resume_edit": {"method": "PATCH", "path": "/api/agent/resumes/{id}/draft", "summary": "Save a revision checked draft edit", "call": resume_edit,
                    "input_schema": _input({**_ID, "content": {"type": "object"}, "expected_revision": {"type": "integer"}}, ("id", "content", "expected_revision"))},
    "resume_save_and_attach": {"method": "POST", "path": "/api/agent/resumes/{id}/save", "summary": "Save a version and attach it", "call": resume_save_and_attach,
                               "input_schema": _input({**_ID, "application_id": {"type": "string"}, "expected_revision": {"type": "integer"}}, ("id", "application_id", "expected_revision"))},
    "email_preview": {"method": "GET", "path": "/api/agent/applications/{id}/email-preview", "summary": "Prepare an email preview without sending", "call": email_preview,
                      "input_schema": _input(_ID, ("id",))},
    "job_status": {"method": "GET", "path": "/api/jobs/{id}", "summary": "Get job status", "call": job_status,
                   "input_schema": _input(_ID, ("id",))},
    "job_logs": {"method": "GET", "path": "/api/jobs/{id}/logs", "summary": "Get job progress events", "call": job_logs,
                 "input_schema": _input(_ID, ("id",))},
    "job_cancel": {"method": "POST", "path": "/api/jobs/{id}/cancel", "summary": "Cancel a running job", "call": job_cancel,
                   "input_schema": _input(_ID, ("id",))},
}
