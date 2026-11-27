# ApplyDock agent guide

ApplyDock is a local-first job application tracker. Pair through the app and use the local API at `http://127.0.0.1:8765` with `X-Local-Key`. See `/llms.txt` for the command list and `/api/agent/openapi.json` for the preparation-only GPT Actions schema.

The API is available only to software that can reach the local helper. The pairing key is local and must never be printed or included in results.

Agents can list and inspect applications, run analysis, tailor and edit resumes, save and attach a version, and prepare an email preview. Never approve, create or schedule Gmail drafts, or send. Approval and external delivery remain human actions.

Identify applications by the returned identity label, not a generic post title. UI controls may include `data-agent-id` stable selectors.
