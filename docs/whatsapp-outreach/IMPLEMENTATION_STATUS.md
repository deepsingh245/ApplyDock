# Implementation status

- [x] Phase 0: audit (`docs/features/whatsapp-outreach.md`)
- [x] Contacts: add, edit, delete (removes its outreach history), search, inline status, CSV/TSV import, export
- [x] Templates: create, edit, duplicate, delete, default, category, live preview, character count, missing-variable flags
- [x] Scheduling engine: even, fixed, specific times, cap, working days, timezone, overflow, with tests
- [x] Batch preview/commit, reschedule, cancel, pause/resume/cancel (UI + API), duplicate guard, resume version pinning
- [x] Status machine with tests
- [x] Queue: open WhatsApp (to awaiting confirmation), copy, open pinned PDF, I sent it, skip, failed, reschedule, cancel
- [x] Reminders: upcoming, due, missed (in-app notice + optional browser notification), follow-ups due
- [x] Follow-ups: created on confirmed send, reviewed and confirmed by the user, never automatic
- [x] History with filters (text, status, resume, date range) and per-item detail
- [x] Overview: all counts, missed, follow-ups, resume usage
- [x] Docs set
- [ ] Browser (Playwright) spec and mobile pass for the Outreach screen
- [ ] Role-level duplicate matching, other timezones
