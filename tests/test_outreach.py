from contextlib import redirect_stdout
import io
import unittest

from support import isolate_app
from applydock import applications, outreach


class OutreachTests(unittest.TestCase):
    def setUp(self):
        isolate_app(self)

    def test_whatsapp_capture_and_contact_schedule(self):
        entry, duplicate = applications.capture({
            "url": "https://example.com/jobs/whatsapp-123",
            "title": "Senior Frontend Engineer",
            "company": "Example Labs",
            "apply_method": "whatsapp",
            "recipient": "+1 (415) 555-0101",
            "body": "Hi there, I'm interested in the frontend role.",
        })
        self.assertFalse(duplicate)
        self.assertEqual(entry["apply_method"], "whatsapp")
        contact = outreach.create_contact({
            "full_name": "Ada Lovelace",
            "phone": "+1 (415) 555-0101",
            "company": "Example Labs",
            "status": "New",
        })
        template = outreach.create_template({
            "name": "Intro message",
            "body": "Hi {{full_name}}, I am interested in the role at {{company}}.",
        })
        schedule = outreach.schedule_message({
            "contact_id": contact["id"],
            "template_id": template["id"],
            "send_at": "2099-01-01T09:00:00+00:00",
            "message": "Hi Ada, I am interested in the role at Example Labs.",
        })
        self.assertEqual(schedule["contact"]["id"], contact["id"])
        self.assertEqual(schedule["status"], "scheduled")
        self.assertEqual(outreach.mark_schedule_result(schedule["id"], "sent")["result"], "sent")

    def test_csv_import_and_export(self):
        summary = outreach.import_contacts_csv(
            "name,phone,company,status\nAva, +1 415 555 0102, Northwind, New\n"
            "Noah, +1 415 555 0102, Northwind, New\n"
        )
        self.assertEqual(summary["imported"], 1)
        self.assertEqual(summary["skipped"], 1)
        csv_data = outreach.export_contacts_csv()
        self.assertIn("Ava", csv_data)

    def test_csv_import_accepts_user_sheet_layout(self):
        summary = outreach.import_contacts_csv(
            "Company,Recruiter / Contact,Phone,Email,Status,Notes\n"
            "Tredence,Anandhi,+91 75502 24684,,Not Sent,\n"
            "Tredence,Anandhi,+91 75502 24684,,Not Sent,\n"
        )
        self.assertEqual(summary["imported"], 1)
        self.assertEqual(summary["skipped"], 1)
        contact = outreach.list_contacts()[0]
        self.assertEqual(contact["company"], "Tredence")
        self.assertEqual(contact["status"], "Not Sent")
        self.assertEqual(contact["full_name"], "Anandhi")

    def test_import_accepts_headerless_tab_separated_sheet_rows(self):
        summary = outreach.import_contacts_csv(
            "Tredence\tAnandhi\t+91 75502 24684\t\tNot Sent\n"
            "Neudesic\tNishan\t+91 94968 44053\t\tNot Sent\n"
            "MSE Technologies\tPoonam\t+91 95452 38137\t\tNot Sent"
        )
        self.assertEqual(summary["imported"], 3)
        self.assertEqual(summary["invalid"], [])
        contacts = {contact["company"]: contact for contact in outreach.list_contacts()}
        self.assertEqual(contacts["Tredence"]["full_name"], "Anandhi")
        self.assertEqual(contacts["Tredence"]["phone"], "+917550224684")
        self.assertEqual(contacts["Tredence"]["status"], "Not Sent")
        self.assertEqual(contacts["Neudesic"]["full_name"], "Nishan")
        self.assertEqual(contacts["MSE Technologies"]["full_name"], "Poonam")
        updated = outreach.update_contact(contacts["Neudesic"]["id"], {"notes": "Follow up next week"})
        self.assertEqual(updated["notes"], "Follow up next week")

    def test_import_accepts_statuses_from_user_sheet(self):
        statuses = [
            "Not Sent",
            "Mailed/Messaged",
            "Application Sent",
            "Reached / In Discussion",
            "Scheduled",
            "On Hold",
            "Rejected",
            "No Response",
        ]
        rows = ["Company\tRecruiter / Contact\tPhone\tEmail\tStatus\tNotes"]
        expected = {}
        for index, status in enumerate(statuses):
            company = f"Company {index}"
            rows.append(f"{company}\tRecruiter {index}\t+1 415 555 {index:04d}\t\t{status}\t")
            expected[company] = status

        result = outreach.import_contacts_csv("\n".join(rows))

        self.assertEqual(result["imported"], len(statuses))
        self.assertEqual(result["invalid"], [])
        contacts = {contact["company"]: contact for contact in outreach.list_contacts()}
        self.assertEqual({company: contacts[company]["status"] for company in expected}, expected)

    def test_import_tolerates_real_world_sheet_quirks(self):
        result = outreach.import_contacts_csv(
            "Company\tRecruiter / Contact\tPhone\tEmail\tStatus\tNotes\n"
            "Acme\tRiya\t98765 43210 / 91234 56789\tn/a\tMsg sent\tcall later, maybe\n"
            "Globex\t\t09876543211\t\t\t\n"
            "Initech\tBob\t9.18E+11\t\tNot Sent\t\n"
        )
        self.assertEqual(result["imported"], 2)
        self.assertEqual(len(result["invalid"]), 1)
        self.assertEqual(result["invalid"][0]["row_number"], 4)
        contacts = {c["company"]: c for c in outreach.list_contacts()}
        self.assertEqual(contacts["Acme"]["phone"], "+919876543210")
        self.assertEqual(contacts["Acme"]["status"], "Not Sent")
        self.assertIn("Msg sent", contacts["Acme"]["notes"])
        self.assertEqual(contacts["Globex"]["phone"], "+919876543211")
        self.assertEqual(contacts["Globex"]["full_name"], "Recruiter")

    def test_import_logs_row_outcomes_without_contact_details(self):
        output = io.StringIO()
        with redirect_stdout(output):
            summary = outreach.import_contacts_csv(
                "Company,Recruiter / Contact,Phone,Email,Status,Notes\n"
                "Example Corp,Private Name,invalid,,Not Sent,\n"
            )
        log = output.getvalue()
        self.assertEqual(summary["imported"], 0)
        self.assertEqual(summary["invalid"][0]["row_number"], 2)
        self.assertIn("row=2 invalid", log)
        self.assertIn("finished imported=0 skipped=0 invalid=1", log)
        self.assertNotIn("Private Name", log)
        self.assertNotIn("invalid,,", log)


if __name__ == "__main__":
    unittest.main()
