# WhatsApp outreach scheduler

**What it does:** manages recruiter/HR contacts, message templates and assisted WhatsApp outreach scheduling without auto-sending or hidden WhatsApp automation.

## Technical assessment

- Existing architecture: ApplyDock is a local-first Python helper with SQLite data storage plus a React dashboard. The backend exposes JSON routes and stores data under `data/` with a paired browser/extension client.
- Reusable modules: `applications.capture` stores job entries and resume linkage, while `resumes.py` owns the resume library and versioned files. `database.init_db()` is the authoritative schema gate.
- Proposed integration points: add a lightweight outreach domain model adjacent to the applications domain, plus a few HTTP routes for contacts/templates/schedules. The app keeps using explicit user confirmation before sending any message.
- Required schema changes: `outreach_contacts`, `outreach_templates` and `outreach_schedules` use additive SQLite tables, with a new `PRAGMA user_version` bump.
- New dependencies: none; the feature stays within the current Python + SQLite stack.
- Scheduling limitations: this implementation is assisted, not automatic; it schedules outreach, opens the relevant WhatsApp conversation, and records the result only after the user confirms it.
- Security considerations: every contact and message remains local to the user. No unofficial scraping or hidden session automation is used.

## Phased implementation

1. Domain model and storage (`applydock/outreach.py` + schema migration).
2. Validation and approval flow (`applications.py` accepts a `whatsapp` method and validates numbers appropriately).
3. HTTP endpoints and dashboard-facing data (`applydock/http_server.py`).
4. Import/export and queue tracking for contact and schedule records.
5. Follow-up UI integration when the web app expands to direct outreach management screens.

## Quick start for the user

1. Open WhatsApp Web in your browser or the desktop WhatsApp app on your computer.
2. Open the Outreach screen in ApplyDock and import a contact sheet or add a recruiter manually.
3. Pick the contact, choose a template, and optionally attach the resume you want to reference.
4. Review the message draft, confirm the send time, and keep the call-to-action as a human-controlled action instead of automatic sending.
5. After you send it, mark the scheduled message as sent from the queue so the app records the result.

Phone numbers: a bare 10-digit number starting 6-9 is read as Indian (+91); `00`/`+` prefixes are honoured; the first number is used when a cell holds several (`a / b`). Sheet quirks never reject a row on their own: a blank name becomes "Recruiter", an invalid email is dropped, and an unknown status becomes Not Sent with the original text kept in notes. Scientific-notation phones (a spreadsheet export bug) are reported as invalid. Delimiter is detected from the first line (tab, then comma/semicolon).

The Outreach screen has Overview, Contacts, Templates, Schedule and Queue tabs. The Queue offers Open WhatsApp (a wa.me link that only prefills the text), Copy message, I sent it, Skip and Mark failed; only I sent it records Sent. Template variables are `{{hr_name}}`, `{{company_name}}`, `{{job_title}}`; unfilled ones are flagged before queueing.

Contact imports accept comma-, semicolon-, or tab-separated rows, with or without a header. Headerless rows use this order: Company, Recruiter / Contact, Phone, Email, Status, Notes. Email can be blank. Status values include `Not Sent`, `Mailed/Messaged`, `Application Sent`, `Reached / In Discussion`, `Scheduled`, `On Hold`, `Rejected`, and `No Response`. Choosing a CSV/TSV file loads it into the import box; select **Import contacts** to save it.

Import diagnostics are printed in the ApplyDock helper's console with the `[ApplyDock outreach import]` prefix. They include the detected delimiter, header/row counts, and each row's imported, duplicate, or validation-failure result. Contact names, phone numbers, emails, and row contents are intentionally excluded from these logs.

## Rules

- WhatsApp numbers are normalized and stored in a consistent format.
- Contacts marked `Do not contact` are rejected by the scheduler.
- The app never claims a WhatsApp message was sent merely because the conversation was opened.
- A resume is optional in the domain model but should be selected and validated before the schedule is considered ready.
