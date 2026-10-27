"""Resume editor orchestration over HTTP: editor state, imports, resets, tailoring, suggestions, saving versions."""
from __future__ import annotations

import json

from . import applications, ats, config, database, profile, resume_import, resume_model, resume_render, resume_store, resumes


def save_editor_version(resume_id, expected_revision, label=""):
    """Render the draft, validate it, and store it as a new current version of this resume."""
    resume = resumes.get_resume(resume_id)
    if not resume:
        raise ValueError("Resume not found.")
    resumes.ensure_not_sending(resume_id, "Save the new version")
    with database.connect() as db:
        draft = resume_store._check_revision(db, resume_id, expected_revision)
    if draft["needs_review"]:
        raise ValueError("Review the imported content and confirm it before saving a version.")
    content = resume_model.normalize(draft["content"])
    pdf, report = resume_store.render_content(content)
    with database.LOCK, database.connect() as db:
        resume_store._check_revision(db, resume_id, expected_revision)
        version, document, created = resume_store.store_rendered_version(
            db, config.DATA, resume_id, content, pdf, report, "editor", draft["base_version_id"], str(label or "")[:120])
        changed = resumes.activate_version(db, resume_id, version, document)
        db.execute("UPDATE resume_drafts SET base_version_id=? WHERE resume_id=?", (version["id"], resume_id))
    resumes.after_current_changed(resume_id, changed)
    return {"resume": resumes.get_resume(resume_id), "version_id": version["id"], "version_number": version["version_number"],
            "created": created, "unchanged": not created and not changed, "validation": report,
            "sha256": document["sha256"]}


def editor_state(resume_id):
    """Everything the resume editor needs on open; creates the working draft on first open."""
    resume = resumes.get_resume(resume_id)
    if not resume:
        raise ValueError("Resume not found.")
    with database.LOCK, database.connect() as db:
        draft = resume_store.open_draft(db, resume_id)
        version = ats.current_version(db, resume_id)
        document = db.execute("SELECT structured_status,extraction_status,extraction_error FROM resume_documents WHERE id=?",
                              (version["document_id"],)).fetchone() if version else None
        job = db.execute("""SELECT * FROM resume_ai_jobs WHERE purpose='resume_structure' AND document_id=? ORDER BY created_at DESC LIMIT 1""",
                         (version["document_id"],)).fetchone() if version else None
        base = resume_store.version_content(db, draft["base_version_id"]) if draft["base_version_id"] else None
    parent = resumes.get_resume(resume["parent_resume_id"], include_deleted=True, include_token=True) if resume["parent_resume_id"] else None
    return {
        "draft": draft, "resume": resume, "versions": ats.list_versions(config.DB, config.DATA, resume_id),
        # Hash of the saved version the draft started from; equal to the draft hash when there are no unsaved edits.
        "base_content_hash": resume_model.content_hash(resume_model.normalize(base["content"])) if base and base["content"] else "",
        "templates": [{"id": key, **{k: v for k, v in value.items() if k != "file"}} for key, value in resume_render.TEMPLATES.items()],
        "renderer": resume_render.status(),
        "design": {"presets": resume_model.LAYOUT_PRESETS, "ranges": resume_model.LAYOUT_RANGES,
                   "choices": resume_model.LAYOUT_CHOICES, "accents": resume_model.ACCENTS},
        "import": {"structured_status": document["structured_status"] if document else "not_parsed",
                   "extraction_status": document["extraction_status"] if document else "missing",
                   "extraction_error": document["extraction_error"] if document else "",
                   "job": resume_store.public_job(job)},
        "parent": {"id": parent["id"], "name": parent["name"], "deleted": bool(parent.get("deleted_at")),
                   "current_version_id": parent["current_version_id"]} if parent else None,
        "entry": {"id": resume["entry_id"], "title": (applications.get_entry(resume["entry_id"]) or {}).get("title", ""),
                  "company": (applications.get_entry(resume["entry_id"]) or {}).get("company", "")} if resume["entry_id"] else None,
    }


def require_codex():
    connection = ats.codex_status()
    if not connection.get("checked"):
        connection = ats.codex_status(force=True)
    if not connection.get("connected"):
        raise ValueError(connection.get("message") or "Codex CLI is not connected to ChatGPT Plus.")


def import_draft(resume_id, mode, expected_revision):
    """Re-import the current file into the draft. Codex structuring runs in the background and is cached per file."""
    if not resumes.get_resume(resume_id):
        raise ValueError("Resume not found.")
    with database.LOCK, database.connect() as db:
        resume_store._check_revision(db, resume_id, expected_revision)
        version = ats.current_version(db, resume_id)
        if not version:
            raise ValueError("This resume has no available file.")
        document = db.execute("SELECT * FROM resume_documents WHERE id=?", (version["document_id"],)).fetchone()
        if mode == "heuristic":
            content, warnings = resume_import.heuristic_parse(document["extracted_text"])
            return {"draft": resume_store.replace_draft_content(db, resume_id, content, expected_revision, "heuristic", warnings, version["id"])}
        if mode != "codex":
            raise ValueError("Choose a local or Codex import.")
        if document["structured_status"] == "complete" and document["structured_version"] == resume_import.STRUCTURE_VERSION:
            cached = json.loads(document["structured_json"])
            return {"draft": resume_store.replace_draft_content(db, resume_id, cached["content"], expected_revision, "codex",
                                                                cached.get("warnings", []), version["id"])}
        if document["extraction_status"] != "ready":
            raise ValueError(document["extraction_error"] or "Not enough text was extracted for an AI import. Enter the content manually.")
    require_codex()
    with database.LOCK, database.connect() as db:
        job, _ = resume_store.queue_job(db, "resume_structure", resume_store.structure_job_hash(document["sha256"]), {},
                                        resume_id=resume_id, document_id=document["id"])
    return {"job": job}


def reset_draft(resume_id, expected_revision, version_id=""):
    """Discard draft edits and reload a saved version's content (or a fresh import of an uploaded file)."""
    with database.LOCK, database.connect() as db:
        resume_store._check_revision(db, resume_id, expected_revision)
        version_id = version_id or (db.execute("SELECT current_version_id FROM resumes WHERE id=?", (resume_id,)).fetchone() or {"current_version_id": ""})["current_version_id"]
        row = db.execute("SELECT * FROM resume_versions WHERE id=? AND resume_id=?", (version_id, resume_id)).fetchone()
        if not row:
            raise ValueError("Version not found.")
        if row["content_json"]:
            return resume_store.replace_draft_content(db, resume_id, json.loads(row["content_json"]), expected_revision, "version", [], row["id"])
        document = db.execute("SELECT * FROM resume_documents WHERE id=?", (row["document_id"],)).fetchone()
        content, warnings = resume_import.heuristic_parse(document["extracted_text"])
        return resume_store.replace_draft_content(db, resume_id, content, expected_revision, "heuristic", warnings, row["id"])


def tailor_resume(entry_id, base_resume_id):
    """Create (or reuse) this application's tailored copy of a master resume. The master is not modified."""
    entry = applications.get_entry(entry_id)
    if not entry:
        raise ValueError("Application not found.")
    base = resumes.get_resume(base_resume_id or entry["resume_id"])
    if not base or not base["available"]:
        raise ValueError("Choose an available master resume to tailor.")
    if base["kind"] != "master":
        if base["entry_id"] == entry_id:
            return base, False
        raise ValueError("Choose a master resume to tailor.")
    with database.connect() as db:
        existing = resume_store.tailored_for(db, entry_id, base["id"])
        if existing:
            return resumes.get_resume(existing["id"]), False
        content, base_version_id = resume_store.base_content(db, base["id"])
    pdf, report = resume_store.render_content(content)
    with database.LOCK, database.connect() as db:
        resume_id, created = resume_store.create_tailored(db, config.DATA, entry, base, pdf, report, content, base_version_id)
    return resumes.get_resume(resume_id), created


def resume_allowed_for_entry(entry, resume_id):
    resume = resumes.get_resume(resume_id)
    return bool(resume) and (resume_id == entry["resume_id"] or (resume["kind"] == "tailored" and resume["entry_id"] == entry["id"]))


def queue_suggestions(analysis_id, resume_id):
    """Ask Codex for targeted edits to this resume's draft, based on a completed analysis. Cached per draft content."""
    analysis = ats.get_analysis(config.DB, analysis_id)
    if not analysis or analysis["status"] != "complete":
        raise ValueError("Run the analysis to completion before asking for suggestions.")
    entry = applications.get_entry(analysis["entry_id"])
    if not entry:
        raise ValueError("Application not found.")
    if not resume_allowed_for_entry(entry, resume_id):
        raise ValueError("Suggestions can only target this application's resume or its tailored copy.")
    with database.LOCK, database.connect() as db:
        draft = resume_store.open_draft(db, resume_id)
        if draft["needs_review"]:
            raise ValueError("Review the imported content and confirm it before asking for suggestions.")
        content = draft["content"]
        # Only profile entries relevant to this analysis's gaps are offered, so suggestions stay focused.
        cited = {value for item in (analysis.get("result") or {}).get("requirements", []) for value in item.get("profile_evidence_ids", [])}
        profile_blocks = [block for block in json.loads(analysis.get("profile_json") or "[]") if block["id"] in cited]
        verified_profile = profile.verified_corpus(db)
        addressed_ids = sorted(key for key, value in (analysis.get("checklist") or {}).items() if value == "addressed")
        input_hash = resume_store.suggestions_job_hash(analysis_id, content, profile.evidence_hash(profile_blocks) + "|" + ",".join(addressed_ids))
        reusable = db.execute("SELECT status FROM resume_ai_jobs WHERE purpose='resume_suggestions' AND input_hash=?", (input_hash,)).fetchone()
    if not reusable or reusable["status"] not in ("complete", "pending", "running"):
        require_codex()
    # Requirements marked "addressed" in the analysis checklist are done: no more suggestions for them.
    addressed = {key for key, value in (analysis.get("checklist") or {}).items() if value == "addressed"}
    payload = {"content": content, "requirements": [item for item in (analysis.get("result") or {}).get("requirements", []) if item["id"] not in addressed],
               "jd_text": ats.canonical_jd(entry)[1], "profile_blocks": profile_blocks,
               "profile": "\n".join([config.SETTINGS.get("candidate_profile", ""), verified_profile])}
    with database.LOCK, database.connect() as db:
        job, reused = resume_store.queue_job(db, "resume_suggestions", input_hash, payload, resume_id=resume_id, analysis_id=analysis_id)
        suggestions = resume_store.list_suggestions(db, resume_id, analysis_id)
    return {"job": job, "reused": reused, "suggestions": suggestions}


def analyze_draft(resume_id, entry_id, expected_revision):
    """Score the editor's current draft against an application without saving a resume version.

    The draft is rendered exactly as "Save version" would render it; the PDF is stored content-addressed
    for this check only. If the same content is saved later, that version reuses this result.
    """
    entry = applications.get_entry(entry_id)
    if not entry:
        raise ValueError("Application not found.")
    if not resume_allowed_for_entry(entry, resume_id):
        raise ValueError("Only this application's resume or its tailored copy can be checked against it.")
    with database.connect() as db:
        draft = resume_store._check_revision(db, resume_id, expected_revision)
        blocks = profile.evidence_blocks(db)
    if draft["needs_review"]:
        raise ValueError("Review the imported content and confirm it before analyzing it.")
    pdf, _ = resume_store.render_content(resume_model.normalize(draft["content"]))
    with database.LOCK, database.connect() as db:
        document = ats.install_document(db, config.DATA, pdf, ".pdf", "application/pdf")
    run, cached = ats.queue_analysis(config.DB, entry, require_codex=True, profile_blocks=blocks, document=document, draft_resume_id=resume_id)
    return {"analysis": ats.get_analysis(config.DB, run["id"]), "cached": cached}


def profile_entries(resume_id):
    """Master Profile entries the editor can add to this resume, with whether each is already in its draft."""
    if not resumes.get_resume(resume_id):
        raise ValueError("Resume not found.")
    with database.LOCK, database.connect() as db:
        draft = resume_store.open_draft(db, resume_id)
        return {"entries": profile.entries_for_resume(db, draft["content"]), "revision": draft["revision"]}


def add_from_profile(resume_id, key, expected_revision, confirm_unverified=False, replace=False):
    """Copy one Master Profile entry into the resume's draft (no AI). Nothing is saved as a version."""
    if not resumes.get_resume(resume_id):
        raise ValueError("Resume not found.")
    key = str(key or "")
    field = key.split(":", 1)[1] if key.startswith("personal:") else ""
    with database.LOCK, database.connect() as db:
        draft = resume_store._check_revision(db, resume_id, expected_revision)
        item = profile.personal(db) if field else profile.get_item(db, key)
        if not item or not item["id"] or item["archived"] or (field and field not in profile.PERSONAL_FIELDS):
            raise ValueError("That Master Profile entry no longer exists.")
        if item["verification"] != "verified" and not confirm_unverified:
            raise ValueError("This profile entry is not verified. Confirm it is accurate before adding it.")
        content = profile.add_to_content(draft["content"], item, field, bool(replace))
        updated = resume_store._write_draft(db, resume_id, content, draft["base_version_id"], draft["revision"] + 1)
        entries = profile.entries_for_resume(db, updated["content"])
    return {"draft": updated, "entries": entries}


def check_score(analysis_id, resume_id, expected_revision, full=False):
    """Score the draft against an existing analysis without creating a new one (nothing is added to its history).

    Requirements whose supporting text is unchanged keep their verdict; only those an applied suggestion
    targeted, whose text changed, or whose key terms newly appear are re-checked with Codex.
    full=True re-checks every requirement (still no version and no history entry).
    """
    analysis = ats.get_analysis(config.DB, analysis_id)
    if not analysis or analysis["status"] != "complete":
        raise ValueError("Run an analysis to completion before checking the score.")
    entry = applications.get_entry(analysis["entry_id"])
    if not entry or not resume_allowed_for_entry(entry, resume_id):
        raise ValueError("Only this application's resume or its tailored copy can be checked against it.")
    with database.connect() as db:
        draft = resume_store._check_revision(db, resume_id, expected_revision)
    if draft["needs_review"]:
        raise ValueError("Review the imported content and confirm it before checking the score.")
    pdf, _ = resume_store.render_content(resume_model.normalize(draft["content"]))
    with database.LOCK, database.connect() as db:
        document = ats.install_document(db, config.DATA, pdf, ".pdf", "application/pdf")
        # Accepted suggestions count whichever analysis they came from: requirement ids are stable for a job description.
        accepted = list(db.execute("""SELECT requirement_id FROM resume_suggestions WHERE resume_id=? AND status IN ('accepted','edited')""", (resume_id,)))
        targeted = {row[0] for row in accepted if row[0]}
    if document["extraction_status"] != "ready":
        raise ValueError(document["extraction_error"] or "The rendered resume could not be read back.")
    requirements = (analysis.get("result") or {}).get("requirements", [])
    recheck = [item["id"] for item in requirements] if full else ats.recheck_ids(requirements, document["extracted_text"], targeted)
    input_hash = resume_store.score_check_hash(analysis_id, document["sha256"], recheck, bool(full))
    with database.connect() as db:
        reusable = db.execute("SELECT status FROM resume_ai_jobs WHERE purpose='score_check' AND input_hash=?", (input_hash,)).fetchone()
    if recheck and (not reusable or reusable["status"] not in ("complete", "pending", "running")):
        require_codex()
    with database.LOCK, database.connect() as db:
        job, reused = resume_store.queue_job(db, "score_check", input_hash, {"recheck": recheck, "content_hash": draft["content_hash"], "full": bool(full),
                                                                          "applied": len(accepted), "revision": draft["revision"]},
                                             resume_id=resume_id, document_id=document["id"], analysis_id=analysis_id)
    return {"job": job, "reused": reused, "recheck": len(recheck)}


def candidate_version_allowed(entry, version_id):
    with database.connect() as db:
        row = db.execute("SELECT resume_id FROM resume_versions WHERE id=?", (version_id,)).fetchone()
    return bool(row) and resume_allowed_for_entry(entry, row["resume_id"])
