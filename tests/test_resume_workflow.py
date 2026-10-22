"""End-to-end resume editing workflow through the real server functions and SQLite storage."""
import base64
import email
import hashlib
import json
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from support import isolate_app
from applydock import applications, ats, config, database, gmail, http_server, resume_model, resume_render, resume_store, resume_workflows, resumes


FIXTURE = Path(__file__).resolve().parent / "fixtures" / "sample_resume.json"

try:
    import typst  # noqa: F401
    HAVE_TYPST = True
except ImportError:
    HAVE_TYPST = False


def sample_pdf():
    return resume_render.render(resume_model.normalize(json.loads(FIXTURE.read_text(encoding="utf-8"))))


def call(method, path, data=None):
    result = {}
    handler = SimpleNamespace(
        path=path, headers={"Host": f"{config.HOST}:{config.PORT}"}, authorized=lambda: True, body=lambda: data or {},
        respond=lambda code, payload: result.update(code=code, payload=payload),
        respond_bytes=lambda code, kind, payload, headers=None: result.update(code=code, kind=kind, payload=payload, headers=headers or {}),
        respond_html=lambda code, message: result.update(code=code, payload=message))
    if method == "GET":
        http_server.Handler.do_GET(handler)
    else:
        http_server.Handler.mutate(handler, method)
    return result


@unittest.skipUnless(HAVE_TYPST, "typst is not installed")
class ResumeWorkflowTests(unittest.TestCase):
    def setUp(self):
        isolate_app(self, {"pairing_key": "test", "notion_data_source_id": "", "smtp": {"password": "x"}, "smtp_verified": True,
                           "candidate_profile": "Frontend engineer, React, TypeScript."})
        patcher = patch.object(ats, "PLAN_LIMIT_PAUSED", False)
        patcher.start(); self.addCleanup(patcher.stop)
        self.upload_pdf = sample_pdf()
        self.master = resumes.create_resume({"filename": "jordan-original.pdf", "display_name": "Frontend master",
                                            "content": base64.b64encode(self.upload_pdf).decode()})

    # helpers ---------------------------------------------------------
    def reviewed_master_version(self):
        state = resume_workflows.editor_state(self.master["id"])
        with database.connect() as db:
            resume_store.save_draft(db, self.master["id"], state["draft"]["content"], state["draft"]["revision"], reviewed=True)
            draft = resume_store.get_draft(db, self.master["id"])
        return resume_workflows.save_editor_version(self.master["id"], draft["revision"])

    def entry(self, url="https://jobs.lever.co/example/frontend-1", **fields):
        entry, _ = applications.capture({"url": url, "title": "Frontend Engineer", "company": "Initech", "apply_method": "email",
                                   "excerpt": "Build React and TypeScript apps. Performance optimization and testing required. " * 6})
        if fields:
            applications.update_entry(entry["id"], fields)
        return applications.get_entry(entry["id"])

    def draft(self, resume_id):
        with database.connect() as db:
            return resume_store.get_draft(db, resume_id)

    # tests -----------------------------------------------------------
    def test_import_requires_review_then_saves_new_version_without_touching_upload(self):
        state = resume_workflows.editor_state(self.master["id"])
        draft = state["draft"]
        self.assertEqual(draft["import_source"], "heuristic")
        self.assertTrue(draft["needs_review"])
        self.assertEqual(draft["content"]["basics"]["name"], "Jordan Rivera")
        with self.assertRaisesRegex(ValueError, "Review the imported"):
            resume_workflows.save_editor_version(self.master["id"], draft["revision"])
        result = self.reviewed_master_version()
        self.assertTrue(result["created"])
        self.assertEqual(result["version_number"], 2)
        self.assertTrue(result["validation"]["ok"], result["validation"]["warnings"])
        versions = ats.list_versions(config.DB, config.DATA, self.master["id"])
        self.assertEqual([(v["version_number"], v["source"]) for v in versions], [(2, "editor"), (1, "upload")])
        self.assertEqual(versions[1]["sha256"], hashlib.sha256(self.upload_pdf).hexdigest())
        resume = resumes.get_resume(self.master["id"])
        self.assertEqual(resume["original_filename"], "Jordan Rivera - Resume.pdf")
        again = resume_workflows.save_editor_version(self.master["id"], self.draft(self.master["id"])["revision"])
        self.assertTrue(again["unchanged"])
        self.assertEqual(len(ats.list_versions(config.DB, config.DATA, self.master["id"])), 2)

    def test_stale_draft_revision_returns_conflict(self):
        state = resume_workflows.editor_state(self.master["id"])
        content = state["draft"]["content"]
        content["basics"]["label"] = "Senior Frontend Engineer"
        ok = call("PATCH", f"/api/resumes/{self.master['id']}/draft", {"content": content, "expected_revision": state["draft"]["revision"]})
        self.assertEqual(ok["code"], 200)
        stale = call("PATCH", f"/api/resumes/{self.master['id']}/draft", {"content": content, "expected_revision": state["draft"]["revision"]})
        self.assertEqual(stale["code"], 409)
        self.assertEqual(stale["payload"]["draft"]["revision"], state["draft"]["revision"] + 1)

    def test_restore_moves_current_pointer_and_file_metadata(self):
        self.reviewed_master_version()
        versions = ats.list_versions(config.DB, config.DATA, self.master["id"])
        upload = [v for v in versions if v["source"] == "upload"][0]
        old_token = resumes.get_resume(self.master["id"], include_token=True)["access_token"]
        restored = resumes.restore_version(self.master["id"], upload["id"])
        self.assertEqual(restored["current_version_id"], upload["id"])
        self.assertEqual(restored["original_filename"], "jordan-original.pdf")
        self.assertNotEqual(resumes.get_resume(self.master["id"], include_token=True)["access_token"], old_token)
        self.assertEqual(len(ats.list_versions(config.DB, config.DATA, self.master["id"])), 2)

    def test_tailored_copy_is_isolated_from_master_and_other_jobs(self):
        entry = self.entry()
        with self.assertRaisesRegex(ValueError, "review the imported content"):
            resume_workflows.tailor_resume(entry["id"], self.master["id"])
        self.reviewed_master_version()
        master_before = resumes.get_resume(self.master["id"])
        tailored, created = resume_workflows.tailor_resume(entry["id"], self.master["id"])
        again, created_again = resume_workflows.tailor_resume(entry["id"], self.master["id"])
        self.assertTrue(created)
        self.assertFalse(created_again)
        self.assertEqual(tailored["id"], again["id"])
        self.assertEqual((tailored["kind"], tailored["parent_resume_id"], tailored["entry_id"]), ("tailored", self.master["id"], entry["id"]))
        self.assertEqual(tailored["current_version_number"], 1)
        self.assertEqual(resumes.default_resume_id(), self.master["id"])
        # Editing the tailored draft never changes the master.
        draft = self.draft(tailored["id"])
        changed = resume_model.apply_edit(draft["content"], draft["content"]["work"][0]["highlights"][0]["id"], "text", "replace", "Tailored bullet.")
        with database.connect() as db:
            resume_store.save_draft(db, tailored["id"], changed, draft["revision"])
        resume_workflows.save_editor_version(tailored["id"], draft["revision"] + 1)
        master_after = resumes.get_resume(self.master["id"])
        self.assertEqual(master_before["current_version_id"], master_after["current_version_id"])
        self.assertEqual(self.draft(self.master["id"])["content"]["work"][0]["highlights"][0]["text"],
                         "Developed reusable React components for internal applications.")
        other = self.entry("https://jobs.lever.co/example/frontend-2")
        with self.assertRaisesRegex(ValueError, "belongs to another application"):
            applications.update_entry(other["id"], {"resume_id": tailored["id"]})
        with self.assertRaisesRegex(ValueError, "tailored resume"):
            applications.capture({"url": "https://jobs.lever.co/example/frontend-3", "title": "Engineer", "resume_id": tailored["id"]})
        second, _ = resume_workflows.tailor_resume(other["id"], self.master["id"])
        self.assertNotEqual(second["id"], tailored["id"])

    def test_pinned_version_is_exactly_what_gmail_attaches(self):
        self.reviewed_master_version()
        entry = self.entry(recipient="hiring@example.com", subject="Application", body="Hello")
        tailored, _ = resume_workflows.tailor_resume(entry["id"], self.master["id"])
        pinned = call("POST", f"/api/entries/{entry['id']}/pin-resume", {"resume_id": tailored["id"]})
        self.assertEqual(pinned["code"], 200, pinned)
        entry = applications.get_entry(entry["id"])
        self.assertTrue(entry["resume_version"]["pinned"])
        pinned_version = entry["resume_version"]
        config.SETTINGS.update({"gmail_refresh_token": "encrypted", "gmail_address": "me@gmail.com"})
        calls = []
        def fake_gmail(method, path, token, payload=None):
            calls.append((method, payload))
            return {"id": "draft_1"}
        with patch.object(gmail, "gmail_access_token", return_value="t"), patch.object(gmail, "gmail_api_request", side_effect=fake_gmail):
            gmail.save_gmail_draft(entry["id"])
        raw = calls[0][1]["message"]["raw"]
        message = email.message_from_bytes(base64.urlsafe_b64decode(raw + "=" * (-len(raw) % 4)))
        attachment = message.get_payload()[1]
        attached = attachment.get_payload(decode=True)
        self.assertEqual(hashlib.sha256(attached).hexdigest(), pinned_version["sha256"])
        self.assertEqual(attachment.get_filename(), "Jordan Rivera - Resume.pdf")
        entry = applications.get_entry(entry["id"])
        self.assertEqual(entry["attachment_sha256"], pinned_version["sha256"])
        self.assertEqual(entry["gmail_dirty"], 0)
        # A newer tailored version does not silently replace the attached, pinned one.
        draft = self.draft(tailored["id"])
        changed = json.loads(json.dumps(draft["content"]))
        changed["basics"]["label"] = "Frontend Engineer (React)"
        with database.connect() as db:
            resume_store.save_draft(db, tailored["id"], changed, draft["revision"])
        resume_workflows.save_editor_version(tailored["id"], draft["revision"] + 1)
        entry = applications.get_entry(entry["id"])
        self.assertEqual(entry["resume_version"]["id"], pinned_version["id"])
        self.assertFalse(entry["resume_version"]["is_current"])
        self.assertEqual(entry["gmail_dirty"], 0)
        # Following the current version again is explicit and marks the Gmail draft for update.
        applications.update_entry(entry["id"], {"resume_version_id": ""})
        entry = applications.get_entry(entry["id"])
        self.assertEqual(entry["gmail_dirty"], 1)
        self.assertTrue(entry["resume_version"]["is_current"])

    def test_unpinned_application_follows_master_and_is_marked_for_review(self):
        entry = self.entry(recipient="hiring@example.com", subject="Application", body="Hello")
        with database.connect() as db:
            db.execute("UPDATE entries SET gmail_draft_id='draft_1' WHERE id=?", (entry["id"],))
        self.reviewed_master_version()
        entry = applications.get_entry(entry["id"])
        self.assertEqual(entry["gmail_dirty"], 1)
        self.assertEqual(entry["resume_version"]["version_number"], 2)

    def test_approval_pins_the_version_that_will_be_sent(self):
        import datetime as dt
        entry = self.entry(recipient="hiring@example.com", subject="Application", body="Hello")
        send_at = (dt.datetime.now().astimezone() + dt.timedelta(days=1)).replace(hour=9, minute=0, second=0, microsecond=0).isoformat()
        approved = applications.update_entry(entry["id"], {"send_at": send_at, "approved": True})
        self.assertEqual(approved["status"], "approved")
        self.assertEqual(approved["resume_version_id"], self.master["current_version_id"])
        self.reviewed_master_version()
        still = applications.get_entry(entry["id"])
        self.assertEqual(still["status"], "approved")
        self.assertEqual(still["resume_version"]["id"], self.master["current_version_id"])

    def test_suggestions_are_validated_flagged_and_applied_atomically(self):
        self.reviewed_master_version()
        entry = self.entry()
        tailored, _ = resume_workflows.tailor_resume(entry["id"], self.master["id"])
        run, _ = ats.queue_analysis(config.DB, entry)
        requirements = [{"id": "q1", "category": "required_skills", "requirement": "Performance optimization of React applications",
                         "mandatory": True, "status": "missing", "recommendation": "Show performance work"},
                        {"id": "q2", "category": "required_skills", "requirement": "Container orchestration", "mandatory": False,
                         "status": "missing", "recommendation": ""}]
        with database.connect() as db:
            db.execute("UPDATE analysis_runs SET status='complete',result_json=? WHERE id=?", (json.dumps({"requirements": requirements}), run["id"]))
        content = self.draft(tailored["id"])["content"]
        bullet = content["work"][0]["highlights"][0]
        output = {"notes": "", "suggestions": [
            {"requirement_id": "q1", "target_id": bullet["id"], "field": "text", "operation": "replace", "original_text": bullet["text"],
             "proposed_text": "Built reusable React components and optimized rendering performance across internal applications.",
             "reason": "Shows performance work", "claim_type": "rephrase"},
            {"requirement_id": "q1", "target_id": "h_doesnotexist", "field": "text", "operation": "replace", "original_text": "x",
             "proposed_text": "y", "reason": "", "claim_type": "rephrase"},
            {"requirement_id": "q1", "target_id": bullet["id"], "field": "text", "operation": "replace", "original_text": "Different text",
             "proposed_text": "z", "reason": "", "claim_type": "rephrase"},
            {"requirement_id": "q1", "target_id": content["skills"][1]["id"], "field": "keywords", "operation": "add_keyword", "original_text": "",
             "proposed_text": "Kubernetes", "reason": "", "claim_type": "new_claim"},
            {"requirement_id": "q2", "target_id": content["skills"][0]["id"], "field": "keywords", "operation": "add_keyword", "original_text": "",
             "proposed_text": "TypeScript", "reason": "Already listed", "claim_type": "emphasis"},
        ]}
        purposes = []
        def fake_codex(root, prompt, schema, purpose, job_id, db_path):
            purposes.append(purpose)
            self.assertNotIn("jordan.rivera@example.com", prompt)
            return output
        with patch.object(resume_workflows, "require_codex"):
            queued = resume_workflows.queue_suggestions(run["id"], tailored["id"])
        with patch.object(ats, "_run_codex", side_effect=fake_codex):
            self.assertTrue(resume_store.process_one_job(config.DB, config.DATA, config.ROOT))
        self.assertEqual(purposes, ["resume_suggestions"])
        with database.connect() as db:
            self.assertEqual(db.execute("SELECT COUNT(*) FROM analysis_events WHERE analysis_id=?", (queued["job"]["id"],)).fetchone()[0], 0)
            suggestions = resume_store.list_suggestions(db, tailored["id"], run["id"])
        self.assertEqual(len(suggestions), 2)  # invalid target, mismatched original, and an already-listed skill are dropped
        rewrite = [s for s in suggestions if s["operation"] == "replace"][0]
        skill = [s for s in suggestions if s["operation"] == "add_keyword"][0]
        self.assertTrue(rewrite["needs_verification"])  # "performance" is a new claim even though the model called it a rephrase
        self.assertTrue(skill["needs_verification"])
        revision = self.draft(tailored["id"])["revision"]
        refused = call("POST", f"/api/resume-suggestions/{rewrite['id']}/accept", {"expected_revision": revision})
        self.assertEqual(refused["code"], 400)
        self.assertEqual(self.draft(tailored["id"])["revision"], revision)
        accepted = call("POST", f"/api/resume-suggestions/{rewrite['id']}/accept", {"expected_revision": revision, "confirm_verified": True})
        self.assertEqual(accepted["code"], 200, accepted)
        self.assertEqual(accepted["payload"]["draft"]["revision"], revision + 1)
        self.assertEqual(accepted["payload"]["draft"]["content"]["work"][0]["highlights"][0]["text"], rewrite["proposed_text"])
        stale = call("POST", f"/api/resume-suggestions/{skill['id']}/accept", {"expected_revision": revision, "confirm_verified": True})
        self.assertEqual(stale["code"], 409)
        reverted = call("POST", f"/api/resume-suggestions/{rewrite['id']}/revert", {"expected_revision": revision + 1})
        self.assertEqual(reverted["code"], 200, reverted)
        self.assertEqual(reverted["payload"]["draft"]["content"]["work"][0]["highlights"][0]["text"], bullet["text"])
        rejected = call("PATCH", f"/api/resume-suggestions/{skill['id']}", {"status": "rejected"})
        self.assertEqual(rejected["payload"]["suggestion"]["status"], "rejected")
        # The master draft never changed.
        self.assertEqual(self.draft(self.master["id"])["content"]["work"][0]["highlights"][0]["text"], bullet["text"])
        # Identical draft content reuses the finished job instead of calling Codex again.
        with patch.object(resume_workflows, "require_codex") as checked:
            again = resume_workflows.queue_suggestions(run["id"], tailored["id"])
        self.assertTrue(again["reused"])
        checked.assert_not_called()

    def test_codex_import_runs_once_per_file_and_is_grounded(self):
        draft = resume_workflows.editor_state(self.master["id"])["draft"]
        structured = {"basics": {"name": "Jordan Rivera", "label": "Frontend Engineer", "email": "jordan.rivera@example.com", "phone": "",
                                 "url": "", "location": "Austin, TX", "summary": "", "profiles": []},
                      "work": [{"name": "Northwind Logistics", "position": "Senior Frontend Engineer", "location": "Remote", "startDate": "Mar 2022",
                                "endDate": "Present", "summary": "", "highlights": ["Developed reusable React components for internal applications.",
                                                                                   "Increased revenue 300% at a Fortune 500 company."]}],
                      "projects": [], "skills": [], "education": [], "certificates": [], "awards": [], "custom": [],
                      "section_order": ["work"], "warnings": []}
        calls = []
        with patch.object(resume_workflows, "require_codex"):
            queued = resume_workflows.import_draft(self.master["id"], "codex", draft["revision"])
        self.assertIn("job", queued)
        with patch.object(ats, "_run_codex", side_effect=lambda *args: calls.append(args[3]) or structured):
            resume_store.process_one_job(config.DB, config.DATA, config.ROOT)
        applied = resume_workflows.import_draft(self.master["id"], "codex", draft["revision"])
        self.assertEqual(applied["draft"]["import_source"], "codex")
        self.assertTrue(applied["draft"]["needs_review"])
        highlights = [h["text"] for h in applied["draft"]["content"]["work"][0]["highlights"]]
        self.assertEqual(highlights, ["Developed reusable React components for internal applications."])
        with patch.object(ats, "_run_codex") as codex:
            resume_workflows.import_draft(self.master["id"], "codex", applied["draft"]["revision"])
            codex.assert_not_called()
        self.assertEqual(calls, ["resume_structure"])

    def test_preview_and_validate_routes_and_version_file_auth(self):
        content = resume_workflows.editor_state(self.master["id"])["draft"]["content"]
        preview = call("POST", f"/api/resumes/{self.master['id']}/draft/preview", {"content": content})
        self.assertEqual(preview["code"], 200)
        self.assertEqual(preview["kind"], "application/pdf")
        self.assertEqual(preview["headers"]["X-Page-Count"], "1")
        self.assertTrue(preview["payload"].startswith(b"%PDF-"))
        validation = call("POST", f"/api/resumes/{self.master['id']}/draft/validate", {"content": content})
        self.assertIn("warnings", validation["payload"]["validation"])
        bad = call("POST", f"/api/resumes/{self.master['id']}/draft/preview", {"content": {"basics": {"url": "javascript:x"}}})
        self.assertEqual(bad["code"], 400)
        with database.connect() as db:
            version = ats.current_version(db, self.master["id"])
        resume_token = resumes.get_resume(self.master["id"], include_token=True)["access_token"]
        base = f"/api/resumes/{self.master['id']}/versions/{version['id']}/file"
        self.assertEqual(call("GET", f"{base}?access={version['access_token']}")["code"], 200)
        self.assertEqual(call("GET", f"{base}?access={resume_token}")["code"], 401)
        other = resumes.create_resume({"filename": "other.pdf", "content": base64.b64encode(self.upload_pdf.replace(b"Jordan", b"Jordon")).decode()})
        self.assertEqual(call("GET", f"/api/resumes/{other['id']}/versions/{version['id']}/file?access={version['access_token']}")["code"], 404)

    def test_deleting_master_keeps_tailored_copy_and_clears_pins(self):
        self.reviewed_master_version()
        entry = self.entry()
        tailored, _ = resume_workflows.tailor_resume(entry["id"], self.master["id"])
        follower = self.entry("https://jobs.lever.co/example/frontend-9")
        applications.update_entry(follower["id"], {"resume_id": self.master["id"], "resume_version_id": self.master["current_version_id"]})
        resumes.delete_resume(self.master["id"])
        self.assertTrue(resumes.get_resume(tailored["id"])["available"])
        self.assertEqual(applications.get_entry(follower["id"])["resume_version_id"], "")
        state = resume_workflows.editor_state(tailored["id"])
        self.assertTrue(state["parent"]["deleted"])
        applications.delete_local_entry(entry["id"])
        self.assertIsNotNone(resumes.get_resume(tailored["id"]))


if __name__ == "__main__":
    unittest.main()
