# Decisions

1. **Fixed +05:30 for Asia/Kolkata, no tzdata.** Windows lacks an IANA database; adding `tzdata` is a new dependency. Trade-off: only Asia/Kolkata, UTC and `+HH:MM` offsets.
2. **Additive schema v8 and v9.** Status is TEXT, so new statuses need no migration. Legacy `pending` rows become `scheduled`.
3. **Pause = park as draft.** Pausing a batch moves still-scheduled messages to `draft`; resume restores them.
4. **`result` is separate from `status`.** `result` (pending/sent/skipped/failed/cancelled) splits Queue from History; `status` is the workflow state.
5. **Resume required for batches.** No automatic choice; the current version id is pinned at commit and the queue links to that exact version.
6. **Preview is server-side.** One implementation of slots, rendering and duplicate checks; commit re-validates everything.
7. **Reminders are client-side.** A free local helper has no push channel and a web page cannot wake a closed browser, so reminders poll while the app is open (toast plus optional Notification). The server only counts missed items (30 minute grace, `MISSED_AFTER_MINUTES`).
8. **Follow-ups are their own table.** Tracked separately from the original message, created only on confirmed send, never sent automatically.
9. **Deleting a contact deletes its schedules and follow-ups** (the app's delete rule for personal data).
10. **Extension sender, opt-in per batch (user's choice over the original brief).** Official Cloud API was rejected (business number, paid, templates only, no resume before the HR replies). The extension drives the user's own WhatsApp Web session: no session files or cookies are read by ApplyDock. Guard rails live in the helper (`AUTO_SEND_GAP_SECONDS`=90, `AUTO_SEND_DAILY_CAP`=25, missed messages never claimed) so the extension cannot bypass them. Risk accepted by the user: terms-of-service breach and possible number restriction.
11. **Sent only on verified delivery.** The content script waits for a new tick icon after pressing Send; if it cannot see one it reports `unverified` and the message stays awaiting confirmation. Resume and message go as one document with a caption.
