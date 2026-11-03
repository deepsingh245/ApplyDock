# ApplyDock Outreach Feature — Claude Handoff

## Current status

The WhatsApp-assisted recruiter outreach feature has a working backend foundation and a basic Outreach screen. Contact management, message templates, schedule records, spreadsheet import/export, and resume selection are present. Sending is intentionally manual: ApplyDock does not send WhatsApp messages automatically.

The most recent import failure was caused by the user’s status labels not being accepted by contact validation. The supplied screenshot showed statuses that were missing from the backend allowlist. Those statuses are now accepted and included in the UI.

## What has been implemented

### Backend

- Added `applydock/outreach.py` for local SQLite-backed contacts, templates, scheduled messages, status validation, and CSV export.
- Added outreach schema creation and migration in `applydock/database.py`.
- Added HTTP API routes in `applydock/http_server.py` for contacts, CSV import/export, templates, schedules, and schedule results.
- Added support for WhatsApp as an application method in `applydock/applications.py`.
- Import accepts comma-, semicolon-, and tab-separated data, with or without a header. Headerless rows use this order:
  `Company, Recruiter / Contact, Phone, Email, Status, Notes`.
- Blank email fields are allowed and no longer cause false duplicate matches.
- Import handles UTF-8 and UTF-16 BOM files. Duplicate contacts are skipped; invalid rows include a row number and validation reason in the API result.
- Import writes console diagnostics prefixed with `[ApplyDock outreach import]`. Logs intentionally omit contact names, phone numbers, emails, and row contents.
- Contact statuses include the screenshot values: `Not Sent`, `Mailed/Messaged`, `Application Sent`, `Reached / In Discussion`, `Scheduled`, `On Hold`, `Rejected`, and `No Response`. Existing statuses such as `New`, `Interested`, and `Do not contact` remain supported.
- `Do not contact` contacts cannot be scheduled.

### Web UI and docs

- Added the Outreach page and navigation/route wiring.
- The screen supports adding contacts, importing pasted or uploaded CSV/TSV data, exporting contacts, templates, scheduling, and selecting a resume from the local resume library.
- Import results display counts and row-specific validation errors.
- Added manual WhatsApp workflow guidance and feature documentation.

## Important implementation details

- The helper serves the built React app from `web/dist`; restart/rebuild with `start.cmd` after code changes. A previously running helper can continue serving old backend code until it is restarted.
- A selected resume is associated with the schedule record, but ApplyDock does not automatically attach it in WhatsApp. The user must attach it manually in WhatsApp Web/Desktop.
- Scheduling currently stores an assisted outreach record; it is not an automatic WhatsApp scheduler or sender.
- Keep all data local. Never inspect, modify, or log `data/` contents, pairing keys, tokens, or resume text.
- Do not roll back unrelated worktree changes. Check `git status` and review diffs before editing.

## What remains

1. **Verify with the user’s real sheet after restarting the helper.** Confirm the CSV/TSV encoding, header names, detected delimiter, import counts, and any row errors. Ask for the exact displayed validation error or sanitized console lines if it still fails; do not ask them to share personal contact details.
2. **Finish the queue workflow.** The API can record a sent/skipped/failed result, but the current page needs user-facing queue actions and a clear way to open the corresponding WhatsApp conversation and mark the outcome after the user acts.
3. **Clarify attachment expectations.** Current support selects a resume already in the local library for a schedule. Generic file upload, multiple attachments, and actually opening/attaching the file in WhatsApp are not implemented.
4. **Consider editable contact status.** Status is selectable when adding a contact and importable from a sheet, but a full contact editing/status management experience may still be needed.
5. **Update docs/status tracking** if further behavior changes: `docs/features/whatsapp-outreach.md`, `docs/FEATURES.md`, and `docs/ARCHITECTURE.md` as appropriate.

## Validation already run

- `py -3 -m unittest discover -s tests -p "test_outreach.py"` — passed, including tests for headerless TSV, blank emails, all eight screenshot statuses, and privacy-safe import diagnostics.
- `py -3 -m ruff check applydock\outreach.py applydock\http_server.py tests\test_outreach.py` — passed.
- `npm --prefix web run check` — passed.
- `py -3 scripts/check.py` — passed after the import diagnostics and status changes.

Run the focused checks again after editing, and run `py -3 scripts/check.py` before finishing.

## Update (UI + import hardening)

- Import: phone normalisation (+91 default, multi-number cells, sci-notation detection), first-line delimiter detection, blank-name/bad-email/unknown-status tolerance. Tests added in `tests/test_outreach.py`.
- UI rebuilt on Ledger primitives (tabs, Card, Pill, Note, Field) with queue actions; `web/src/features/outreach/message.ts` renders templates and builds wa.me links (Vitest covered).
- `mark_schedule_result` now stores status = result (sent/skipped/failed).
- Still missing vs. the master prompt: batch time-window distribution, resume version pinning, duplicate-send warning, reminders/browser notifications, follow-ups, contact edit form, the `docs/whatsapp-outreach/` doc set.
