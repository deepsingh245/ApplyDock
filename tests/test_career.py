"""Master Profile, link verification, profile-aware suggestions, and submission history."""
import base64
import hashlib
import json
from pathlib import Path
import socket
import unittest
from unittest.mock import patch

from support import isolate_app
from test_resume_workflow import HAVE_TYPST, call, sample_pdf
from applydock import (applications, ats, career, config, database, delivery, linkcheck, profile, resume_model, resume_store,
                       resume_workflows, resumes, submissions)
from applydock.resume_store import ConflictError


class MasterProfileTests(unittest.TestCase):
    def setUp(self):
        isolate_app(self)

    def test_items_are_validated_versioned_and_conflicts_are_detected(self):
        with database.connect() as db:
            project = profile.create_item(db, "project", {"name": "Auth service", "technologies": "Node.js, Firebase, node.js",
                                                          "repo_url": "github.com/me/auth", "status": "maintained"})
            self.assertEqual(project["data"]["technologies"], ["Node.js", "Firebase"])
            self.assertEqual(project["data"]["repo_url"], "https://github.com/me/auth")
            self.assertEqual(project["verification"], "unverified")
            with self.assertRaisesRegex(ValueError, "name is required"):
                profile.create_item(db, "project", {"summary": "No name"})
            with self.assertRaisesRegex(ValueError, "valid http"):
                profile.create_item(db, "project", {"name": "Bad", "live_url": "javascript:alert(1)"})
            updated = profile.update_item(db, project["id"], {"data": {"functional_status": "working"}, "verification": "verified",
                                                              "expected_revision": project["revision"]})
            self.assertTrue(updated["data"]["functional_checked_at"])
            with self.assertRaises(ConflictError):
                profile.update_item(db, project["id"], {"data": {"name": "Stale"}, "expected_revision": project["revision"]})

    def test_deleting_an_entry_removes_references_to_it(self):
        with database.connect() as db:
            project = profile.create_item(db, "project", {"name": "Auth service"})
            skill = profile.create_item(db, "skill", {"name": "OAuth", "evidence_ids": [project["id"]]})
            profile.delete_item(db, project["id"])
            self.assertEqual(profile.get_item(db, skill["id"])["data"]["evidence_ids"], [])

    def test_evidence_blocks_skip_archived_and_needs_review_and_mark_unverified(self):
        with database.connect() as db:
            verified = profile.create_item(db, "project", {"name": "Auth service", "technologies": ["OAuth"],
                                                           "achievements": [{"text": "Shipped login", "verified": True}]}, "verified")
            profile.create_item(db, "project", {"name": "Draft idea"}, "needs_review")
            archived = profile.create_item(db, "project", {"name": "Old app"}, "verified")
            profile.update_item(db, archived["id"], {"archived": True})
            profile.create_item(db, "experience", {"company": "Acme", "title": "Engineer"}, "unverified")
            private = profile.create_item(db, "project", {"name": "Private tool", "resume_ready": False}, "verified")
            blocks = profile.evidence_blocks(db)
            # A project the user marked "not for resumes" is still evidence, but can never be added to a resume.
            self.assertNotIn("project", [block for block in blocks if block["item_id"] == private["id"]][0])
            blocks = [block for block in blocks if block["item_id"] != private["id"]]
            corpus = profile.verified_corpus(db)
        self.assertEqual([(block["label"], block["verified"]) for block in blocks], [("Engineer — Acme", False), ("Auth service", True)])
        self.assertEqual(blocks[1]["item_id"], verified["id"])
        self.assertEqual(blocks[1]["project"]["keywords"], ["OAuth"])
        self.assertIn("Shipped login", corpus)
        self.assertNotIn("Acme", corpus)  # unverified entries are not known facts

    def test_import_fills_only_empty_fields_and_is_idempotent(self):
        content = json.loads((Path(__file__).resolve().parent / "fixtures" / "sample_resume.json").read_text(encoding="utf-8"))
        with database.connect() as db:
            profile.save_personal(db, {"name": "My Preferred Name"})
            first = profile.import_from_content(db, content, True, "resume:test")
            second = profile.import_from_content(db, content, True, "resume:test")
            data = profile.personal(db)["data"]
            projects = profile.items(db, "project")
        self.assertEqual(data["name"], "My Preferred Name")
        self.assertTrue(data["email"])
        self.assertEqual((first["experience"], first["project"]), (2, 1))
        self.assertEqual(sum(second.values()), 0)
        self.assertEqual(projects[0]["verification"], "verified")
        self.assertEqual(projects[0]["data"]["repo_url"], "https://github.com/jordan-rivera/open-timesheets")


class LinkCheckTests(unittest.TestCase):
    def setUp(self):
        linkcheck._RECENT.clear()

    def test_private_local_and_odd_urls_are_never_requested(self):
        for url in ("ftp://example.com", "http://user:pw@example.com/", "http://example.com:8080/", "http://localhost/",
                    "http://printer.local/", "not a url"):
            with patch.object(linkcheck, "_request") as request:
                result = linkcheck.check_url(url)
            request.assert_not_called()
            self.assertEqual(result["status"], "could_not_verify", url)
        for address in ("127.0.0.1", "10.0.0.5", "192.168.1.1", "169.254.169.254", "::1", "100.64.0.1", "::ffff:10.0.0.1"):
            self.assertFalse(linkcheck.is_public_address(address), address)
        self.assertTrue(linkcheck.is_public_address("93.184.216.34"))
        with patch.object(socket, "getaddrinfo", return_value=[(None, None, None, None, ("93.184.216.34", 443)), (None, None, None, None, ("10.0.0.2", 443))]):
            with self.assertRaises(linkcheck.LinkError):
                linkcheck.resolve_public("mixed.example", 443)

    def test_statuses_redirects_and_redirects_to_private_hosts(self):
        public = lambda host, port: "93.184.216.34"  # noqa: E731
        responses = {"/ok": (200, ""), "/gone": (404, ""), "/login": (401, ""), "/move": (301, "https://other.example/ok"),
                     "/inside": (302, "http://internal.example/admin"), "/head": (405, ""), "/loop": (302, "/loop")}

        def requester(scheme, host, address, port, target, method):
            if target == "/head" and method == "GET":
                return 200, ""
            return responses[target]

        def resolver(host, port):
            if host == "internal.example":
                raise linkcheck.LinkError("could_not_verify", "The link points to a private or local network address, so it was not checked.")
            return public(host, port)
        check = lambda path: linkcheck.check_url("https://site.example" + path, resolver=resolver, requester=requester)  # noqa: E731
        self.assertEqual(check("/ok")["status"], "reachable")
        self.assertEqual(check("/gone")["status"], "unreachable")
        self.assertEqual(check("/login")["status"], "auth_required")
        moved = check("/move")
        self.assertEqual((moved["status"], moved["final_url"]), ("redirected", "https://other.example/ok"))
        self.assertEqual(check("/inside")["status"], "could_not_verify")
        self.assertEqual(check("/head")["status"], "reachable")
        self.assertIn("too many", check("/loop")["detail"])

    def test_a_recently_checked_url_is_not_requested_again(self):
        calls = []
        requester = lambda *args: calls.append(args) or (200, "")  # noqa: E731
        for _ in range(3):
            linkcheck.check_url("https://site.example/", resolver=lambda host, port: "93.184.216.34", requester=requester)
        self.assertEqual(len(calls), 1)


@unittest.skipUnless(HAVE_TYPST, "typst is not installed")
class CareerWorkflowTests(unittest.TestCase):
    def setUp(self):
        isolate_app(self, {"pairing_key": "test", "notion_data_source_id": "", "smtp": {"password": "x"}, "smtp_verified": True})
        patcher = patch.object(ats, "PLAN_LIMIT_PAUSED", False)
        patcher.start(); self.addCleanup(patcher.stop)
        self.master = resumes.create_resume({"filename": "frontend.pdf", "display_name": "Frontend master",
                                            "content": base64.b64encode(sample_pdf()).decode()})
        entry, _ = applications.capture({"url": "https://jobs.lever.co/acme/backend-1", "title": "Backend Engineer", "company": "Acme",
                                         "apply_method": "email", "excerpt": "Node.js APIs with OAuth authentication on Firebase. " * 8})
        applications.update_entry(entry["id"], {"resume_id": self.master["id"]})
        self.entry = applications.get_entry(entry["id"])

    def test_verify_links_stores_results_per_project(self):
        with database.connect() as db:
            project = profile.create_item(db, "project", {"name": "Auth service", "repo_url": "https://github.com/me/auth",
                                                          "live_url": "https://auth.example"})
        fake = lambda url: {"url": url, "status": "reachable", "http_status": 200, "final_url": "", "detail": "", "checked_at": "now"}  # noqa: E731
        with patch.object(linkcheck, "check_url", side_effect=fake):
            result = call("POST", "/api/profile/verify-links", {"item_id": project["id"]})
        self.assertEqual(result["code"], 200, result)
        checks = result["payload"]["profile"]["link_checks"][project["id"]]
        self.assertEqual(set(checks), {"repo_url", "live_url"})
        with database.connect() as db:  # changing a link discards its old result
            profile.update_item(db, project["id"], {"data": {"live_url": "https://new.example"}})
            self.assertEqual(set(profile.link_checks(db)[project["id"]]), {"repo_url"})

    def test_analysis_snapshots_profile_evidence_and_editing_the_profile_allows_a_fresh_run(self):
        with database.connect() as db:
            profile.create_item(db, "project", {"name": "Auth service", "technologies": ["OAuth", "Firebase"]}, "verified")
        first = call("POST", f"/api/entries/{self.entry['id']}/analyses", {})
        with patch.object(ats, "codex_status", return_value={"connected": True, "checked": True}):
            first = call("POST", f"/api/entries/{self.entry['id']}/analyses", {})
            self.assertEqual(first["code"], 200, first)
            with database.connect() as db:
                snapshot = json.loads(db.execute("SELECT profile_json FROM analysis_runs WHERE id=?", (first["payload"]["analysis"]["id"],)).fetchone()[0])
                self.assertEqual(snapshot[0]["label"], "Auth service")
                profile.create_item(db, "skill", {"name": "Node.js"}, "verified")
            second = call("POST", f"/api/entries/{self.entry['id']}/analyses", {})
        self.assertNotEqual(first["payload"]["analysis"]["id"], second["payload"]["analysis"]["id"])
        # The dashboard compares these two values to say "your profile changed since this analysis".
        state = call("GET", "/api/state")["payload"]
        self.assertEqual(second["payload"]["analysis"]["profile_hash"], state["profile_hash"])
        self.assertEqual(applications.get_entry(self.entry["id"])["analysis"]["profile_hash"], state["profile_hash"])
        with database.connect() as db:  # editing only the personal summary is a change too
            profile.save_personal(db, {"summary": "Backend engineer focused on authentication."})
        self.assertNotEqual(call("GET", "/api/state")["payload"]["profile_hash"], state["profile_hash"])

    def test_profile_project_suggestion_adds_a_real_project_and_reverts(self):
        with database.connect() as db:
            project = profile.create_item(db, "project", {"name": "Auth service", "technologies": ["Node.js", "OAuth"],
                                                          "live_url": "https://auth.example", "summary": "Login for my apps."}, "verified")
            blocks = profile.evidence_blocks(db)
        state = resume_workflows.editor_state(self.master["id"])
        with database.connect() as db:
            resume_store.save_draft(db, self.master["id"], state["draft"]["content"], state["draft"]["revision"], reviewed=True)
        resume_workflows.save_editor_version(self.master["id"], state["draft"]["revision"] + 1)
        tailored, _ = resume_workflows.tailor_resume(self.entry["id"], self.master["id"])
        with database.connect() as db:
            draft = resume_store.open_draft(db, tailored["id"])
            resume_store.save_draft(db, tailored["id"], draft["content"], draft["revision"], reviewed=True)
        run, _ = ats.queue_analysis(config.DB, self.entry, profile_blocks=blocks)
        requirements = [{"id": "J1", "category": "required_skills", "requirement": "OAuth authentication", "mandatory": True,
                         "status": "missing", "coverage": "profile_only", "profile_evidence_ids": ["P1"]}]
        with database.connect() as db:
            db.execute("UPDATE analysis_runs SET status='complete',result_json=? WHERE id=?", (json.dumps({"requirements": requirements}), run["id"]))
        output = {"notes": "", "suggestions": [
            {"requirement_id": "J1", "target_id": "projects", "field": "text", "operation": "add_project", "original_text": "",
             "proposed_text": "Built OAuth login with Node.js for my own apps.", "reason": "Shows authentication.", "claim_type": "rephrase",
             "source_profile_id": "P1"},
            {"requirement_id": "J1", "target_id": "projects", "field": "text", "operation": "add_project", "original_text": "",
             "proposed_text": "Invented project.", "reason": "", "claim_type": "rephrase", "source_profile_id": "P7"}]}
        prompts = []
        with patch.object(resume_workflows, "require_codex"):
            resume_workflows.queue_suggestions(run["id"], tailored["id"])
        with patch.object(ats, "_run_codex", side_effect=lambda root, prompt, *rest: prompts.append(prompt) or output):
            resume_store.process_one_job(config.DB, config.DATA, config.ROOT)
        self.assertIn("MASTER PROFILE EVIDENCE", prompts[0])
        with database.connect() as db:
            suggestions = resume_store.list_suggestions(db, tailored["id"], run["id"])
        self.assertEqual(len(suggestions), 1)  # an unknown profile id is dropped
        suggestion = suggestions[0]
        self.assertEqual((suggestion["source"]["item_id"], suggestion["project"]["url"]), (project["id"], "https://auth.example"))
        self.assertFalse(suggestion["needs_verification"])  # every fact comes from a verified profile entry
        with database.connect() as db:
            revision = resume_store.get_draft(db, tailored["id"])["revision"]
        accepted = call("POST", f"/api/resume-suggestions/{suggestion['id']}/accept", {"expected_revision": revision})
        self.assertEqual(accepted["code"], 200, accepted)
        added = [item for item in accepted["payload"]["draft"]["content"]["projects"] if item["name"] == "Auth service"][0]
        self.assertEqual((added["url"], added["keywords"], added["highlights"][0]["text"]),
                         ("https://auth.example", ["Node.js", "OAuth"], "Built OAuth login with Node.js for my own apps."))
        with database.connect() as db:  # the master resume is untouched
            self.assertFalse(any(p["name"] == "Auth service" for p in resume_store.get_draft(db, self.master["id"])["content"]["projects"]))
        reverted = call("POST", f"/api/resume-suggestions/{suggestion['id']}/revert", {"expected_revision": revision + 1})
        self.assertEqual(reverted["code"], 200, reverted)
        self.assertFalse(any(p["name"] == "Auth service" for p in reverted["payload"]["draft"]["content"]["projects"]))

    def test_draft_check_scores_unsaved_edits_and_becomes_the_saved_versions_result(self):
        state = resume_workflows.editor_state(self.master["id"])
        content = state["draft"]["content"]
        content["basics"]["label"] = "Backend Engineer"
        with database.connect() as db:
            draft = resume_store.save_draft(db, self.master["id"], content, state["draft"]["revision"], reviewed=True)
            versions_before = db.execute("SELECT COUNT(*) FROM resume_versions WHERE resume_id=?", (self.master["id"],)).fetchone()[0]
        with patch.object(ats, "codex_status", return_value={"connected": True, "checked": True}):
            result = call("POST", f"/api/resumes/{self.master['id']}/draft/analyze", {"entry_id": self.entry["id"], "expected_revision": draft["revision"]})
        self.assertEqual(result["code"], 200, result)
        run = result["payload"]["analysis"]
        with database.connect() as db:
            row = db.execute("SELECT * FROM analysis_runs WHERE id=?", (run["id"],)).fetchone()
            self.assertEqual(db.execute("SELECT COUNT(*) FROM resume_versions WHERE resume_id=?", (self.master["id"],)).fetchone()[0], versions_before)
            draft_path = config.DATA / db.execute("SELECT stored_path FROM resume_documents WHERE id=?", (row["document_id"],)).fetchone()[0]
        self.assertEqual((row["resume_version_id"], row["draft_resume_id"]), ("", self.master["id"]))
        self.assertTrue(draft_path.is_file())
        stale = call("POST", f"/api/resumes/{self.master['id']}/draft/analyze", {"entry_id": self.entry["id"], "expected_revision": 0})
        self.assertEqual(stale["code"], 409)
        checklist = {"warnings": [], "requirements": [
            {"id": "J1", "category": "required_skills", "requirement": "Node.js", "mandatory": True, "priority": "high", "terms": []},
            {"id": "J2", "category": "required_skills", "requirement": "OAuth", "mandatory": True, "priority": "high", "terms": []}]}
        output = {"summary": "", "warnings": [], "assessments": []}
        parse = {"summary": "", "skills": [], "experience": [], "projects": [], "education": [], "certifications": [], "keywords": []}
        with patch.object(ats, "_run_codex", side_effect=lambda r, p, s, purpose, *rest: {"resume_parse": parse, "jd_requirements": checklist}.get(purpose, output)):
            ats.process_one(config.DB, config.DATA, config.ROOT)
        self.assertTrue(ats.get_analysis(config.DB, run["id"])["result"]["draft"])
        # Saving the identical content later reuses this result, now attached to the saved version.
        saved = resume_workflows.save_editor_version(self.master["id"], draft["revision"])
        reused, cached = ats.queue_analysis(config.DB, self.entry, resume_version_id=saved["version_id"])
        self.assertEqual((reused["id"], reused["resume_version_id"], cached), (run["id"], saved["version_id"], True))
        # A draft check of another (unsaved) text is removed with its resume.
        content["basics"]["label"] = "Platform Engineer"
        with database.connect() as db:
            draft = resume_store.save_draft(db, self.master["id"], content, draft["revision"])
        with patch.object(ats, "codex_status", return_value={"connected": True, "checked": True}):
            other = resume_workflows.analyze_draft(self.master["id"], self.entry["id"], draft["revision"])["analysis"]
        with database.connect() as db:
            other_path = config.DATA / db.execute("SELECT rd.stored_path FROM analysis_runs ar JOIN resume_documents rd ON rd.id=ar.document_id WHERE ar.id=?",
                                                  (other["id"],)).fetchone()[0]
        resumes.delete_resume(self.master["id"])
        self.assertIsNone(ats.get_analysis(config.DB, other["id"]))
        self.assertFalse(other_path.is_file())

    def test_profile_entries_are_copied_into_the_draft_exactly_and_safely(self):
        with database.connect() as db:
            profile.save_personal(db, {"summary": "Backend engineer focused on authentication.", "headline": "Backend Engineer"})
            project = profile.create_item(db, "project", {"name": "Auth service", "technologies": ["Node.js", "OAuth"], "summary": "Login for my apps.",
                                                          "repo_url": "https://github.com/me/auth",
                                                          "achievements": [{"text": "Shipped OAuth login.", "verified": True}, {"text": "Unproven claim.", "verified": False}]}, "verified")
            private = profile.create_item(db, "project", {"name": "Private tool", "resume_ready": False}, "verified")
            experience = profile.create_item(db, "experience", {"company": "Acme", "title": "Backend Intern", "start": "2023-01",
                                                                "achievements": [{"text": "Built billing APIs.", "verified": True}]}, "unverified")
            skill = profile.create_item(db, "skill", {"name": "PostgreSQL", "category": "databases"}, "verified")
        tailored_master = self.master["id"]
        state = resume_workflows.editor_state(tailored_master)
        revision = state["draft"]["revision"]
        add = lambda key, **extra: call("POST", f"/api/resumes/{tailored_master}/draft/add-from-profile", {"key": key, "expected_revision": revision, **extra})  # noqa: E731
        listed = call("GET", f"/api/resumes/{tailored_master}/draft/profile-entries")["payload"]["entries"]
        self.assertEqual({entry["key"]: entry["in_resume"] for entry in listed}[project["id"]], False)
        self.assertFalse({entry["key"]: entry for entry in listed}[private["id"]]["addable"])

        result = add(project["id"])
        self.assertEqual(result["code"], 200, result)
        revision = result["payload"]["draft"]["revision"]
        added = [p for p in result["payload"]["draft"]["content"]["projects"] if p["name"] == "Auth service"][0]
        self.assertEqual((added["url"], added["keywords"], [h["text"] for h in added["highlights"]]),
                         ("https://github.com/me/auth", ["Node.js", "OAuth"], ["Shipped OAuth login."]))  # unverified bullet left out
        self.assertTrue({entry["key"]: entry for entry in result["payload"]["entries"]}[project["id"]]["in_resume"])
        self.assertIn("Already in this resume", add(project["id"])["payload"]["error"])
        self.assertIn("not for resumes", add(private["id"])["payload"]["error"])
        self.assertIn("not verified", add(experience["id"])["payload"]["error"])
        result = add(experience["id"], confirm_unverified=True)
        revision = result["payload"]["draft"]["revision"]
        work = [w for w in result["payload"]["draft"]["content"]["work"] if w["name"] == "Acme"][0]
        self.assertEqual((work["position"], work["startDate"], [h["text"] for h in work["highlights"]]), ("Backend Intern", "2023-01", ["Built billing APIs."]))
        result = add(skill["id"])
        revision = result["payload"]["draft"]["revision"]
        self.assertIn("PostgreSQL", [k for group in result["payload"]["draft"]["content"]["skills"] for k in group["keywords"]])
        # A summary that already exists is only replaced after confirmation.
        has_summary = bool(result["payload"]["draft"]["content"]["basics"]["summary"])
        if has_summary:
            self.assertIn("Confirm replacing", add("personal:summary")["payload"]["error"])
        result = add("personal:summary", replace=True)
        self.assertEqual(result["payload"]["draft"]["content"]["basics"]["summary"], "Backend engineer focused on authentication.")
        self.assertEqual(add("personal:summary", expected_revision=0)["code"], 409)
        with database.connect() as db:  # nothing became a version
            self.assertEqual(db.execute("SELECT COUNT(*) FROM resume_versions WHERE resume_id=?", (tailored_master,)).fetchone()[0], 1)

    def test_suggestion_prompt_offers_an_empty_summary(self):
        content = resume_model.normalize({"basics": {"name": "Jordan"}, "work": [{"name": "Acme", "position": "Engineer", "highlights": [{"text": "Built APIs."}]}]})
        prompt = resume_store.suggestion_prompt(content, [], "Job text")
        items = json.loads(prompt.split("RESUME ITEMS:\n", 1)[1].split("\n\nREQUIREMENTS", 1)[0])
        self.assertEqual(items[0], {"target_id": "basics", "field": "summary", "section": "summary", "label": "summary", "text": ""})
        output = {"suggestions": [{"requirement_id": "", "target_id": "basics", "field": "summary", "operation": "replace", "original_text": "",
                                   "proposed_text": "Engineer who built APIs at Acme.", "reason": "", "claim_type": "rephrase", "source_profile_id": ""}]}
        valid = resume_store.validated_suggestions(output, content, [], "Acme Engineer Built APIs.")
        self.assertEqual((len(valid), valid[0]["field"], valid[0]["original_text"]), (1, "summary", ""))

    def test_recorded_submission_keeps_the_exact_file_after_edits_and_deletion(self):
        result = call("POST", f"/api/entries/{self.entry['id']}/submissions", {"channel": "external", "submitted_at": "2026-10-01"})
        self.assertEqual(result["code"], 200, result)
        submission = result["payload"]["submission"]
        self.assertEqual((submission["evidence"], submission["version_number"], submission["channel"]), ("user_reported", 1, "external"))
        self.assertEqual(result["payload"]["entry"]["application_stage"], "Applied")
        self.assertEqual(result["payload"]["entry"]["submission"]["id"], submission["id"])
        original_sha = submission["sha256"]
        # A new master version and the master's deletion must not touch what was submitted.
        resumes.update_resume(self.master["id"], {"filename": "v2.pdf", "content": base64.b64encode(sample_pdf() + b"\n%v2").decode()})
        resumes.delete_resume(self.master["id"])
        token = submission["file_url"].split("access=")[1]
        served = call("GET", f"/api/submissions/{submission['id']}/file?access={token}")
        self.assertEqual(served["code"], 200, served)
        self.assertEqual(hashlib.sha256(served["payload"]).hexdigest(), original_sha)
        self.assertEqual(call("GET", f"/api/submissions/{submission['id']}/file?access=wrong")["code"], 401)

    def test_changing_the_record_keeps_an_audit_trail(self):
        first = career.record_submission(self.entry["id"], {"channel": "external"})["submission"]
        second = career.record_submission(self.entry["id"], {"channel": "other", "note": "Re-sent via recruiter"})["submission"]
        history = career.entry_submissions(self.entry["id"])["submissions"]
        self.assertEqual([item["id"] for item in history], [second["id"], first["id"]])
        self.assertEqual((history[1]["active"], history[1]["replaced_by"]), (False, second["id"]))
        with self.assertRaisesRegex(ValueError, "Choose how"):
            career.record_submission(self.entry["id"], {"channel": "carrier pigeon"})
        usage = career.resume_usage(self.master["id"])
        self.assertEqual([item["id"] for item in usage["submissions"]], [second["id"]])

    def test_recording_a_submission_cancels_a_pending_local_send(self):
        with database.connect() as db:
            db.execute("UPDATE entries SET status='approved',delivery_mode='local' WHERE id=?", (self.entry["id"],))
        career.record_submission(self.entry["id"], {"channel": "external"})
        self.assertEqual(applications.get_entry(self.entry["id"])["status"], "draft")

    def test_smtp_send_records_a_verified_submission_and_drafts_do_not(self):
        with database.connect() as db:
            version = ats.effective_version(db, self.entry)
        delivery.record_sent_submission(self.entry, {**dict(version), "message_id": "<abc@applydock.local>"})
        record = applications.get_entry(self.entry["id"])["submission"]
        self.assertEqual((record["evidence"], record["channel"], record["message_ref"]), ("verified", "email", "<abc@applydock.local>"))
        self.assertEqual(applications.get_entry(self.entry["id"])["application_stage"], "Applied")
        with database.connect() as db:
            self.assertEqual(submissions.kept_document_ids(db), {version["document_id"]})
