import datetime as dt
import base64
import email
import hashlib
import os
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
import urllib.parse
from unittest.mock import patch

import server


class CoreTests(unittest.TestCase):
    def setUp(self):
        scratch = server.ROOT / ".tmp"
        scratch.mkdir(exist_ok=True)
        self.tmp = tempfile.TemporaryDirectory(prefix="applydock-test-", dir=scratch)
        self.addCleanup(self.tmp.cleanup)
        root = Path(self.tmp.name)
        self.db_patch = patch.object(server, "DB", root / "test.sqlite3")
        self.data_patch = patch.object(server, "DATA", root)
        self.config_patch = patch.object(server, "CONFIG_DATA", {"pairing_key": "test", "notion_data_source_id": "", "smtp": {"password": "encrypted"}, "smtp_verified": True})
        for p in (self.db_patch, self.data_patch, self.config_patch):
            p.start(); self.addCleanup(p.stop)
        server.init_db()
        self.sync_patch = patch.object(server, "sync_entry")
        self.sync_patch.start(); self.addCleanup(self.sync_patch.stop)

    def test_only_specific_items_and_deduplicates(self):
        with self.assertRaises(ValueError): server.capture({"url": "https://www.linkedin.com/feed/"})
        with self.assertRaises(ValueError): server.capture({"url": "https://example.com/"})
        first, duplicate = server.capture({"url": "https://www.linkedin.com/jobs/view/123/?trk=foo", "title": "Engineer"})
        second, duplicate_again = server.capture({"url": "https://www.linkedin.com/jobs/search/?currentJobId=123"})
        self.assertFalse(duplicate)
        self.assertTrue(duplicate_again)
        self.assertEqual(first["id"], second["id"])
        self.assertEqual(first["status"], "draft")

    def test_selected_cross_platform_job_and_post(self):
        job, duplicate = server.capture({"url": "https://jobs.lever.co/example/abc?utm_source=feed", "title": "Engineer", "apply_method": "external_form", "apply_url": "https://jobs.lever.co/example/abc/apply"})
        again, duplicate_again = server.capture({"url": "https://jobs.lever.co/example/abc", "title": "Engineer"})
        self.assertFalse(duplicate)
        self.assertTrue(duplicate_again)
        self.assertEqual(job["id"], again["id"])
        self.assertEqual(job["platform"], "Lever")
        self.assertEqual(job["apply_method"], "external_form")
        self.assertEqual(job["needs_review"], 1)
        post, _ = server.capture({"url": "https://example.org/hiring-team/post-1", "kind": "post"})
        self.assertEqual(post["kind"], "post")
        self.assertEqual(post["platform"], "Other")
        for url in ("https://localhost/jobs/1", "https://127.0.0.1/jobs/1", "http://example.org/jobs/1"):
            with self.assertRaises(ValueError): server.capture({"url": url})

    def test_post_contacts_and_instructions_survive_edits(self):
        post, _ = server.capture({
            "url": "https://www.linkedin.com/posts/hiring_activity-123/",
            "kind": "post",
            "title": "Hiring engineers",
            "excerpt": "Send your CV to Jobs@Example.com or team@example.com. Apply by Friday.",
            "post_details": "Remote in India; send a portfolio with the CV.",
        })
        self.assertEqual(post["contact_emails"], ["jobs@example.com", "team@example.com"])
        self.assertEqual(post["recipient"], "jobs@example.com")
        self.assertEqual(post["apply_method"], "email")
        self.assertIn("Remote in India", post["post_details"])
        updated = server.update_entry(post["id"], {"contact_emails": "team@example.com\nnew@example.com", "post_details": "Use the new contact."})
        self.assertEqual(updated["contact_emails"], ["team@example.com", "new@example.com"])
        self.assertEqual(server.get_entry(post["id"])["post_details"], "Use the new contact.")

    def test_existing_posts_backfill_contact_emails(self):
        with server.connect() as db:
            db.execute("DROP TABLE entries")
            db.execute("PRAGMA user_version=0")
            db.execute("""CREATE TABLE entries (
                id TEXT PRIMARY KEY, url TEXT NOT NULL UNIQUE, kind TEXT NOT NULL,
                title TEXT NOT NULL, company TEXT NOT NULL DEFAULT '', excerpt TEXT NOT NULL DEFAULT '',
                recipient TEXT NOT NULL DEFAULT '', subject TEXT NOT NULL DEFAULT '', body TEXT NOT NULL DEFAULT '',
                send_at TEXT NOT NULL DEFAULT '', resume_path TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL DEFAULT 'draft', notion_id TEXT NOT NULL DEFAULT '',
                sync_error TEXT NOT NULL DEFAULT '', send_error TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL, updated_at TEXT NOT NULL, sent_at TEXT NOT NULL DEFAULT ''
            )""")
            db.execute("INSERT INTO entries(id,url,kind,title,excerpt,recipient,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)",
                       ("older-post", "https://www.linkedin.com/posts/older_activity-1/", "post", "Older post",
                        "Email Hiring@Example.com. More info: team@example.com", "hiring@example.com", "now", "now"))
        server.init_db()
        self.assertEqual(server.get_entry("older-post")["contact_emails"], ["hiring@example.com", "team@example.com"])

    def test_notion_trash_removes_only_local_record_and_errors_keep_it(self):
        removed, _ = server.capture({"url": "https://www.linkedin.com/jobs/view/101/", "title": "Remove locally"})
        kept, _ = server.capture({"url": "https://www.linkedin.com/jobs/view/102/", "title": "Keep locally"})
        with server.connect() as db:
            db.execute("UPDATE entries SET notion_id=? WHERE id=?", ("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", removed["id"]))
            db.execute("UPDATE entries SET notion_id=? WHERE id=?", ("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", kept["id"]))
        server.CONFIG_DATA.update({"notion_token": "encrypted", "notion_data_source_id": "source"})

        def notion(method, path, payload=None):
            self.assertEqual(method, "GET")
            if path.endswith("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"):
                return {"object": "page", "id": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", "in_trash": True}
            raise RuntimeError("Notion 404: page missing or access revoked")

        with patch.object(server, "notion_request", side_effect=notion) as request:
            result = server.reconcile_notion_deletions(force=True)
        self.assertEqual(result["removed"], 1)
        self.assertIsNone(server.get_entry(removed["id"]))
        self.assertIsNotNone(server.get_entry(kept["id"]))
        self.assertEqual({call.args[0] for call in request.call_args_list}, {"GET"})
        with patch.object(server, "notion_request") as request:
            self.assertEqual(server.delete_local_entry(kept["id"]), 1)
            request.assert_not_called()
        self.assertIsNone(server.get_entry(kept["id"]))

    def test_trashed_notion_page_cancels_local_send(self):
        entry, _ = server.capture({"url": "https://www.linkedin.com/jobs/view/103/", "title": "Cancelled"})
        current = dt.datetime.now().astimezone().replace(hour=9, minute=0, second=0, microsecond=0)
        with server.connect() as db:
            db.execute("UPDATE entries SET status='approved',notion_id=?,send_at=? WHERE id=?",
                       ("cccccccc-cccc-cccc-cccc-cccccccccccc", (current - dt.timedelta(days=1)).isoformat(), entry["id"]))
        server.CONFIG_DATA.update({"notion_token": "encrypted", "notion_data_source_id": "source"})
        with patch.object(server, "notion_request", return_value={"object": "page", "id": "cccccccc-cccc-cccc-cccc-cccccccccccc", "in_trash": True}), patch.object(server, "send_mail") as sender:
            self.assertEqual(server.process_due(current), 0)
            sender.assert_not_called()
        self.assertIsNone(server.get_entry(entry["id"]))

    def test_unavailable_notion_page_postpones_local_send(self):
        entry, _ = server.capture({"url": "https://www.linkedin.com/jobs/view/104/", "title": "Wait for verification"})
        current = dt.datetime.now().astimezone().replace(hour=9, minute=0, second=0, microsecond=0)
        with server.connect() as db:
            db.execute("UPDATE entries SET status='approved',notion_id=?,send_at=? WHERE id=?",
                       ("dddddddd-dddd-dddd-dddd-dddddddddddd", (current - dt.timedelta(days=1)).isoformat(), entry["id"]))
        server.CONFIG_DATA.update({"notion_token": "encrypted", "notion_data_source_id": "source"})
        with patch.object(server, "notion_request", side_effect=RuntimeError("Notion 404: access revoked")), patch.object(server, "send_mail") as sender:
            self.assertEqual(server.process_due(current), 0)
            sender.assert_not_called()
        self.assertEqual(server.get_entry(entry["id"])["status"], "approved")
        self.assertIn("Could not verify Notion", server.get_entry(entry["id"])["sync_error"])

    def test_delete_route_never_calls_notion(self):
        entry, _ = server.capture({"url": "https://www.linkedin.com/jobs/view/105/", "title": "Local only"})
        replies = []
        handler = SimpleNamespace(path="/api/entries/" + entry["id"], authorized=lambda: True,
                                  respond=lambda code, data: replies.append((code, data)))
        with patch.object(server, "notion_request") as request:
            server.Handler.mutate(handler, "DELETE")
            request.assert_not_called()
        self.assertEqual(replies, [(200, {"ok": True, "notion_unchanged": True})])
        self.assertIsNone(server.get_entry(entry["id"]))

    def test_saved_configuration_loads_after_restart(self):
        config_path = Path(self.tmp.name) / "config.json"
        with patch.object(server, "CONFIG", config_path):
            server.save_config({"pairing_key": "test", "notion_data_source_id": "source", "candidate_profile": "Python engineer", "candidate_profile_saved": True, "smtp": {"host": "smtp.gmail.com", "username": "person@gmail.com"}})
            loaded = server.load_config()
        self.assertEqual(loaded["candidate_profile"], "Python engineer")
        self.assertTrue(loaded["candidate_profile_saved"])
        self.assertEqual(loaded["smtp"]["username"], "person@gmail.com")

    @unittest.skipUnless(os.name == "nt", "Windows credential storage")
    def test_credentials_are_encrypted_for_current_account(self):
        encrypted = server.protect("temporary-check")
        self.assertNotIn("temporary-check", encrypted)
        self.assertEqual(server.unprotect(encrypted), "temporary-check")

    def test_gmail_requires_full_address_and_app_password(self):
        base = {"host": "smtp.gmail.com", "port": 465, "from": "person@gmail.com", "username": "Person", "password": "short"}
        with self.assertRaisesRegex(ValueError, "full email address"):
            server.prepare_smtp_settings(base)
        base["username"] = "person@gmail.com"
        with self.assertRaisesRegex(ValueError, "16-character"):
            server.prepare_smtp_settings(base)
        base["password"] = "abcd efgh ijkl mnop"
        settings, password = server.prepare_smtp_settings(base)
        self.assertEqual(settings["username"], "person@gmail.com")
        self.assertEqual(password, "abcdefghijklmnop")

    def test_ai_draft_is_explicit_and_returns_unapproved_suggestion(self):
        entry, _ = server.capture({"url": "https://www.linkedin.com/jobs/view/321/", "title": "Engineer", "excerpt": "Python role"})
        server.CONFIG_DATA["candidate_profile"] = "I use Python professionally."
        output = '{"subject":"Engineer application","body":"Hello hiring team","notes":"Confirm recipient"}'
        with patch.object(server.shutil, "which", return_value="codex"), patch.object(server.subprocess, "run", return_value=SimpleNamespace(returncode=0, stdout=output)) as run:
            draft = server.generate_ai_draft(entry)
        self.assertEqual(draft["subject"], "Engineer application")
        self.assertIn("--sandbox", run.call_args.args[0])
        self.assertIn("read-only", run.call_args.args[0])
        self.assertEqual(server.get_entry(entry["id"])["status"], "draft")

    def test_send_requires_complete_explicit_approval_and_runs_once(self):
        entry, _ = server.capture({"url": "https://www.linkedin.com/posts/person_activity-123/"})
        target = dt.datetime.now().astimezone().replace(hour=9, minute=0, second=0, microsecond=0) + dt.timedelta(days=1)
        with patch.object(server, "send_mail") as sender:
            self.assertEqual(server.process_due(target), 0)
            sender.assert_not_called()
            with self.assertRaisesRegex(ValueError, "Only email applications"):
                server.update_entry(entry["id"], {"approved": True})
            resume = Path(self.tmp.name) / "resumes" / "test.pdf"
            resume.parent.mkdir()
            resume.write_bytes(b"%PDF-test")
            fields = {"apply_method": "email", "recipient": "hiring@example.com", "subject": "Application", "body": "Hello", "resume_path": "resumes/test.pdf", "send_at": target.astimezone(dt.timezone.utc).isoformat()}
            server.update_entry(entry["id"], fields)
            server.update_entry(entry["id"], {"approved": True})
            server.update_entry(entry["id"], {"subject": "Revised application"})
            self.assertEqual(server.get_entry(entry["id"])["status"], "draft")
            server.update_entry(entry["id"], {"approved": True})
            self.assertEqual(server.process_due(target.replace(hour=8)), 0)
            sender.assert_not_called()
            self.assertEqual(server.process_due(target), 1)
            self.assertEqual(server.process_due(target), 0)
            sender.assert_called_once()
            self.assertEqual(server.get_entry(entry["id"])["status"], "sent")

    def test_notion_receives_structured_columns(self):
        entry, _ = server.capture({"url": "https://www.linkedin.com/jobs/view/456/", "title": "Designer", "company": "Example Co"})
        server.CONFIG_DATA["notion_data_source_id"] = "source-id"
        server.CONFIG_DATA["notion_token"] = "mock-encrypted-token"
        calls = []

        def notion(method, path, payload=None):
            calls.append((method, path, payload))
            if method == "GET": return {"properties": {"Name": {"type": "title"}}}
            return {"id": "page-id"}

        self.sync_patch.stop()
        with patch.object(server, "notion_request", side_effect=notion):
            server.sync_entry(entry["id"])
        create = next(payload for method, path, payload in calls if method == "POST")
        self.assertEqual(create["parent"]["data_source_id"], "source-id")
        self.assertEqual(create["properties"]["Source URL"]["url"], entry["url"])
        self.assertEqual(create["properties"]["Company"]["rich_text"][0]["text"]["content"], "Example Co")
        self.assertEqual(create["properties"]["Application Method"]["select"]["name"], "Unknown")
        self.assertEqual(create["properties"]["Contact Emails"]["rich_text"], [])
        self.assertEqual(create["properties"]["Post Details"]["rich_text"], [])
        self.assertTrue(create["properties"]["Needs Review"]["checkbox"])
        self.assertEqual(server.get_entry(entry["id"])["notion_id"], "page-id")

    def test_existing_applications_database_uses_company_title_and_link(self):
        schema = {"Company": {"type": "title"}, "Position": {"type": "rich_text"}, "Link": {"type": "url"}, "Email": {"type": "email"}, "Stage": {"type": "status"}, "Application Source": {"type": "select", "select": {"options": [{"name": "Linkedin"}, {"name": "Lever"}]}}}
        with patch.object(server, "notion_request", side_effect=lambda method, path, payload=None: {"properties": schema} if method == "GET" else {"id": "source"}) as request:
            mapping = server.ensure_notion_schema("source")
        self.assertEqual(mapping["title"], "Company")
        self.assertEqual(mapping["position"], "Position")
        self.assertEqual(mapping["url"], "Link")
        self.assertEqual(mapping["recipient"], "Email")
        self.assertEqual(mapping["application_source_option"], "Linkedin")
        created = next(call.args[2] for call in request.call_args_list if call.args[0] == "PATCH")
        self.assertNotIn("Company", created["properties"])
        self.assertNotIn("Source URL", created["properties"])
        server.CONFIG_DATA["notion_mapping"] = mapping
        entry, _ = server.capture({"url": "https://www.linkedin.com/jobs/view/789/", "title": "Engineer", "company": "Example Co"})
        properties = server.notion_properties(entry)
        self.assertEqual(properties["Company"]["title"][0]["text"]["content"], "Example Co")
        self.assertEqual(properties["Position"]["rich_text"][0]["text"]["content"], "Engineer")
        self.assertEqual(properties["Application Source"]["select"]["name"], "Linkedin")
        lever, _ = server.capture({"url": "https://jobs.lever.co/example/another-id", "title": "Engineer", "company": "Example Co"})
        self.assertEqual(server.notion_properties(lever)["Application Source"]["select"]["name"], "Lever")

    @unittest.skipUnless(os.name == "nt", "Windows credential storage")
    def test_gmail_oauth_url_uses_state_pkce_and_scoped_permission(self):
        client = {"installed": {"client_id": "example-123.apps.googleusercontent.com", "client_secret": "desktop-secret",
                "auth_uri": "https://accounts.google.com/o/oauth2/auth", "token_uri": "https://oauth2.googleapis.com/token"}}
        with patch.object(server, "save_config"):
            server.configure_gmail_client(client)
            url = server.begin_gmail_oauth()
            query = urllib.parse.parse_qs(urllib.parse.urlsplit(url).query)
            self.assertEqual(query["scope"], [server.GMAIL_SCOPE])
            self.assertEqual(query["code_challenge_method"], ["S256"])
            self.assertEqual(query["redirect_uri"], [server.GMAIL_REDIRECT])
            token = {"access_token": "access", "refresh_token": "refresh", "scope": server.GMAIL_SCOPE}
            with patch.object(server, "google_token_request", return_value=token) as exchange, patch.object(server, "gmail_api_request", return_value={"emailAddress": "person@gmail.com"}):
                self.assertEqual(server.complete_gmail_oauth({"state": query["state"], "code": ["code"]}), "person@gmail.com")
            self.assertEqual(server.unprotect(server.CONFIG_DATA["gmail_refresh_token"]), "refresh")
            verifier = exchange.call_args.args[0]["code_verifier"]
            challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
            self.assertEqual(query["code_challenge"], [challenge])

    def test_gmail_draft_has_resume_and_never_enters_local_sender(self):
        entry, _ = server.capture({"url": "https://jobs.lever.co/example/gmail-job", "title": "Engineer", "apply_method": "email"})
        resume = Path(self.tmp.name) / "resumes" / "resume.pdf"
        resume.parent.mkdir()
        resume.write_bytes(b"%PDF-test")
        server.update_entry(entry["id"], {"recipient": "hiring@example.com", "subject": "Application", "body": "Hello", "resume_path": "resumes/resume.pdf"})
        server.CONFIG_DATA.update({"gmail_refresh_token": "encrypted", "gmail_address": "person@gmail.com"})
        calls = []
        def gmail(method, path, token, payload=None):
            calls.append((method, path, payload))
            return {"id": "draft_123"}
        with patch.object(server, "gmail_access_token", return_value="access"), patch.object(server, "gmail_api_request", side_effect=gmail):
            result = server.save_gmail_draft(entry["id"])
            self.assertEqual(result["delivery_mode"], "gmail_draft")
            self.assertEqual(result["status"], "draft")
            raw = calls[0][2]["message"]["raw"]
            message = email.message_from_bytes(base64.urlsafe_b64decode(raw + "=" * (-len(raw) % 4)))
            self.assertEqual(message["To"], "hiring@example.com")
            self.assertEqual(message["From"], "person@gmail.com")
            self.assertEqual(message.get_payload()[1].get_payload(decode=True), b"%PDF-test")
            with self.assertRaisesRegex(ValueError, "Prepare an up-to-date"):
                server.mark_gmail_scheduled(entry["id"])
            server.save_gmail_draft(entry["id"])
            self.assertEqual(calls[-1][0], "GET")
            server.update_entry(entry["id"], {"subject": "Revised application"})
            self.assertEqual(server.get_entry(entry["id"])["gmail_dirty"], 1)
            with self.assertRaisesRegex(ValueError, "Prepare an up-to-date"):
                server.mark_gmail_scheduled(entry["id"])
            result = server.save_gmail_draft(entry["id"], prepare_schedule=True)
            self.assertEqual(calls[-1][0], "PUT")
            self.assertEqual(result["delivery_mode"], "gmail_schedule_pending")
            self.assertEqual(server.mark_gmail_scheduled(entry["id"])["delivery_mode"], "gmail_scheduled")
        with server.connect() as db:
            db.execute("UPDATE entries SET status='approved' WHERE id=?", (entry["id"],))
        with patch.object(server, "send_mail") as sender:
            nine = dt.datetime.now().astimezone().replace(hour=9, minute=0, second=0, microsecond=0)
            self.assertEqual(server.process_due(nine), 0)
            sender.assert_not_called()


if __name__ == "__main__": unittest.main()
