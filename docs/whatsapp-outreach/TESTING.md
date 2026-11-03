# Testing

Run: `py -3 -m unittest discover -s tests -p "test_outreach*.py"` (30 tests); `npm --prefix web run check` (32 tests); `py -3 scripts/check.py`.

Covered: slot distribution (even, fixed, manual, cap), IST to UTC, midnight boundary, weekend and bad-window errors, working-day maths, status machine, template rendering, preview/commit with version pin, missing resume, Do-not-contact, duplicate confirmation, unfilled variables, overflow, reschedule/cancel/opened/sent rules, batch pause/resume/cancel, follow-up creation and completion, contact history update, default template uniqueness, missed count, contact deletion cascade, CSV quirks (phones, delimiters, blank names, odd statuses), reminder timing, wa.me link and template rendering on the client.

Not covered: Playwright flows, mobile layout, real notification permission behaviour. These need a manual pass.

Extension sender (`ExtensionSenderTests`): claim once, not future/missed/paused, pacing, daily cap (auto only), verified-only Sent, failed and unknown reports. The browser side (`extension/whatsapp.js`) has only a syntax check; it needs a manual run against a real WhatsApp Web session.
