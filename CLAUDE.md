# ApplyDock — guidance for AI coding agents

Personal, local-first job-application app: Python helper (`applydock/`) + plain-JS dashboard (`dashboard/`) + Chrome MV3 extension (`extension/`). Read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the module map and [docs/FEATURES.md](docs/FEATURES.md) to find a feature's doc before opening code.

## Commands

- Run the app: `start.cmd` or `py -3 server.py`. Use `APPLYDOCK_DATA_DIR` and `APPLYDOCK_PORT` to run against other data.
- All checks: `py -3 scripts/check.py`. Add `--ui` for the browser flows; it needs Chrome or Edge.
- One test module: `py -3 -m unittest discover -s tests -p "test_resume_workflow.py"`.
- Lint: `py -3 -m ruff check .`

## Rules

- **Never touch `data/`** (real user data and secrets). Tests must use `tests/support.isolate_app(self)`, which points everything at a temp folder.
- **Read config as attributes:** `config.DATA`, `config.DB`, `config.SETTINGS`, `config.PORT`, never `from .config import X`, so tests and sandboxes can redirect them.
- **No side effects at import time.** Startup work belongs in `app.prepare()` / `app.start_workers()` (`tests/test_architecture.py` checks this).
- **Respect the layering in ARCHITECTURE.md:**
  - `resumes` must not import `applications`.
  - Domain code reports changes with `events.application_changed(entry_id)` rather than calling Notion.
  - The architecture test fails on cycles.
- **New API endpoints:**
  - Add a `@route(...)` function in `applydock/http_server.py`.
  - Return a dict for a 200 response; raise `ValueError` for 400 or `NotFound` for 404.
  - Keep URLs and payloads backward compatible with the dashboard and the extension.
- **Dashboard:**
  - Classic `defer` scripts that share globals, in the order listed in `index.html`: `core.js` first, `main.js` after the feature files.
  - Escape every interpolated value with `esc()`.
  - Follow [DESIGN.md](DESIGN.md): use the tokens in `dashboard/tokens.css` (never raw colors or sizes), reuse the existing classes (`.button`, `.view-card`, `.badge`, `.kv`, `.menu`, …), nothing under 12px, and keep text at AA contrast. Don't add a UI library without approval.
  - The extension's `sidepanel.css` copies the tokens; change both together.
- **Schema changes:**
  - Additive only, with a new `PRAGMA user_version` step in `database.init_db` (the backup runs automatically).
  - Ask before any schema change.
- **AI:**
  - Codex CLI only (`ats._run_codex`). Never add an OpenAI API key (tested).
  - AI output must be validated or grounded. Never auto-send email or auto-apply suggestions.
- **Privacy:** never log resume text, tokens or the pairing key. Secrets go through `config.protect()` (DPAPI).
- **Comments** explain *why*, not *what*.

## Tests are expected

Add or update tests with every behavior change:

| Test file | Covers |
|---|---|
| `test_core.py` | Applications, Notion, email |
| `test_ats.py` | Analysis |
| `test_resume_*.py` | Resume editor modules |
| `test_career.py` | Master Profile, link checks, profile suggestions, submission history |
| `test_http_smoke.py` | The real server over HTTP |
| `tests/ui/flow-*.mjs` | Browser flows (`flow-extension.mjs` covers the side panel) |

Run `py -3 scripts/check.py` before finishing.

## Docs to keep current

When a feature's behavior changes, update its file in `docs/features/`, plus `docs/FEATURES.md` (status) and `docs/ARCHITECTURE.md` (if modules or flows change). Deferred work goes in `docs/TECH_DEBT.md`. Design rules live in `DESIGN.md`; redesign status and remaining UI issues go in `docs/DESIGN_HANDOFF.md`.

## Code graph

`graphify-out/` (git-ignored) holds a Graphify knowledge graph. For "where is X / what calls Y" questions, try `graphify query "<question>"` or skim `graphify-out/GRAPH_REPORT.md` first, then verify in the code. Refresh it with `graphify update .` after structural changes.
