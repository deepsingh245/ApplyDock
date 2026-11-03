import datetime as dt
import unittest
from unittest import mock

from support import isolate_app
from applydock import outreach, outreach_schedule as sched


def local(iso, tz="+05:30"):
    return dt.datetime.fromisoformat(iso).astimezone(sched.parse_timezone(tz)).strftime("%H:%M")


class SlotTests(unittest.TestCase):
    def test_even_distribution_matches_the_spec_example(self):
        plan = sched.compute_slots("2030-01-07", "09:00", "10:00", 10)
        self.assertEqual([local(s) for s in plan["slots"]],
                         ["09:00", "09:06", "09:12", "09:18", "09:24", "09:30", "09:36", "09:42", "09:48", "09:54"])
        self.assertEqual(plan["overflow"], 0)

    def test_timezone_conversion_to_utc(self):
        plan = sched.compute_slots("2030-01-07", "09:00", "10:00", 1, tz="Asia/Kolkata")
        self.assertEqual(plan["slots"][0], "2030-01-07T03:30:00+00:00")

    def test_fixed_interval_overflows_past_the_window(self):
        plan = sched.compute_slots("2030-01-07", "09:00", "09:30", 5, mode="fixed", interval_minutes=10)
        self.assertEqual([local(s) for s in plan["slots"]], ["09:00", "09:10", "09:20", "09:30"])
        self.assertEqual(plan["overflow"], 1)

    def test_max_per_window_caps_slots(self):
        plan = sched.compute_slots("2030-01-07", "09:00", "10:00", 10, max_per_window=4)
        self.assertEqual((len(plan["slots"]), plan["overflow"]), (4, 6))

    def test_manual_times_must_be_in_window(self):
        plan = sched.compute_slots("2030-01-07", "09:00", "10:00", 2, mode="manual", manual_times=["09:45", "09:05"])
        self.assertEqual([local(s) for s in plan["slots"]], ["09:05", "09:45"])
        with self.assertRaises(ValueError):
            sched.compute_slots("2030-01-07", "09:00", "10:00", 1, mode="manual", manual_times=["10:30"])

    def test_invalid_windows_and_weekends(self):
        with self.assertRaises(ValueError):
            sched.compute_slots("2030-01-07", "10:00", "09:00", 1)
        with self.assertRaises(ValueError):
            sched.compute_slots("2030-01-05", "09:00", "10:00", 1, skip_weekends=True)  # a Saturday
        with self.assertRaises(ValueError):
            sched.compute_slots("2030-01-07", "09:00", "10:00", 1, tz="Mars/Base")

    def test_date_boundary_stays_on_local_day_in_utc_conversion(self):
        plan = sched.compute_slots("2030-01-07", "00:00", "01:00", 1)
        self.assertEqual(plan["slots"][0], "2030-01-06T18:30:00+00:00")

    def test_status_machine(self):
        self.assertTrue(sched.can_transition("scheduled", "awaiting_confirmation"))
        self.assertTrue(sched.can_transition("failed", "scheduled"))
        self.assertFalse(sched.can_transition("sent", "scheduled"))
        self.assertFalse(sched.can_transition("cancelled", "scheduled"))

    def test_render_reports_missing_variables(self):
        text, missing = sched.render_template("Hi {{hr_name}} re {{job_title}}", {"hr_name": "Ana"})
        self.assertEqual((text, missing), ("Hi Ana re {{job_title}}", ["job_title"]))


class BatchTests(unittest.TestCase):
    def setUp(self):
        isolate_app(self)
        self.contacts = [outreach.create_contact({"full_name": f"HR {i}", "company": "Acme", "phone": f"+91 98765 4321{i}", "job_title": "React Dev"})
                         for i in range(3)]
        self.template = outreach.create_template({"name": "Intro", "body": "Hi {{hr_name}}, re {{job_title}} at {{company_name}}"})
        self.resume = {"id": "r1", "name": "Frontend", "available": True, "current_version_id": "v7"}
        patcher = mock.patch("applydock.outreach.resumes.get_resume", side_effect=lambda rid, **kw: self.resume if rid == "r1" else None)
        patcher.start()
        self.addCleanup(patcher.stop)

    def config(self, ids=None):
        return {"contact_ids": ids or [c["id"] for c in self.contacts], "template_id": self.template["id"], "resume_id": "r1",
                "date": "2030-01-07", "start": "09:00", "end": "10:00", "mode": "even"}

    def test_preview_and_commit_pin_the_resume_version(self):
        preview = outreach.preview_batch(self.config())
        self.assertEqual([local(r["send_at"]) for r in preview["rows"]], ["09:00", "09:20", "09:40"])
        self.assertEqual(preview["rows"][0]["message"], "Hi HR 0, re React Dev at Acme")
        batch = outreach.commit_batch({**self.config(), "rows": preview["rows"]})
        self.assertEqual(batch["recipient_count"], 3)
        self.assertTrue(all(s["resume_version_id"] == "v7" and s["status"] == "scheduled" for s in batch["schedules"]))

    def test_missing_resume_blocks_scheduling(self):
        self.resume = None
        preview = outreach.preview_batch(self.config())
        self.assertTrue(all("missing" in r["errors"][0] for r in preview["rows"]))
        with self.assertRaises(ValueError):
            outreach.commit_batch({**self.config(), "rows": [{"contact_id": self.contacts[0]["id"], "send_at": "2030-01-07T04:00:00+00:00", "message": "hi"}]})

    def test_do_not_contact_is_excluded(self):
        outreach.update_contact(self.contacts[1]["id"], {"status": "Do not contact"})
        preview = outreach.preview_batch(self.config())
        self.assertEqual(preview["rows"][1]["errors"], ["Marked Do not contact."])
        self.assertEqual([local(r["send_at"]) for r in preview["rows"] if r["send_at"]], ["09:00", "09:30"])

    def test_duplicates_need_explicit_confirmation(self):
        first = outreach.preview_batch(self.config([self.contacts[0]["id"]]))
        outreach.commit_batch({**self.config(), "rows": first["rows"]})
        again = outreach.preview_batch(self.config([self.contacts[0]["id"]]))
        self.assertTrue(again["rows"][0]["duplicate"])
        with self.assertRaises(ValueError):
            outreach.commit_batch({**self.config(), "rows": again["rows"]})
        outreach.commit_batch({**self.config(), "rows": again["rows"], "allow_duplicate_ids": [self.contacts[0]["id"]]})

    def test_unfilled_variables_block_commit(self):
        row = {"contact_id": self.contacts[0]["id"], "send_at": "2030-01-07T04:00:00+00:00", "message": "Hi {{relevant_skills}}"}
        with self.assertRaises(ValueError):
            outreach.commit_batch({**self.config(), "rows": [row]})

    def test_overflow_is_reported(self):
        preview = outreach.preview_batch({**self.config(), "max_per_window": 2})
        self.assertEqual(preview["overflow"], 1)
        self.assertIn("do not fit", preview["notice"])

    def test_reschedule_cancel_and_status_rules(self):
        batch = outreach.commit_batch({**self.config(), "rows": outreach.preview_batch(self.config())["rows"]})
        first, second, third = (s["id"] for s in batch["schedules"])
        moved = outreach.reschedule(first, "2030-01-08T05:00:00+00:00")
        self.assertEqual(moved["send_at"], "2030-01-08T05:00:00+00:00")
        opened = outreach.mark_opened(second)
        self.assertEqual((opened["status"], opened["result"]), ("awaiting_confirmation", "pending"))
        self.assertEqual(outreach.mark_schedule_result(second, "sent")["status"], "sent")
        with self.assertRaises(ValueError):
            outreach.cancel_schedule(second)
        self.assertEqual(outreach.cancel_schedule(third)["result"], "cancelled")
        with self.assertRaises(ValueError):
            outreach.reschedule(third, "2030-01-09T05:00:00+00:00")

    def test_pause_and_resume_batch(self):
        batch = outreach.commit_batch({**self.config(), "rows": outreach.preview_batch(self.config())["rows"]})
        paused = outreach.set_batch_paused(batch["id"], True)
        self.assertEqual({s["status"] for s in paused["schedules"]}, {"draft"})
        resumed = outreach.set_batch_paused(batch["id"], False)
        self.assertEqual({s["status"] for s in resumed["schedules"]}, {"scheduled"})
        cancelled = outreach.cancel_batch(batch["id"])
        self.assertEqual((cancelled["status"], {s["status"] for s in cancelled["schedules"]}), ("cancelled", {"cancelled"}))


if __name__ == "__main__":
    unittest.main()


class FollowupTests(unittest.TestCase):
    def setUp(self):
        isolate_app(self)
        self.contact = outreach.create_contact({"full_name": "Ana", "company": "Acme", "phone": "+91 98765 43210", "job_title": "React Dev"})
        self.template = outreach.create_template({"name": "Intro", "body": "Hi {{hr_name}}", "category": "Initial", "is_default": True})
        self.schedule = outreach.schedule_message({"contact_id": self.contact["id"], "template_id": self.template["id"],
                                                   "send_at": "2030-01-07T04:00:00+00:00"})

    def test_schedule_list_includes_contact_and_resume_details(self):
        listed = outreach.list_schedules()[0]
        self.assertEqual(listed["contact"]["phone"], "+919876543210")
        self.assertEqual(listed["template"]["name"], "Intro")

    def test_working_days_skip_weekends(self):
        friday = dt.date(2030, 1, 4)
        self.assertEqual(sched.add_working_days(friday, 3), dt.date(2030, 1, 9))
        self.assertEqual(sched.add_working_days(friday, 0), friday)

    def test_sent_creates_followups_and_updates_contact(self):
        outreach.mark_schedule_result(self.schedule["id"], "sent")
        followups = outreach.list_followups()
        self.assertEqual([f["step"] for f in followups], [1, 2])
        self.assertTrue(all(f["status"] == "pending" and "React Dev" in f["message"] for f in followups))
        contact = outreach.get_contact(self.contact["id"])
        self.assertEqual(contact["status"], "Application Sent")
        self.assertTrue(contact["last_contacted_at"])
        done = outreach.finish_followup(followups[0]["id"], "done")
        self.assertEqual(done["status"], "done")
        with self.assertRaises(ValueError):
            outreach.finish_followup(followups[0]["id"], "dismissed")

    def test_followups_can_be_disabled(self):
        outreach.mark_schedule_result(self.schedule["id"], "sent", followup_days=[])
        self.assertEqual(outreach.list_followups(), [])

    def test_skipped_creates_no_followups(self):
        outreach.mark_schedule_result(self.schedule["id"], "skipped")
        self.assertEqual(outreach.list_followups(), [])

    def test_template_default_is_unique_and_overview_counts(self):
        other = outreach.create_template({"name": "Second", "body": "Yo", "is_default": True})
        defaults = [t["name"] for t in outreach.list_templates() if t["is_default"]]
        self.assertEqual(defaults, ["Second"])
        self.assertEqual(outreach.update_template(other["id"], {"category": "Follow-up"})["category"], "Follow-up")
        self.assertEqual(outreach.overview()["missed"], 0)  # the 2030 schedule is in the future

    def test_missed_and_resume_usage_and_delete(self):
        outreach.reschedule(self.schedule["id"], "2020-01-01T00:00:00+00:00")
        self.assertEqual(outreach.overview()["missed"], 1)
        outreach.mark_schedule_result(self.schedule["id"], "sent")
        self.assertEqual(outreach.delete_contact(self.contact["id"]), 1)
        self.assertEqual((outreach.list_schedules(), outreach.list_followups()), ([], []))


class ExtensionSenderTests(unittest.TestCase):
    def setUp(self):
        isolate_app(self)
        self.template = outreach.create_template({"name": "Intro", "body": "Hi {{hr_name}}"})
        self.contacts = [outreach.create_contact({"full_name": f"HR {i}", "company": "Acme", "phone": f"+91 98765 4321{i}"}) for i in range(3)]
        resume = {"id": "r1", "name": "Frontend", "available": True, "current_version_id": "v7"}
        patcher = mock.patch("applydock.outreach.resumes.get_resume", side_effect=lambda rid, **kw: resume if rid == "r1" else None)
        patcher.start()
        self.addCleanup(patcher.stop)

    def queue(self, minutes_ago, auto_send=True, contact=0):
        when = (dt.datetime.now(dt.timezone.utc) - dt.timedelta(minutes=minutes_ago)).isoformat()
        batch = outreach.commit_batch({
            "template_id": self.template["id"], "resume_id": "r1", "auto_send": auto_send,
            "rows": [{"contact_id": self.contacts[contact]["id"], "send_at": when, "message": "Hello"}]})
        return batch["schedules"][0]

    def test_claim_hands_out_a_due_message_once_and_marks_it_opened(self):
        item = self.queue(1)
        self.assertTrue(item["auto_send"])
        claimed = outreach.extension_claim()["item"]
        self.assertEqual((claimed["id"], claimed["message"], claimed["auto_send"]), (item["id"], "Hello", True))
        self.assertEqual(outreach.get_schedule(item["id"])["status"], "awaiting_confirmation")
        self.assertIsNone(outreach.extension_claim()["item"])

    def test_future_missed_and_paused_messages_are_not_claimed(self):
        future = self.queue(-30, contact=0)
        self.queue(120, contact=1)  # missed: left for the user
        paused = self.queue(1, contact=2)
        outreach.set_batch_paused(paused["batch_id"], True)
        self.assertEqual(outreach.extension_claim()["item"], None)
        self.assertEqual(outreach.get_schedule(future["id"])["status"], "scheduled")

    def test_pacing_spaces_messages_apart(self):
        self.queue(2, contact=0)
        self.queue(1, contact=1)
        self.assertIsNotNone(outreach.extension_claim()["item"])
        self.assertEqual(outreach.extension_claim()["reason"], "pacing")

    def test_daily_cap_blocks_auto_send_but_not_assisted_messages(self):
        with mock.patch.object(outreach, "AUTO_SEND_DAILY_CAP", 0):
            self.queue(1, auto_send=True, contact=0)
            self.assertIsNone(outreach.extension_claim()["item"])
            assisted = self.queue(1, auto_send=False, contact=1)
            self.assertEqual(outreach.extension_claim()["item"]["id"], assisted["id"])

    def test_only_a_verified_delivery_marks_sent(self):
        item = self.queue(1)
        outreach.extension_claim()
        waiting = outreach.extension_report(item["id"], "unverified", "")
        self.assertEqual(waiting["status"], "awaiting_confirmation")
        sent = outreach.extension_report(item["id"], "sent")
        self.assertEqual((sent["status"], sent["sent_by"]), ("sent", "extension"))
        self.assertEqual(len(outreach.list_followups()), 2)

    def test_failed_report_and_unknown_outcome(self):
        item = self.queue(1)
        outreach.extension_claim()
        with self.assertRaises(ValueError):
            outreach.extension_report(item["id"], "bogus")
        failed = outreach.extension_report(item["id"], "failed", "Number is not on WhatsApp")
        self.assertEqual((failed["status"], failed["result"]), ("failed", "failed"))
        self.assertIn("not on WhatsApp", failed["notes"])
