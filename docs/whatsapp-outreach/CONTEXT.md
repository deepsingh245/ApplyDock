# WhatsApp outreach: context (read this first)

**Goal:** WhatsApp outreach to HR contacts. ApplyDock prepares and schedules. At the due time the Chrome extension opens the chat in the user's own WhatsApp Web, attaches the pinned resume with the message as caption and, **only for messages the user opted into auto-send**, presses Send and verifies delivery. Otherwise the user presses Send and confirms. "Opened" never means "sent".

**Requirement change (decision 10):** the original brief forbade hidden auto-sending; the user later asked for it and chose the extension route ("one-click send").

**Stack:** existing Python helper + SQLite (`applydock/`), React app (`web/`). No new dependencies, no paid services.

## Where things are
- `applydock/outreach_schedule.py`: pure rules (slots, timezone, status machine, working days, template rendering). No DB.
- `applydock/outreach.py`: contacts, templates, schedules, batches, follow-ups, CSV import/export, duplicate guard, resume pinning, overview.
- `applydock/database.py`: schema gate. v7 outreach tables, v8 batches + pinned resume version + timezone, v9 template category/default + follow-ups, v10 `auto_send` + `sent_by`.
- `applydock/http_server.py`: `/api/outreach/*` routes.
- `web/src/features/outreach/`: `OutreachPage` (tabs), `ContactsPanel`, `TemplatesPanel`, `ScheduleWizard`, `QueuePanel`, `HistoryPanel`, `OutreachReminders` (mounted in `AppShell`), `message.ts`, `reminders.ts`, `types.ts`.
- Tests: `tests/test_outreach.py`, `tests/test_outreach_schedule.py`, `web/src/features/outreach/*.test.ts`.
- Other docs here: ARCHITECTURE, FEATURE_SPEC, DATABASE_SCHEMA, DECISIONS, TESTING, IMPLEMENTATION_STATUS, NEXT_STEPS. User-facing: `docs/features/whatsapp-outreach.md`.

## Done
Everything in the product brief except the items under "Not done". See IMPLEMENTATION_STATUS.md.

## Not done / limits
- Duplicate guard is per contact, not per role.
- Only Asia/Kolkata, UTC and fixed offsets (no tzdata, by decision).
- Reminders only fire while ApplyDock is open in a tab (browser limit; documented in the UI).
- Holidays are not known: working days are Monday to Friday.
- No Playwright spec for the Outreach screen yet; not exercised in a real browser by the author.
- The extension sender (`extension/whatsapp.js`, `extension/background.js`) was written without access to a live WhatsApp Web session. Its selectors are untested and WhatsApp changes its markup; first runs must be watched. Failures are reported to the queue and the message is left in the composer.
- Automated sending breaks WhatsApp's terms and can get the user's number restricted. Guard rails: opt-in per batch, 90 s pacing, 25/day cap, never sends missed (>30 min) messages.
- Follow-ups are created only when a message is confirmed sent (editable day list in the Queue tab, default 3 and 7 working days).
