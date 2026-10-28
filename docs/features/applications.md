# Applications workspace

**What it does:** the main dashboard view. It has a filterable queue of captured applications, an editor split into tabs (Overview, Job details, Resume, Email, ATS Analysis), and an inspector with delivery and AI actions.

## Files

| File | Role |
|---|---|
| `applydock/applications.py` | `entries()`, `public_entry()` (adds resume, version, readiness and analysis summary), `update_entry()` (editing and approval rules), stages |
| `applydock/http_server.py` | `/api/state`, `/api/capture`, `PATCH`/`DELETE /api/entries/{id}`, `/api/entries/{id}/pin-resume` |
| `web/src/features/applications/` | `ApplicationsPage` (workspace, URL state, unsaved-changes guard), `QueueList` + `filtering.ts`, `EntryEditor` (tabs), `Inspector` (`nextActions`), `SubmissionCard`, `useEntryActions`, `CreateApplicationPage`, `actions.ts` (run analysis, open the resume editor) |
| `web/src/api/state.ts`, `web/src/app/` | `/api/state` query, pairing gate, top bar, extension deep links |

## Business rules (in `update_entry`)

- **Locked states:** sending or sent entries can't be edited. Entries scheduled in Gmail allow only stage changes.
- **Approval reset:** any approval-relevant change to an approved entry sets it back to `draft`.
- **Stale Gmail drafts:** a change to recipient, subject, body, resume or route sets `gmail_dirty`, so the Gmail draft must be updated.
- **Approval requirements:** the email route, recipient, subject, body, a future 9:00 local send time, an available resume and verified SMTP. Approving pins the exact resume version.
- **Resume changes:** changing `resume_id` clears the pinned version. Another application's tailored resume is rejected.
- **Stages:** moving to Applied, No Answer, Offer or Rejected clears **Needs review**.
- **Deleting:** removes only the local record. The Notion page and any Gmail draft are untouched.

## Edge cases

- **Hidden required field:** if a required field on a hidden tab blocks saving, the editor switches to that tab.
- **Sent applications:** they leave the queue; Notion keeps the record.
- **Gmail scheduling:** Gmail-scheduled sends stay visible because Gmail doesn't report when they actually go out.
