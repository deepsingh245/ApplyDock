# Architecture

```
React (web/src/features/outreach)            Helper (applydock/)                       SQLite
 OutreachPage -- tabs --> Contacts/Templates   http_server.py  /api/outreach/*  -->  outreach.py  -->  outreach_* tables
 ScheduleWizard --preview/commit-->                                                   |
 QueuePanel --PATCH actions-->                                                         +--> outreach_schedule.py (pure rules)
 HistoryPanel                                                                          +--> resumes.py (library, versions)
 OutreachReminders (AppShell, polls 60s)
```

- **Layering:** `outreach_schedule.py` imports nothing from the app. `outreach.py` uses `database` and `resumes` (never `applications`). The architecture test checks there are no cycles.
- **Scheduling:** `compute_slots` returns UTC ISO times from a local date and window. `preview_batch` writes nothing; `commit_batch` validates again and inserts the batch and schedules in one transaction.
- **Status flow:** scheduled -> awaiting_confirmation (WhatsApp opened) -> sent / skipped / failed; any open state can be cancelled; failed and skipped can be rescheduled; sent and cancelled are final. Transitions are enforced in `_set_status`.
- **WhatsApp:** the client builds a `https://wa.me/<digits>?text=<message>` link. It only prefills text. The pinned resume opens through the existing versioned file link; the user attaches it by hand.
- **Resume integration:** no files are copied. A schedule stores `resume_id` and `resume_version_id`; creation fails if the resume file is missing.
- **Notifications:** `OutreachReminders` classifies waiting schedules with `reminders.ts` (upcoming 5 min, due, missed after 30 min) and raises a toast, plus a `Notification` when allowed. Triggering a reminder is not sending a message.
- **Follow-ups:** `_after_sent` records contact history and inserts `outreach_followups` rows due N working days later at 09:00 local time.
