# Email delivery (AI draft, Gmail drafts, local 9 AM sender)

**What it does:** helps write the application email and delivers it with the exact resume file. It never sends without an explicit approval.

## Files

| File | Role |
|---|---|
| `applydock/ai_draft.py` | `generate_ai_draft`: Codex writes subject, body and notes from the job and your profile (not the resume) |
| `applydock/gmail.py` | OAuth (PKCE, `gmail.compose` scope, loopback redirect), `gmail_message` (MIME with the pinned resume), `save_gmail_draft`, `mark_gmail_scheduled` |
| `applydock/delivery.py` | SMTP settings check (`test_smtp_login`), `send_mail`, `process_due` (the 9 AM sender), `scheduler` |
| `dashboard/js/applications.js` | Email tab and inspector actions (`performAction`) |

## Rules

- **Gmail drafts:** created or updated only by your click. Saving a draft pins the attached version and records `attachment_sha256`, filename and time. Local edits set `gmail_dirty` until the draft is updated.
- **Gmail scheduling:** the API cannot schedule, so **Prepare Gmail schedule** opens Gmail and **I scheduled it in Gmail** records your confirmation.
- **Local sender:** it sends only `approved` entries in `local` delivery mode, at exactly 9:00 local time, after re-checking Notion. An entry stuck in `sending` after a crash is never retried automatically, because it may already have been delivered.
- **Attachment integrity:** every attachment's bytes are re-hashed against the stored version before sending (`resumes.attachment_bytes`). Gmail drafts reject attachments above 18 MB.
- **Secrets:** the SMTP password and Gmail tokens are DPAPI-encrypted and never returned to the browser.

## Limitations

- The local sender needs the PC on and the helper running at 9:00.
- An SMTP "sent" status means the provider accepted the message, not that it was delivered.
