"""Master Profile and submission-history workflows over HTTP: profile edits, imports, link checks, recording submissions."""
from __future__ import annotations

from . import applications, ats, config, database, events, linkcheck, profile, resume_workflows, resumes, submissions


# ---------------------------------------------------------------- Master Profile

def get_profile():
    with database.connect() as db:
        return profile.get_profile(db)


def save_personal(data):
    with database.LOCK, database.connect() as db:
        profile.save_personal(db, data.get("data") or {}, data.get("expected_revision"))
        return profile.get_profile(db)


def create_item(data):
    kind = str(data.get("kind", ""))
    if kind == "personal":
        raise ValueError("Use the personal details form.")
    with database.LOCK, database.connect() as db:
        item = profile.create_item(db, kind, data.get("data") or {}, str(data.get("verification") or "unverified"))
        return {"item": item, "profile": profile.get_profile(db)}


def update_item(item_id, data):
    with database.LOCK, database.connect() as db:
        item = profile.update_item(db, item_id, data)
        return {"item": item, "profile": profile.get_profile(db)}


def delete_item(item_id):
    with database.LOCK, database.connect() as db:
        profile.delete_item(db, item_id)
        return {"profile": profile.get_profile(db)}


def import_from_resume(resume_id, verified):
    """Fill the profile from a saved resume's structured content; existing entries are never overwritten."""
    resume = resumes.get_resume(resume_id)
    if not resume:
        raise ValueError("Resume not found.")
    with database.LOCK, database.connect() as db:
        content = profile.resume_content(db, resume_id)
        added = profile.import_from_content(db, content, bool(verified), "resume:" + resume["name"][:80])
        return {"added": added, "profile": profile.get_profile(db)}


def verify_links(item_id=""):
    """Check a project's links (or every active project's) once, on demand. Never runs in the background."""
    with database.connect() as db:
        links = profile.project_links(db, item_id or None)
    if len(links) > linkcheck.MAX_URLS_PER_REQUEST:
        raise ValueError(f"Check at most {linkcheck.MAX_URLS_PER_REQUEST} links at a time; verify projects one by one.")
    results = []
    for owner, field, url in links:
        result = linkcheck.check_url(url)
        results.append({"item_id": owner, "field": field, **result})
        with database.LOCK, database.connect() as db:
            if db.execute("SELECT 1 FROM profile_items WHERE id=?", (owner,)).fetchone():
                profile.save_link_check(db, owner, field, result)
    with database.connect() as db:
        return {"results": results, "profile": profile.get_profile(db)}


def profile_evidence():
    with database.connect() as db:
        return profile.evidence_blocks(db)


def profile_hash():
    """Changes whenever the profile evidence an analysis would use changes (compare with analysis.profile_hash)."""
    return profile.evidence_hash(profile_evidence())


# ---------------------------------------------------------------- submission history

def entry_submissions(entry_id):
    if not applications.get_entry(entry_id):
        raise ValueError("Application not found.")
    with database.connect() as db:
        return {"submissions": submissions.for_entry(db, entry_id)}


def record_submission(entry_id, data):
    """Record that this application was submitted with one exact resume version (by default the one it attaches).

    A Gmail draft or an approved-but-unsent email is not a submission; this is the user's confirmation.
    A pending 9 AM local send is cancelled so the same application is not emailed again.
    """
    entry = applications.get_entry(entry_id)
    if not entry:
        raise ValueError("Application not found.")
    if entry["status"] == "sending":
        raise ValueError("This application is being sent right now. Wait for it to finish.")
    version_id = str(data.get("resume_version_id") or "")
    with database.connect() as db:
        version = ats.version_by_id(db, version_id) if version_id else ats.effective_version(db, entry)
    if not version:
        raise ValueError("Choose the resume that was submitted.")
    if not resume_workflows.candidate_version_allowed(entry, version["id"]):
        raise ValueError("That resume version does not belong to this application.")
    if entry["status"] == "approved" and entry["delivery_mode"] == "local":
        applications.update_entry(entry_id, {"approved": False})
    resume = resumes.get_resume(version["resume_id"], include_deleted=True)
    with database.LOCK, database.connect() as db:
        record = submissions.record(db, config.DATA, entry, version, resume["name"] if resume else "", str(data.get("channel") or ""),
                                    "user_reported", str(data.get("submitted_at") or ""), str(data.get("note") or ""),
                                    entry.get("gmail_draft_id", "") if data.get("channel") == "gmail" else "")
    if entry["status"] not in ("sent",) and not applications.stage_is_after_apply(entry.get("application_stage")):
        applications.update_entry(entry_id, {"application_stage": "Applied"})
    events.application_changed(entry_id)
    return {"submission": record, "entry": applications.get_entry(entry_id)}


def resume_usage(resume_id):
    """Where a resume was used: submissions of its versions (also of its tailored copies) and applications that attach it."""
    resume = resumes.get_resume(resume_id)
    if not resume:
        raise ValueError("Resume not found.")
    with database.connect() as db:
        tailored = [row[0] for row in db.execute("SELECT id FROM resumes WHERE parent_resume_id=? AND deleted_at=''", (resume_id,))]
        rows = [item for rid in [resume_id, *tailored] for item in submissions.for_resume(db, rid)]
        linked = [dict(row) for row in db.execute("""SELECT e.id,e.title,e.company,e.application_stage,e.status,e.resume_version_id,rv.version_number
                                                     FROM entries e LEFT JOIN resume_versions rv ON rv.id=e.resume_version_id
                                                     WHERE e.resume_id=? ORDER BY e.created_at DESC""", (resume_id,))]
    return {"submissions": sorted(rows, key=lambda item: item["submitted_at"], reverse=True), "applications": linked}
