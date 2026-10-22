# ApplyDock

A local-first job-application workspace for one person. A Chrome extension captures the jobs and hiring posts you choose. A small Python helper on your Windows PC stores them in SQLite and syncs them to Notion. It also scores your resume against each job with your ChatGPT Plus Codex allowance, lets you tailor resumes in-app, and prepares Gmail drafts or 9 AM SMTP sends with the exact resume file attached.

Everything runs on `127.0.0.1`. Your data stays in the local `data/` folder.

## Features

- **Capture:** save specific jobs and hiring posts from LinkedIn, Indeed, Greenhouse, Lever, Workday and more (extension), or enter them manually.
- **Applications workspace:** queue, filters, stages, email drafting, and a delivery inspector.
- **Resume library:** PDF/DOCX uploads with content-addressed, immutable versions.
- **Resume editor:** import a PDF into structured sections, edit with a live Typst-rendered PDF preview, adjust design (margins, fonts, spacing), and create tailored per-job copies. The master is never changed.
- **ATS analysis:** evidence-based match estimate through the local Codex CLI. No API key, cached per resume and job.
- **AI suggestions:** targeted edits you accept or reject. Unverified claims are flagged for your confirmation.
- **Delivery:** Gmail drafts (OAuth) or a local 9 AM SMTP sender, always attaching the pinned resume version.
- **Notion:** two-way sync of application fields, plus trash reconciliation.

See [docs/FEATURES.md](docs/FEATURES.md) for status and details.

## Tech stack

| Layer | Technology |
|---|---|
| Helper / API | Python 3.12 standard-library HTTP server (`applydock/`) |
| Storage | SQLite (`data/capture.sqlite3`), local files under `data/resumes/` |
| Dashboard | Plain HTML/CSS/JavaScript with no build step (`dashboard/`) |
| Extension | Chrome Manifest V3 side panel (`extension/`) |
| PDF | `pypdf` (text extraction), `typst` (resume rendering) |
| AI | Local Codex CLI signed in with ChatGPT Plus |
| Secrets | Windows DPAPI (per Windows account) |

## Quick start

Prerequisites: Windows, Python 3.12+, Chrome. Node.js is optional (for JS checks), and the Codex CLI is optional (for AI features).

```powershell
py -3 -m pip install -r requirements.txt
start.cmd                      # or: py -3 server.py — keep the window open
```

1. Open <http://127.0.0.1:8765/> and paste the **pairing key** printed in the helper window.
2. Load the extension from `chrome://extensions` → **Load unpacked** → `extension/`, then pair it in its Settings.

Full setup (Notion, Gmail, SMTP, Codex) is in [docs/USER_GUIDE.md](docs/USER_GUIDE.md).

### Environment variables

| Name | Purpose | Default |
|---|---|---|
| `APPLYDOCK_DATA_DIR` | Folder for the database, settings and resume files | `./data` |
| `APPLYDOCK_PORT` | Local HTTP port | `8765` |

Tokens and passwords are entered in the app and stored DPAPI-encrypted in `data/config.json`. There are no `.env` secrets.

## Development

```powershell
py -3 -m pip install -r requirements-dev.txt   # adds ruff
py -3 scripts/check.py                         # lint, all Python tests, JS syntax, extension test
py -3 scripts/check.py --ui                    # plus browser flows (needs Chrome or Edge)
```

- **Tests** (`tests/`): `unittest` plus a few Node scripts. They run against temporary folders and never touch `data/`. `test_http_smoke.py` starts the real server on a random port. `tests/ui/` drives Chrome against a seeded sandbox with a fake Codex.
- **Deployment:** none. This is a personal local app. "Deploying" means pulling the code and restarting `start.cmd`.
- **Code map:** [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). AI coding guidance: [CLAUDE.md](CLAUDE.md).

## Documentation

| Document | Contents |
|---|---|
| [docs/USER_GUIDE.md](docs/USER_GUIDE.md) | Setup and day-to-day use |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Modules, data flow, security boundaries, storage |
| [docs/FEATURES.md](docs/FEATURES.md) | Feature index with status and links |
| [docs/features/](docs/features/) | One document per complex feature |
| [DESIGN.md](DESIGN.md) | Design system: tokens, components, layout and accessibility rules |
| [docs/DESIGN_HANDOFF.md](docs/DESIGN_HANDOFF.md) | What the 2026-10 redesign changed, measured results, remaining UI issues |
| [docs/TECH_DEBT.md](docs/TECH_DEBT.md) | Deferred work, including the dashboard Content-Security-Policy |

## Privacy

`data/` holds your applications, resumes, pairing key and encrypted credentials. It is git-ignored; **never commit it**. Before pushing, check `git status --short`. The repository has no license file yet.
