# ApplyDock

ApplyDock is a **personal, local-first job-application workspace** for one person on Windows. You capture the jobs and hiring posts you care about, see how well your resume fits each one, tailor a resume per job (with AI suggestions you approve), send the application by email with the exact resume file attached, and keep a record of what was sent where. A second feature, **Outreach**, helps you contact recruiters on WhatsApp.

Everything runs on your own PC at `http://127.0.0.1:8765`. Your data lives in a local `data/` folder. The only AI is the **Codex CLI signed in with your ChatGPT Plus account** (no API keys, no extra billing). AI never sends anything or changes your resume on its own: every change is a suggestion you accept.

> This README is written so that someone (or an AI assistant) with no other context can understand what the app does, how the parts fit together, and the rules it follows. Deeper docs are linked at the end.

---

## 1. The big picture

```text
┌──────────────────────┐        ┌─────────────────────────────────────────────┐        ┌───────────────┐
│ Chrome extension     │  HTTP  │ Python helper (applydock/), 127.0.0.1:8765  │  CLI   │ Codex CLI     │
│ (extension/)         ├───────►│  • JSON API (/api/...)                      ├───────►│ (ChatGPT Plus)│
│ capture side panel   │        │  • serves the web app (web/dist)            │        └───────────────┘
└──────────────────────┘        │  • SQLite + files in data/                  │        ┌───────────────┐
┌──────────────────────┐  HTTP  │  • background workers (analysis, AI jobs,   ├───────►│ Notion, Gmail,│
│ Web app (React, web/)├───────►│    scheduled sender, Notion check)               │        │ SMTP          │
│ in your browser      │        └─────────────────────────────────────────────┘        └───────────────┘
└──────────────────────┘
```

- **One process, one user.** The Python "helper" is a standard-library HTTP server. It stores everything in SQLite (`data/capture.sqlite3`) plus content-addressed files (`data/resumes/...`).
- **Two clients.** The React web app (the main workspace) and the Chrome extension (quick capture from job sites). Both authenticate with a **pairing key** printed in the helper window, sent as the `X-Local-Key` header.
- **Node.js is only a build tool.** `start.cmd` builds the web app (`web/` → `web/dist`), then the Python helper serves it. Nothing Node runs at runtime.

---

## 2. The main workflow, end to end

1. **Capture a job or hiring post.**
   - On LinkedIn, Indeed, Greenhouse, Lever, Workday, Wellfound, Naukri and others, open the extension side panel and press **Capture**. It extracts the title, company, job text, apply link and any emails. It uses JSON-LD JobPosting data, site selectors, the "About the job" section on LinkedIn split views, or your text selection.
   - Or add a job manually in the web app (**Add a job**).
   - The result is an **application** (an "entry").
2. **Pick a master resume.** You upload PDF/DOCX resumes to the **Resume library**. One is the default. Each upload is an immutable, content-addressed **version**.
3. **Import the resume into structure.** Open a resume in the **Resume editor**. Its text is parsed into sections: basics, summary, experience, projects, skills, education, certificates, awards, custom. A local parser is used, with optional Codex import. You review it once and mark it reviewed.
4. **Run the ATS analysis.** The app extracts a fixed **requirement checklist** from the job description (once per job-description version, so reruns are comparable). Codex then judges each requirement against your resume, and against your **Master Profile**, as one of:
   - demonstrated;
   - partial;
   - listed;
   - missing.

   **Python** (not the AI) computes the score:
   - weights per category: required skills 35, experience 25, responsibilities 20, preferred skills 10, education 5;
   - ATS readability adds 5% of the estimate;
   - mandatory requirements count double.

   The result is an *estimated match*, not a real employer ATS score.
5. **Tailor the resume for this job.**
   - **Optimize resume** creates a **tailored copy** of the master for this application: an exact copy of the master as it currently is (content, section order and headings). Only the *look* (template, fonts, spacing, colors, page limit) comes from your chosen **default design**.
   - The master never changes, and the application switches to use the tailored copy.
6. **Improve it with suggestions.** **Suggest improvements** asks Codex for targeted edits based on the analysis gaps:
   - rewrite a bullet;
   - add a bullet;
   - add a skill;
   - add a project from your Master Profile;
   - write a missing summary.

   Each suggestion is shown next to the text it changes. You **Accept**, **Edit**, **Revert** or **Reject** it.
   - A **fact guard** flags anything not found in your resume or verified profile (new numbers, tools, claims). Flagged suggestions need explicit confirmation.
   - **Missing requirements** (supported by nothing in your resume or profile) are never invented. They appear as questions instead: "Have you done this? Where does it belong, and what did you do?" From your answer, Codex writes one line using only your words, or adds the skill you name. You then review that line like any other suggestion.
7. **Check the score without saving.**
   - **Check score** re-scores the *unsaved draft* (including accepted suggestions) against the current analysis. Only the requirements your edits touched are re-judged. The analysis history isn't touched.
   - **New analysis** runs a full analysis of the draft.
   - **Save version & new analysis** saves the draft as a version and then runs a full analysis on it.
8. **Save a version.**
   - **Save version** renders the draft to PDF with **Typst**, validates it, and stores it as a new immutable version. The file is named "Your Name - Company.pdf".
   - **Download PDF** always gives you what the preview shows: unsaved edits are saved as a new version first.
9. **Apply.** On the application:
   - choose the route (**email** or **external form**);
   - write or **Draft email with Codex** (subject and body from the job and your profile; your signature is added).

   Then deliver it in one of two ways, both attaching the exact resume version:
   - **Gmail drafts:** OAuth; save or update a draft with the resume attached, then schedule in Gmail yourself.
   - **Local scheduled sender:** approve the application and the helper sends it over SMTP at the time you choose. The PC must be on.

   For hiring posts that can only be answered by email, the email is drafted automatically when you save the tailored resume. It is never sent automatically.
10. **Record the submission.** **Mark as submitted** stores an immutable record of the **exact PDF** sent (with SHA-256) and when and how it was sent. It stays retrievable even if the resume is later edited or deleted. The application moves to the **Applied** tab.
11. **Stay in sync.** Application fields sync two ways with a **Notion** database, including stage options and trash reconciliation.

---

## 3. Features in more detail

### Applications workspace (`/applications`)
- A three-pane layout: the list, the application editor and an inspector.
- **Two tabs only:**
  - **Review** (default): everything not applied yet.
  - **Applied**: sent, submitted, or at a stage past applying (Applied, No Answer, Offer, Rejected). Rejected applications appear here with their Rejected tag.
- Search (`/` shortcut), plus analysis, score and sort filters.
- Editor tabs: Overview, Job details, Resume, Email, Analysis. The progress strip runs Captured → Analyzed → Resume → Email → Applied.
- The **inspector** shows the estimated match and promotes one **Next step** action: run analysis, optimize resume, Gmail draft, approve, mark as submitted.
- Delivery tags appear only for real states (Gmail draft, scheduled, approved, sending, needs attention); there is no "Draft" tag.
- Unsaved changes are guarded, Ctrl+S saves, and there is a phone layout.

### Resume library (`/resumes`)
Upload PDF/DOCX files (up to 8 MB). The library lists masters, each followed by its tailored copies. It offers a preview, rename, category, replace file, make default and delete, plus a "where was this sent" usage list.

### Resume editor (`/resumes/:id/edit`)
- **Content tab:** structured forms per section.
  - Experience entries have an optional **subheading**.
  - Empty sections are added from "Add a section".
  - Undo/redo (100 steps), and autosave with revision checks (a 409 conflict offers "Load latest / Keep mine").
- **Design tab:**
  - templates (ATS Classic, Compact), paper, page limit with **Fit to N pages**;
  - margins, spacing, header, fonts, sizes and accent color;
  - section order (drag or keyboard).

  A **Make this my default design** button copies this resume's design to the default.
- **Side panel:**
  - Preview (live Typst PDF, page count, PDF checks);
  - Versions (download, compare, make current, edit from here);
  - Compare (structured diff against another version or the master);
  - **Job match** (score, gaps, Check score, suggestions, New analysis, full analysis dialog);
  - **From profile** (add Master Profile entries, or "Recommend from my profile").

### Resume design (Settings → Resume design)
A **default design** for new resumes, edited with the same controls and a live PDF preview of one of your resumes. Two modes:
- **Use my default design:** new tailored copies get this look.
- **Follow the last design I edited:** whatever look you last changed in the editor.

Saved resumes always keep their own design.

### ATS analysis (`/analysis/:id`)
- A queue with live progress and an activity log.
- The score, with coverage counts. Coverage means how each requirement is covered: represented, weakly described, in your profile but not the resume, or missing from both.
- The potential score if the profile evidence were added, and the change since the previous run.
- A requirement explorer with evidence, filters and search.
- A per-requirement checklist (pending, reviewed, addressed). **Addressed** items move out of the open list and get no further suggestions.
- History and resume versions.
- **Stability rules:**
  - re-analyzing the same file reuses its previous verdicts;
  - a requirement never drops while the resume text supporting it is unchanged;
  - the previous assessment is shown to the model.

### Master Profile (Settings → Master Profile)
- Your career record as the "source of truth": personal details, experience, projects you built, skills, achievements, education and certifications.
- Each entry can be **verified** or not. Claims (bullet facts) carry their own verified flag.
- **Import from a resume.**
- **Link verification:** on-demand reachability checks for project links that can't be pointed at internal addresses, plus your own recorded functional test.
- The analysis compares jobs against the profile too, and suggestions can pull **verified** profile facts into a tailored resume.

### Email and delivery
- **AI email draft:** Codex writes the subject and body from the job and your profile, and the signature is appended. The **Copy prompt** fallback is for pasting into a chat.
- **Gmail** works through OAuth (a Desktop client JSON uploaded in Settings): create or update drafts with the exact resume attached, and "Prepare Gmail schedule".
- **SMTP** uses an app password and is verified before saving. The local scheduled sender needs approval and the helper running.

### Outreach (`/outreach`, WhatsApp)
- Recruiter/HR **contacts**: import CSV/TSV (Indian numbers normalised to +91) or add them manually.
- **Templates** with `{{hr_name}}`, `{{company_name}}`, `{{job_title}}`.
- **Batch scheduling:** preview first, then confirm; working days only, spacing, caps, India time. Each message pins a resume version.
- **Queue:** Open WhatsApp (a `wa.me` link that only prefills the text), Copy, I sent it, Skip, Failed.
- Reminders, follow-ups (3 and 7 working days by default) and history.
- **Assisted, not automatic:** a message is recorded as sent only when you confirm it.
- An optional extension-based sender exists but is **switched off** (`OUTREACH_SENDER_ENABLED` / `EXTENSION_SENDING`). WhatsApp's terms forbid automation, and its page selectors haven't been tested against a live session.

### Chrome extension (`extension/`, Manifest V3 side panel)
- Captures the current page (with a preview to edit before saving).
- Lists applications with the same **Review / Applied** tabs.
- Edits the stage, route and email fields; Gmail draft and approve actions.
- **Opens the web app on an application** (analysis, optimize, submission) or the Master Profile. It does this by injecting the `applydock-paired` / `applydock-open` events into the web app tab.

### Home (`/`)
Feature cards with quick links: Applications and resume parsing, Outreach, and so on.

---

## 4. AI: how it is used and its rules

- **Codex CLI only** (`ats._run_codex`).
  - It runs as a read-only, sandboxed subprocess with the prompt on stdin.
  - It uses a structured-output JSON schema (`applydock/schemas/*.json`) and reads the reply from the `--output-last-message` file as UTF-8.
  - The model is set in `ats.MODEL`.
  - There are **no API keys**; a test enforces this.
- **Uses:**
  - resume import;
  - job-requirement extraction;
  - requirement matching;
  - score checks;
  - tailoring suggestions;
  - writing a line from your answer to a missing requirement;
  - email drafts.
- **Guardrails:**
  - All scraped or captured text is treated as **untrusted data, never instructions**.
  - Output is **validated or grounded**. Suggestions must target real resume items with matching text, and the fact guard flags unsupported numbers, terms and skills.
  - Facts from unverified profile entries need confirmation.
  - The AI never writes content for requirements with no evidence; it asks you instead.
  - The **AI never auto-applies a suggestion and never sends email.** Every change and every send is an explicit user action.
- **Caching:** analyses are cached by resume file hash, job-description hash, parser/schema/scoring version and profile snapshot. Suggestion and score-check jobs are cached by their inputs.
- **Usage limits:** if the ChatGPT Plus limit is hit, the queue pauses (`plan_limit`) instead of failing repeatedly.

---

## 5. Architecture and code map

```text
server.py                 entry point (start.cmd runs it)
applydock/                Python helper
  config.py               paths, settings (data/config.json), DPAPI secrets; no import side effects
  database.py             SQLite schema + additive migrations (PRAGMA user_version, currently 7) with automatic backup
  http_server.py          request handling, auth (pairing key, Host/Origin checks), static web app + CSP, @route table
  app.py                  startup: settings, migrations, workers, server
  applications.py         applications ("entries"): capture, URL cleanup, editing, approval, stages
  resumes.py              resume library, versions, current/pinned version, access-token file links
  resume_model.py         structured resume schema, normalize, edits, diffs, design keys, fact guard (pure functions)
  resume_import.py        PDF/DOCX text → structured resume (local heuristic + Codex, grounded)
  resume_render.py        Typst rendering, fit-to-pages, PDF validation
  resume_store.py         drafts, editor versions, tailored copies, AI job queue, suggestions (DB layer)
  resume_workflows.py     editor orchestration: editor state, import, tailor, suggestions, score check,
                          missing-requirement answers, design settings, save version
  ats.py                  text extraction, Codex runner, analysis queue/worker, scoring, stability rules
  profile.py / career.py  Master Profile storage, evidence blocks, import; HTTP-facing workflows
  linkcheck.py            on-demand, SSRF-safe link checks
  submissions.py          immutable submission records (exact file + SHA-256)
  ai_draft.py             Codex email drafts;  auto_email.py: automatic drafts for email-only hiring posts
  gmail.py / delivery.py  Gmail OAuth + drafts;  SMTP verification + scheduled sender loop
  notion.py               Notion schema mapping, push, inbound edits, trash reconciliation
  outreach.py, outreach_schedule.py   WhatsApp outreach contacts, templates, batches, queue, reminders
  events.py               "application changed" notifications (Notion sync listens)
  schemas/                Codex structured-output JSON schemas
  resume_templates/       Typst templates + bundled fonts
web/                      React web app (built into web/dist)
  src/app/                router, pairing gate, top bar, extension deep-link handler
  src/api/                payload types, TanStack Query client/keys, per-domain hooks
  src/bridge/extension.ts applydock-paired / applydock-open listeners (registered before render)
  src/components/ui/      design-system primitives (Radix + Tailwind)
  src/features/           applications, analysis, resume-library, resume-editor, resume-design, profile,
                          settings, outreach, home (one folder per screen)
  src/lib/                API client (only place that knows the pairing key), domain rules, formatting, theme
  e2e/                    Playwright browser tests against a sandbox helper
extension/                Chrome MV3 side panel (sidepanel.html/js/css, background.js, whatsapp.js)
tests/                    Python unittest suites; tests/ui/sandbox.py = seeded helper with a fake Codex
scripts/check.py          runs every check
docs/                     architecture, features, user guide, design notes, tech debt
```

**Layering:** dependencies point one way, and `tests/test_architecture.py` fails on any import cycle:
- `config`, `events` and `resume_model` come first;
- then `database`, `ats` and `resume_*`;
- then `resumes`;
- then `applications`;
- then Notion, Gmail, delivery and `resume_workflows`;
- then `http_server`, then `app`.

Domain code reports changes with `events.application_changed(id)` instead of calling Notion directly.

### Data stored (SQLite)

| Table(s) | Holds |
|---|---|
| `entries` | Applications: job fields, email fields, stage, delivery state, `resume_id`, optional pinned `resume_version_id`, attachment hash |
| `resumes` | Library items: `kind` master or tailored (tailored rows record `parent_resume_id` and `entry_id`), current version, access token |
| `resume_versions`, `resume_documents` | Immutable versions pointing at content-addressed files `data/resumes/versions/{sha256}.ext`, extracted text, structured content |
| `resume_drafts` | The editor's working copy per resume (revisioned) |
| `resume_suggestions`, `resume_ai_jobs` | AI suggestions (including "ask" questions) and background Codex jobs (import, suggestions, score check) |
| `analysis_runs`, `analysis_checklist`, `analysis_events`, `job_description_versions`, `ai_runs` | Analyses, checklist states, progress log, the job text each run used, AI telemetry |
| `profile_items`, `profile_link_checks` | Master Profile entries and link-check results |
| `application_submissions` | Exact file sent per application |
| `outreach_*` | Outreach contacts, templates, schedules, history |

The settings file `data/config.json` holds:
- the pairing key;
- the Notion mapping;
- the profile text;
- your email signature;
- the resume design preference;
- tokens and passwords, **DPAPI-encrypted** for your Windows account.

### HTTP API (all under `/api`, JSON, pairing key required)

Grouped by area:
- **State:** `GET /api/state` returns applications, resumes, connection statuses, Codex status and the profile hash.
- **Applications:** capture, `PATCH`/`DELETE` an entry, tailor, pin resume, submissions, AI draft, Gmail draft/prepare/scheduled.
- **Analysis:**
  - `POST /api/entries/{id}/analyses`, `GET /api/analyses/{id}`, and the queue;
  - checklist `PATCH`;
  - `POST /api/analyses/{id}/score-check`;
  - `POST /api/analyses/{id}/suggestions`.
- **Resumes:** upload, versions, restore, file links (token-protected, so previews work in iframes), usage.
- **Resume editor:**
  - `GET`/`PATCH /api/resumes/{id}/draft`;
  - draft actions: import, reset, preview (returns a PDF), validate, fit, analyze, profile-entries, add-from-profile;
  - save a version from the draft.
- **Suggestions:**
  - accept / revert / `PATCH` status;
  - `POST /api/resume-suggestions/{id}/answer` turns a missing-requirement question into a suggestion.
- **Background jobs:** `GET /api/resume-jobs/{id}` (the UI polls it).
- **Design:** `GET`/`PATCH /api/resume-design`.
- **Profile:** profile items CRUD, personal details, import, verify links.
- **Settings:** Notion, SMTP, Gmail client/connect, AI background text, Codex check; plus sync.
- **Outreach:** contacts (incl. import), templates, batches (preview, confirm, pause/resume/cancel), schedules, extension claim/report.

### Security model
- Binds to `127.0.0.1` only.
- Every API call needs the pairing key (constant-time compare), a loopback `Host`, and an `Origin` that is either the app itself or a Chrome extension.
- Resume files are opened by unguessable `?access=` tokens.
- The web page has a strict **Content-Security-Policy** (`script-src 'self'`).
- Secrets are DPAPI-encrypted, and resume text, tokens and the pairing key are never logged.
- Link checks can't be pointed at internal network addresses (SSRF-safe).

---

## 6. Tech stack

| Layer | Technology |
|---|---|
| Helper / API | Python 3.12 standard-library HTTP server; only `pypdf` (text extraction) and `typst` (rendering) as dependencies |
| Storage | SQLite + content-addressed files under `data/` |
| Web app | React 19, TypeScript (strict), Vite, Tailwind v4 with design tokens ("Ledger"), Radix/shadcn-style primitives, TanStack Query, React Router 7, React Hook Form + Zod, Zustand + Immer (resume editor), dnd-kit, sonner |
| Extension | Chrome Manifest V3 side panel, plain JS |
| AI | Local Codex CLI (ChatGPT Plus) |
| Tests | Python `unittest`; Vitest + Testing Library; Playwright (installed Chrome/Edge) against a sandbox helper with a fake Codex; axe accessibility checks |
| Secrets | Windows DPAPI |

---

## 7. Running it

Prerequisites: Windows, Python 3.12+, Node.js 22+ (to build the web app), Chrome. The Codex CLI signed in with ChatGPT Plus is needed for the AI features.

```powershell
py -3 -m pip install -r requirements.txt
start.cmd                 # builds web/ and starts the helper; keep the window open
```

1. Open <http://127.0.0.1:8765/> and paste the **pairing key** printed in the helper window.
2. Load the extension: `chrome://extensions` → **Load unpacked** → `extension/`, then pair it in its Settings.
3. In Settings, connect what you use: the Codex check, Notion, the Gmail OAuth client, SMTP, the AI writing background, and the Master Profile.

| Environment variable | Purpose | Default |
|---|---|---|
| `APPLYDOCK_DATA_DIR` | Folder for the database, settings and resume files | `./data` |
| `APPLYDOCK_PORT` | Local HTTP port | `8765` |

Full setup: [docs/USER_GUIDE.md](docs/USER_GUIDE.md).

## 8. Development

```powershell
py -3 -m pip install -r requirements-dev.txt   # ruff
npm --prefix web ci                            # web dependencies (exact versions, lockfile committed)
npm --prefix web run dev                       # Vite on :5173, proxies /api to the helper
py -3 scripts/check.py                         # ruff, all Python tests, extension checks, web typecheck+lint+unit tests+build
py -3 scripts/check.py --ui                    # plus Playwright browser flows (needs Chrome or Edge)
```

**Project rules:**
- Never touch `data/` in code or tests. Tests use temporary folders (`tests/support.isolate_app`) and a sandbox helper with a fake Codex.
- Read settings as attributes (`config.DATA`, `config.SETTINGS`).
- No side effects at import time.
- Database schema changes are additive only, with a new `user_version` step (a backup runs automatically).
- API changes stay backward compatible with the web app and the extension.
- Web UI:
  - only design tokens (no raw colors, nothing under 12px, AA contrast);
  - compose the shared `components/ui`;
  - no `dangerouslySetInnerHTML`;
  - no `window.confirm`; use the in-app dialogs.
- Every behaviour change comes with tests and updated docs. AI coding guidance: [CLAUDE.md](CLAUDE.md).
- There is no deployment: this is a personal local app. "Deploying" means pulling the code and restarting `start.cmd`.

## 9. Glossary

| Term | Meaning |
|---|---|
| Entry / application | One captured job or hiring post and everything about applying to it |
| Master resume | An uploaded resume you keep general; never changed by tailoring |
| Tailored copy | A per-application copy of a master, edited for that job |
| Version | An immutable saved PDF of a resume (content-addressed by SHA-256) |
| Draft | The editor's working content for a resume, autosaved, not a file yet |
| Pinned version | An application locked to one exact resume file (set by approval or "Use for application") |
| Master Profile | Your verified career facts, used for matching and suggestions |
| Coverage | How a job requirement is covered: resume, profile only, weak, or missing from both |
| Suggestion | An AI-proposed edit you accept/edit/reject; "ask" suggestions are questions for missing requirements |
| Check score | Re-score of the unsaved draft without adding to the analysis history |
| Submission | Immutable record of the exact file you sent to an employer |
| Pairing key | The secret the web app and extension use to talk to the local helper |

## 10. More documentation

| Document | Contents |
|---|---|
| [docs/USER_GUIDE.md](docs/USER_GUIDE.md) | Setup and day-to-day use |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Modules, request flow, data flow, storage, security |
| [docs/FEATURES.md](docs/FEATURES.md) | Feature index with status |
| [docs/features/agent-access.md](docs/features/agent-access.md) | Pairing-key API, OpenAPI, MCP bridge, and human-only actions |
| [docs/features/](docs/features/) | One document per feature (applications, resume editor, ATS analysis, master profile, email delivery, capture and extension, Notion sync, WhatsApp outreach, resume library) |
| [DESIGN.md](DESIGN.md) | Design system: tokens, components, layout, accessibility |
| [web/README.md](web/README.md) | Web app commands, layout and conventions |
| [docs/TECH_DEBT.md](docs/TECH_DEBT.md) | Deferred work and known gaps |
| [CLAUDE.md](CLAUDE.md) | Rules for AI coding agents working on this repo |

## Privacy

`data/` holds your applications, resumes, pairing key and encrypted credentials. It is git-ignored; **never commit it**. Check `git status --short` before pushing. The repository has no license file yet.
