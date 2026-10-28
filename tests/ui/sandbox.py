"""Run ApplyDock against a throwaway data folder with a fake Codex, for browser tests.

Usage: python tests/ui/sandbox.py <data-dir> <port>
Seeds one master resume and one application with a completed analysis. Never touches data/.
"""
import base64
import json
import os
from pathlib import Path
import re
import sys
import threading

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO))

from applydock import app, applications, ats, config, database, linkcheck, resume_import, resume_model, resume_render, resume_store, resumes  # noqa: E402


def fake_codex(root, prompt, schema, purpose, job_id, db_path):
    """Deterministic stand-in for the Codex CLI (no network, no ChatGPT allowance)."""
    if purpose == "resume_structure":
        content, _ = resume_import.heuristic_parse(prompt.split("RESUME TEXT:\n", 1)[1])
        out = {key: content[key] for key in ("work", "projects", "skills", "education", "certificates", "awards", "custom")}
        out["basics"] = {**content["basics"], "profiles": [{"network": p["network"], "url": p["url"]} for p in content["basics"]["profiles"]]}
        for section in out.values():
            for item in section if isinstance(section, list) else []:
                item.pop("id", None)
                for key in ("highlights", "items"):
                    if key in item:
                        item[key] = [line["text"] for line in item[key]]
        return {**out, "section_order": content["meta"]["section_order"], "warnings": []}
    if purpose == "resume_suggestions":
        items = json.loads(re.search(r"RESUME ITEMS:\n(.*?)\n\nREQUIREMENTS", prompt, re.S).group(1))
        bullets = [item for item in items if item["section"] == "work" and item["field"] == "text"]
        groups = [item for item in items if item["section"] == "skills" and item["field"] == "keywords"]
        suggestions = [
            {"requirement_id": "q1", "target_id": bullets[0]["target_id"], "field": "text", "operation": "replace", "original_text": bullets[0]["text"],
             "proposed_text": "Built reusable React components and optimized rendering performance across internal applications.",
             "reason": "The job emphasizes performance optimization.", "claim_type": "rephrase"},
            {"requirement_id": "q2", "target_id": bullets[1]["target_id"], "field": "text", "operation": "replace", "original_text": bullets[1]["text"],
             "proposed_text": "Led the migration of a legacy dashboard to TypeScript with strict type checking.",
             "reason": "Uses the job's TypeScript wording for existing work.", "claim_type": "rephrase"},
            {"requirement_id": "q3", "target_id": groups[-1]["target_id"], "field": "keywords", "operation": "add_keyword", "original_text": "",
             "proposed_text": "Testing Library", "reason": "Already mentioned in your experience.", "claim_type": "emphasis"},
        ]
        profile = re.search(r"MASTER PROFILE EVIDENCE[^\n]*\n(.*?)\n\nJOB DESCRIPTION", prompt, re.S)
        for block in json.loads(profile.group(1)) if profile else []:
            if block["kind"] == "project":
                suggestions.append({"requirement_id": "J2", "target_id": "projects", "field": "text", "operation": "add_project", "original_text": "",
                                    "proposed_text": "Built OAuth sign-in with refresh tokens for my own Node.js apps.",
                                    "reason": "Your profile shows authentication work this job asks for.", "claim_type": "rephrase",
                                    "source_profile_id": block["id"]})
        for item in suggestions:
            item.setdefault("source_profile_id", "")
        return {"suggestions": suggestions, "notes": "Sandbox suggestions."}
    if purpose == "resume_parse":
        return {"summary": "Frontend engineer", "skills": [{"name": "React", "details": "React apps", "evidence_ids": ["R1"]}],
                "experience": [], "projects": [], "education": [], "certifications": [], "keywords": ["React"]}
    if purpose == "jd_requirements":
        return {"warnings": [], "requirements": [
            {"id": "J1", "category": "required_skills", "requirement": "React and TypeScript", "mandatory": True, "priority": "high", "terms": ["react"]},
            {"id": "J2", "category": "required_skills", "requirement": "OAuth authentication for web apps", "mandatory": True, "priority": "high", "terms": ["oauth"]},
            {"id": "J3", "category": "preferred_skills", "requirement": "Kubernetes operations", "mandatory": False, "priority": "low", "terms": ["kubernetes"]}]}
    if purpose in ("jd_match", "score_check"):
        profile = re.search(r"CANDIDATE MASTER PROFILE[^\n]*\n(.*?)\n\n(?:PREVIOUS ASSESSMENT|JOB DESCRIPTION)", prompt, re.S)
        oauth = [block["id"] for block in (json.loads(profile.group(1)) if profile else []) if "oauth" in block["text"].lower()]
        return {"summary": "Strong React match; authentication only appears in your Master Profile.", "warnings": [], "assessments": [
            {"requirement_id": "J1", "status": "demonstrated", "resume_evidence_ids": ["R1"], "explanation": "React work is shown.", "recommendation": "",
             "profile_status": "none", "profile_evidence_ids": []},
            {"requirement_id": "J2", "status": "missing", "resume_evidence_ids": [], "explanation": "No authentication work in the resume.",
             "recommendation": "Add your authentication project from the Master Profile.", "profile_status": "demonstrated" if oauth else "none",
             "profile_evidence_ids": oauth[:1]},
            {"requirement_id": "J3", "status": "missing", "resume_evidence_ids": [], "explanation": "Not shown.", "recommendation": "Neither source shows this; do not claim it.",
             "profile_status": "none", "profile_evidence_ids": []}]}
    raise RuntimeError("failed|Unexpected purpose " + purpose)


def fake_link_check(url, **_):
    """Link checks never touch the network in the sandbox."""
    status = "unreachable" if "broken" in url else "reachable"
    return {"url": url, "status": status, "http_status": 404 if status == "unreachable" else 200, "final_url": "",
            "detail": "Sandbox check.", "checked_at": ats.now_iso()}


def seed():
    content = resume_model.normalize(json.loads((REPO / "tests" / "fixtures" / "sample_resume.json").read_text(encoding="utf-8")))
    resumes.create_resume({"filename": "Jordan_Rivera_Frontend.pdf", "display_name": "Frontend master", "category": "Frontend Developer",
                           "content": base64.b64encode(resume_render.render(content)).decode()})
    entry, _ = applications.capture({"url": "https://jobs.lever.co/initech/frontend-1", "title": "Senior Frontend Engineer", "company": "Initech",
                                     "apply_method": "email", "recipient": "jobs@initech.example",
                                     "excerpt": ("We need a senior frontend engineer with React and TypeScript. You will own performance optimization "
                                                 "of large React applications, integrate REST APIs, and write tests with Testing Library. ") * 3})
    applications.update_entry(entry["id"], {"subject": "Application: Senior Frontend Engineer", "body": "Hello Initech team,\n\nI'd like to apply."})
    run, _ = ats.queue_analysis(config.DB, applications.get_entry(entry["id"]))
    requirements = [
        {"id": "q1", "category": "required_skills", "requirement": "Performance optimization of React applications", "mandatory": True, "status": "missing",
         "resume_evidence_ids": [], "explanation": "No explicit performance work.", "resume_evidence": [], "recommendation": "Describe performance work if you did it.", "priority": "high"},
        {"id": "q2", "category": "required_skills", "requirement": "TypeScript", "mandatory": True, "status": "demonstrated",
         "resume_evidence_ids": ["R1"], "explanation": "Shown.", "resume_evidence": [], "recommendation": "", "priority": "medium"},
        {"id": "q3", "category": "preferred_skills", "requirement": "Testing Library", "mandatory": False, "status": "partial",
         "resume_evidence_ids": ["R2"], "explanation": "Mentioned once.", "resume_evidence": [], "recommendation": "List it under skills.", "priority": "low"},
    ]
    with database.connect() as db:
        db.execute("""UPDATE analysis_runs SET status='complete',overall_score=64.5,relevance_score=63,readability_score=90,missing_mandatory=1,
                      result_json=?,completed_at=? WHERE id=?""",
                   (json.dumps({"summary": "Strong React match; performance work is not shown.", "requirements": requirements,
                                "category_scores": {}, "warnings": [], "resume_version": 1}), ats.now_iso(), run["id"]))


def serve_extension_for_tests():
    """Serve extension/ under /__extension/ so a browser test can load the side panel same-origin with the API.

    Test-only: the real helper never serves extension files.
    """
    from applydock import http_server
    root = (REPO / "extension").resolve()

    def extension_file(url_path):
        if url_path.startswith("/__extension/"):
            candidate = (root / url_path[len("/__extension/"):]).resolve()
            return candidate if candidate.is_relative_to(root) and candidate.is_file() and candidate.suffix in http_server.STATIC_TYPES else None
        return None
    http_server.extra_static_file = extension_file


def main():
    data_dir, port = Path(sys.argv[1]), int(sys.argv[2])
    config.set_data_dir(data_dir)
    config.PORT = port
    # Lets several web builds be tested side by side (npx vite build --outDir ...); defaults to web/dist.
    if os.environ.get("APPLYDOCK_WEB_DIST"):
        config.WEB_DIST = Path(os.environ["APPLYDOCK_WEB_DIST"]).resolve()
    config.DATA.mkdir(parents=True, exist_ok=True)
    config.SETTINGS.update({"pairing_key": "sandbox-key", "notion_data_source_id": "", "smtp": {},
                            "candidate_profile": "Frontend engineer. React, TypeScript, accessibility, testing with Jest."})
    database.init_db()
    ats._run_codex = fake_codex
    linkcheck.check_url = fake_link_check
    serve_extension_for_tests()
    ats.codex_status = lambda force=False: {"installed": True, "connected": True, "checked": True, "model": ats.MODEL, "message": "Sandbox"}
    if not resumes.resumes():
        seed()
    threading.Thread(target=ats.worker, args=(config.DB, config.DATA, config.SCHEMA_DIR, None), daemon=True).start()
    threading.Thread(target=resume_store.job_worker, args=(config.DB, config.DATA, config.SCHEMA_DIR), daemon=True).start()
    print("sandbox ready", flush=True)
    app.create_server().serve_forever()


if __name__ == "__main__":
    main()
