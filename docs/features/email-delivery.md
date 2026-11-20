# Email delivery (AI draft, Gmail drafts, local 9 AM sender)

**What it does:** helps write the application email and delivers it with the exact resume file. It never sends without an explicit approval.

## Files

| File | Role |
|---|---|
| `applydock/ai_draft.py` | `generate_ai_draft`: Codex writes subject, body and notes from the job, your profile and (when given) the tailored resume's headline and skills. It runs through the same Codex runner as the analysis (`ats._run_codex`: read-only sandbox, UTF-8, reply read from the `--output-last-message` file). Its old private command broke on non-ASCII replies on Windows and on newer Codex console output |
| `applydock/auto_email.py` | Signature, and the automatic draft for hiring posts that can only be answered by email |
| `applydock/gmail.py` | OAuth (PKCE, `gmail.compose` scope, loopback redirect), `gmail_message` (MIME with the pinned resume), `save_gmail_draft`, `mark_gmail_scheduled` |
| `applydock/delivery.py` | SMTP settings check (`test_smtp_login`), `send_mail`, `process_due` (the 9 AM sender), `scheduler` |
| `web/src/features/applications/` | Email tab (`EntryEditor`) and inspector actions (`useEntryActions`) |

## Automatic email for hiring posts

When a hiring post has an email address and no apply link, saving the tailored resume for it (resume editor, **Save version**) starts a background draft: Codex writes the subject and body (grounded in your profile and that resume's headline and skills), your signature is appended, and the result lands in the Email tab with the tailored resume already attached. It only runs when the subject and body are empty, never overwrites what you wrote (it re-checks before saving), never approves and never sends. If Codex is unavailable nothing happens and **Draft email with Codex** still works.

The signature comes from **Settings → Email signature**; when that is empty it is built from the Master Profile (name, then email, phone, website, LinkedIn, GitHub, each on a `- ` line, under "Warm regards,"). It is appended to manual AI drafts too, and the model is told not to write its own sign-off.

## Rules

- **Gmail drafts:** created or updated only by your click. Saving a draft pins the attached version and records `attachment_sha256`, filename and time. Local edits set `gmail_dirty` until the draft is updated.
- **Gmail scheduling:** the API cannot schedule, so **Prepare Gmail schedule** opens Gmail and **I scheduled it in Gmail** records your confirmation.
- **Local sender:** it sends only `approved` entries in `local` delivery mode, at exactly 9:00 local time, after re-checking Notion. An entry stuck in `sending` after a crash is never retried automatically, because it may already have been delivered.
- **Attachment integrity:** every attachment's bytes are re-hashed against the stored version before sending (`resumes.attachment_bytes`). Gmail drafts reject attachments above 18 MB.
- **Secrets:** the SMTP password and Gmail tokens are DPAPI-encrypted and never returned to the browser.

## Limitations

- The local sender needs the PC on and the helper running at 9:00.
- An SMTP "sent" status means the provider accepted the message, not that it was delivered.
