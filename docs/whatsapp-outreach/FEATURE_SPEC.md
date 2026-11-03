# Feature spec

**Flow:** import or add contacts -> write a template -> Schedule: select contacts, template, resume, date, window, spacing -> Preview -> edit or remove rows -> Confirm -> Queue -> at the time, a reminder -> Open WhatsApp -> attach the PDF and press Send in WhatsApp -> I sent it -> follow-ups appear -> History.

**Rules**
- Sending: by default the user presses Send in WhatsApp and confirms with "I sent it". If the batch was created with "Send for me with the ApplyDock extension", the extension presses Send and records Sent only after WhatsApp shows a delivery tick. Follow-ups are never sent automatically.
- Extension guard rails: at least 90 seconds between messages, at most 25 extension-sent per 24 hours, messages more than 30 minutes late are never claimed, paused or cancelled messages are never claimed.
- Do-not-contact contacts cannot be scheduled.
- A resume must be chosen for a batch and its file must exist; its current version is pinned.
- Messages with unfilled `{{variables}}` cannot be confirmed. Only `hr_name`, `full_name`, `company_name`, `company`, `job_title` are filled automatically; nothing about skills or experience is invented.
- A contact already queued or sent needs an explicit "send again" confirmation.
- Times must fall inside the window; contacts that do not fit are reported as overflow.
- Working-days-only rejects weekend dates. Default timezone is India time.
- Import never overwrites; duplicates by phone or email are skipped; invalid rows are listed with row numbers.
- Follow-ups default to 3 and 7 working days and are reminders only.

**Edge cases handled:** UTC midnight boundary, unparsable times, missing resume file, contact deleted after preview, duplicate contact in one batch, paused batches, rescheduling a failed or skipped message, missed schedules after a closed browser.

**Acceptance (brief section 18):** covered by the flow above; items 10 (reminders) are limited to while the app is open.
