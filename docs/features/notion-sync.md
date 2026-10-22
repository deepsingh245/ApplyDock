# Notion sync

**What it does:** mirrors each application to a page in your Notion data source, imports supported edits back, and removes local records whose page you moved to Notion's trash. ApplyDock never deletes or archives anything in Notion.

## Files

| File | Role |
|---|---|
| `applydock/notion.py` | `notion_request` (throttled, retried), `ensure_notion_schema` (maps or creates columns from `NOTION_FIELDS`), `notion_properties`, `sync_entry`, `import_notion_page`, `reconcile_notion_deletions` |
| `applydock/events.py` | `sync_entry` is subscribed to `application_changed` at startup |
| `applydock/delivery.py` | `scheduler` runs `reconcile_notion_deletions` (throttled to every 2 minutes) |

## Rules

- **Outbound:** application fields, resume name/category/link (the version link when pinned), and the ATS summary columns.
- **Inbound:** stage, position, company, captured text, notes, recipient, subject, body, method, apply link, contact emails, send date and Needs Review. Approval, delivery state, Gmail state and resume assignment are local-only.
- **Approval reset:** a Notion content change to an approved application removes its local approval.
- **Trash:** only an explicit `in_trash`/`archived` flag removes a local record. A 404, lost permission or network error keeps it and reports the error.
- **Before sending:** the 9 AM sender re-checks the page and postpones the send if the check fails.

## Setup

See [USER_GUIDE → Connect Notion](../USER_GUIDE.md#connect-notion). The token is stored DPAPI-encrypted.
