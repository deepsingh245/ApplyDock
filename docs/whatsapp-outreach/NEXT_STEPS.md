# Next steps

**Current phase:** feature complete; remaining work is verification (Phase 6).

**Parked (user decision):** the extension sender is switched off (flags: `OUTREACH_SENDER_ENABLED` in `extension/background.js`, `EXTENSION_SENDING` in `web/src/features/outreach/types.ts`). Do not enable it without a supervised test. Steps if resumed: reload the extension (chrome://extensions, version 0.9.0, accept the new WhatsApp Web permission), queue ONE message to your own second number with auto-send on, and watch it. Fix selectors in `extension/whatsapp.js` (`SELECTORS`, `documentInput`, `captionBox`) if WhatsApp's markup differs.

1. Run the app (`start.cmd`), then walk the acceptance list: import 10+ contacts, pick a resume, preview and confirm a 9:00 to 10:00 batch, refresh, open WhatsApp, open the PDF, mark sent, see follow-ups, reschedule and cancel.
2. Add `web/e2e/outreach.spec.ts` (sandbox in `tests/ui/sandbox.py`) and check the screen on a phone width; add Outreach to `visual.spec.ts` if the rules need enforcing there.
3. Consider role-level duplicate matching and a settings screen for follow-up days and timezone.

**Commands:** `py -3 -m unittest discover -s tests -p "test_outreach*.py"`, `npm --prefix web run check`, `py -3 scripts/check.py [--ui]`. Restart the helper after backend changes; the database migrates to v9 on first start (a backup is taken automatically).
