import unittest
from unittest import mock

from support import isolate_app
from applydock import applications, auto_email, config, database, profile


def make_post(**extra):
    entry, _ = applications.capture({
        "url": "https://www.linkedin.com/posts/team_hiring-1/", "kind": "post", "title": "Hiring React dev", "company": "Acme",
        "excerpt": "We are hiring. Email jobs@acme.com", **extra})
    with database.LOCK, database.connect() as db:
        db.execute("UPDATE entries SET resume_id='r1' WHERE id=?", (entry["id"],))
    return entry["id"]


class AutoEmailTests(unittest.TestCase):
    def setUp(self):
        isolate_app(self)
        with database.LOCK, database.connect() as db:
            profile.save_personal(db, {"name": "Ana Dev", "email": "ana@example.com", "phone": "98765 43210", "website": "ana.dev",
                                        "linkedin": "https://www.linkedin.com/in/ana", "github": "github.com/ana"})

    def test_signature_is_built_from_the_profile_or_overridden(self):
        self.assertEqual(auto_email.signature(), "Warm regards,\nAna Dev\n- ana@example.com\n- 98765 43210\n- ana.dev\n- https://www.linkedin.com/in/ana\n- github.com/ana")
        config.SETTINGS["email_signature"] = "Cheers,\nA"
        self.assertEqual(auto_email.signature(), "Cheers,\nA")

    def test_model_closings_are_replaced_by_the_signature(self):
        body = auto_email.with_signature("Hello.\nThanks for considering this.\n\nBest regards,\nSomeone")
        self.assertTrue(body.startswith("Hello.\nThanks for considering this."))
        self.assertEqual(body.count("regards"), 1)
        self.assertTrue(body.endswith("- github.com/ana"))

    def test_only_email_only_hiring_posts_are_eligible(self):
        entry = applications.get_entry(make_post())
        self.assertTrue(auto_email.eligible(entry))
        self.assertFalse(auto_email.eligible({**entry, "apply_url": "https://acme.com/apply"}))
        self.assertFalse(auto_email.eligible({**entry, "kind": "job"}))
        self.assertFalse(auto_email.eligible({**entry, "body": "I already wrote this"}))
        self.assertFalse(auto_email.eligible({**entry, "status": "approved"}))
        self.assertFalse(auto_email.eligible({**entry, "resume_id": ""}))
        self.assertFalse(auto_email.eligible({**entry, "contact_emails": [], "recipient": ""}))

    def test_start_fills_an_empty_draft_with_the_signature_and_keeps_the_resume(self):
        entry_id = make_post()
        fake = {"subject": "React developer interest", "body": "Hi team,\nI would love to help.\nBest regards,\nX", "notes": ""}
        with mock.patch("applydock.ai_draft.generate_ai_draft", return_value=fake):
            self.assertEqual(auto_email.start(entry_id, background=False), "started")
        entry = applications.get_entry(entry_id)
        self.assertEqual((entry["subject"], entry["recipient"], entry["resume_id"], entry["status"] != "approved"), ("React developer interest", "jobs@acme.com", "r1", True))
        self.assertIn("I would love to help.", entry["body"])
        self.assertTrue(entry["body"].endswith("- github.com/ana"))
        self.assertEqual(entry["body"].count("regards"), 1)

    def test_never_overwrites_what_you_wrote_and_survives_codex_failure(self):
        entry_id = make_post()
        with mock.patch("applydock.ai_draft.generate_ai_draft", side_effect=RuntimeError("Codex CLI is not installed.")):
            auto_email.start(entry_id, background=False)
        self.assertEqual(applications.get_entry(entry_id)["subject"], "")

        def write_while_codex_runs(entry, highlights=None):
            applications.update_entry(entry_id, {"body": "My own words"})
            return {"subject": "AI subject", "body": "AI body", "notes": ""}

        with mock.patch("applydock.ai_draft.generate_ai_draft", side_effect=write_while_codex_runs):
            auto_email.start(entry_id, background=False)
        entry = applications.get_entry(entry_id)
        self.assertEqual((entry["body"], entry["subject"]), ("My own words", ""))


if __name__ == "__main__":
    unittest.main()
