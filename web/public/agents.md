# ApplyDock agent guide

ApplyDock is a local-first job application tracker. Pair through the app before using its local helper at `http://127.0.0.1:8765`. Send the pairing key in the `X-Local-Key` header; never put it in a prompt, URL, or tool result.

## Command map

The pairing-key protected `/api/agent/openapi.json` document describes the typed preparation API. Its command names are:

- `applications_list`, `application_get`
- `analysis_run`, `analysis_summary`
- `resume_tailor`, `resume_edit`, `resume_save_and_attach`
- `email_preview`
- `job_status`, `job_logs`, `job_cancel`

Use the returned application identity (company and role, with post context as a fallback) when discussing a record. Keep IDs from tool results for follow-up commands.

Agents may inspect applications, analyze a job, prepare resume changes, save and attach a resume version, preview email, and inspect or cancel background work. A person must approve an application and handle Gmail drafts, scheduling, and sending. Never send email automatically.

## Browser controls

Prefer controls by their accessible role and visible name. For automation that needs a stable selector, use `data-agent-id`:

| Selector | Control |
| --- | --- |
| `application.run-analysis` | Run analysis |
| `application.view-analysis` | View analysis |
| `application.approve` | Approve local send (human approval) |
| `application.record-submission` | Record submission |
| `application.save-gmail-draft` | Save or update Gmail draft |
| `application.prepare-gmail-schedule` | Prepare Gmail schedule |
| `application.confirm-gmail-schedule` | Confirm schedule in Gmail |
| `application.draft-email` | Draft email with Codex |
| `application.copy-email-prompt` | Copy email prompt |
| `application.save` | Save application changes |
| `resume.optimize` | Optimize resume for the job |
| `resume.tailor` | Tailor resume |
| `resume.save-version` | Save resume version |
| `resume.check-score` | Check resume score |
| `resume.request-suggestions` | Request resume suggestions |
| `job.cancel` | Cancel a running analysis |

Selectors are present only when the corresponding action is available. Use the visible name to distinguish state-dependent variants. Treat approval, email delivery, deletion, and other external or irreversible actions as user-confirmed actions.

## Local agent connection

The stdio MCP bridge is `py -3 -m applydock.mcp_server`. Configure it in a local MCP client with `APPLYDOCK_URL` (default `http://127.0.0.1:8765`) and `APPLYDOCK_KEY` in the server process environment. Keep the helper running. This bridge is for an agent running on the same computer; the pairing key stays local.
