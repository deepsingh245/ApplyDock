# ApplyDock — guidance for AI coding agents

Personal, local-first job-application app: Python helper (`applydock/`) + React web app (`web/`, served by the helper from `web/dist`) + Chrome MV3 extension (`extension/`). Read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the module map and [docs/FEATURES.md](docs/FEATURES.md) to find a feature's doc before opening code.

## Commands

- Run the app: `start.cmd` (builds `web/` and then starts the helper) or `py -3 server.py`. Use `APPLYDOCK_DATA_DIR` and `APPLYDOCK_PORT` to run against other data.
- Web app (in `web/`, Node 22+):
  - `npm ci` once;
  - `npm run dev` gives Vite on :5173, proxying `/api` to the helper;
  - `npm run check` runs types, ESLint and Vitest;
  - `npm run build`;
  - `npm run e2e` runs Playwright against `tests/ui/sandbox.py`.
- All checks: `py -3 scripts/check.py`. Add `--ui` for the browser flows; it needs Chrome or Edge.
- One test module: `py -3 -m unittest discover -s tests -p "test_resume_workflow.py"`. One browser spec: `npm --prefix web run e2e -- e2e/applications.spec.ts` (after a build).
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
  - Keep URLs and payloads backward compatible with the web app and the extension.
- **Web app** (`web/`; conventions in [web/README.md](web/README.md)):
  - React 19 + TypeScript (strict), Vite, Tailwind v4, shadcn-style primitives on Radix in `src/components/ui/`, TanStack Query, React Router 7, React Hook Form + Zod, Zustand (resume editor), dnd-kit.
  - Each screen lives in `src/features/<feature>/`. Server state goes through TanStack Query (`src/api/`). `src/lib/api.ts` is the only code that knows the pairing key.
  - Follow [DESIGN.md](DESIGN.md):
    - token utilities only (`bg-surface`, `text-ink-2`, `text-xs` …); the default Tailwind palette and sizes are removed;
    - compose `components/ui` instead of restyling it;
    - nothing under 12px; AA contrast.
  - Ask before adding a new runtime dependency. Pin exact versions (`npm install --save-exact`) and commit `package-lock.json`.
  - No `dangerouslySetInnerHTML` (lint error). No `window.confirm/prompt`; use `useDialogs()`.
  - Register `applydock-paired` / `applydock-open` listeners only in `src/bridge/extension.ts`; the extension depends on them.
  - The extension's `sidepanel.css` copies the color tokens from `web/src/styles/tokens.css`; change both together.
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
| `test_http_smoke.py` | The real server over HTTP, including static serving and the CSP |
| `web/src/**/*.test.ts` | Web unit tests (Vitest): pure rules, the editor store |
| `web/e2e/*.spec.ts` | Browser flows (Playwright). `extension.spec.ts` covers the side panel; `visual.spec.ts` covers the design rules on every screen |

Run `py -3 scripts/check.py` before finishing.

## Docs to keep current

When a feature's behavior changes, update its file in `docs/features/`, plus `docs/FEATURES.md` (status) and `docs/ARCHITECTURE.md` (if modules or flows change). Deferred work goes in `docs/TECH_DEBT.md`. Design rules live in `DESIGN.md`; redesign status and remaining UI issues go in `docs/DESIGN_HANDOFF.md`.

## Code graph

`graphify-out/` (git-ignored) holds a Graphify knowledge graph. For "where is X / what calls Y" questions, try `graphify query "<question>"` or skim `graphify-out/GRAPH_REPORT.md` first, then verify in the code. Refresh it with `graphify update .` after structural changes.
