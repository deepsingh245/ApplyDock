# Resume editor

This file records how in-app resume editing works and why, so future changes can build on it without rediscovering it. Read it before changing resume storage, rendering, tailoring, AI suggestions or attachments.

## Workflow

`Upload (immutable v1) → import to structured draft → review → edit / AI suggestions → render with Typst → validate → immutable version → pin to application → Gmail/SMTP attaches that exact file`

User-facing steps are in [USER_GUIDE → Resume editor](../USER_GUIDE.md#resume-editor-and-job-specific-versions).

## Files

| File | Role |
|---|---|
| `applydock/resume_model.py` | Schema `applydock-resume/1`, `normalize`, layout presets and clamping, edits, diff, `fact_guard` (pure functions) |
| `applydock/resume_import.py` | Local heuristic parser, Codex structure prompt, grounding of Codex output |
| `applydock/resume_render.py` | Typst render (deterministic, cached), `fit_to_pages`, `validate` (re-extracts the PDF) |
| `applydock/resume_store.py` | Drafts (revisioned), editor versions, tailored copies, AI job queue and worker, suggestions |
| `applydock/resume_workflows.py` | HTTP-facing orchestration: `editor_state`, `import_draft`, `reset_draft`, `tailor_resume`, `queue_suggestions`, `save_editor_version` |
| `applydock/resume_templates/` | `_common.typ` layout, `ats-classic.typ` and `compact.typ` presets, bundled fonts |
| `dashboard/js/resume-editor.js` | Editor UI: Content/Design tabs, preview, versions, compare, job match, suggestion cards, autosave, undo/redo |
| `tests/test_resume_*.py`, `tests/ui/flow-*.mjs` | Model, import, render and workflow tests; browser flows |

## Key decisions

| Decision | Choice | Why |
|---|---|---|
| Editing model | Structured data plus template rendering. The PDF is never edited directly. | PDFs have no reflow. Overlays leave stale extractable text, which is bad for ATS. Structured data can be reused across jobs. |
| Data format | `applydock-resume/1`: JSON Resume superset with stable ids on every item and bullet (`applydock/resume_model.py`) | Suggestions and edits target ids, not fragile strings. `to_json_resume()` / `from_json_resume()` exchange with other tools. |
| PDF engine | `typst` PyPI wheel (Apache-2.0). Single-column templates in `applydock/resume_templates/`. | No Chromium, Pango or Node. Real page breaking, embedded fonts, links, tagged PDF. Byte-deterministic output. |
| Fonts | Bundled Carlito (OFL; `applydock/resume_templates/fonts/OFL.txt`), with `ignore_system_fonts=True` | Same output on any machine; no scanning of system fonts. |
| Determinism | Templates set `date: none`, no ligatures, no hyphenation, no smart quotes. Values are inserted as strings, never evaluated. | Identical content gives an identical file and SHA, so deduplication and the analysis cache work. Extracted text matches what the user typed. Markup characters render literally. |
| Import | Local heuristic (`resume_import.heuristic_parse`, which reimplements ideas from OpenResume; none of its AGPL code is copied), plus an optional Codex structure job. The Codex result is cached per document SHA and grounded against the source text. | Free and instant by default; better accuracy on request. Codex can only reorganize the source text, never add to it. Every import needs user review (`needs_review`) before the first save. |
| AI provider | The existing local Codex CLI only (`ats._run_codex`). No API key. | Preserves the existing no-API-key rule (tested in `tests/test_ats.py`). Non-analysis purposes report progress to `resume_ai_jobs`, not `analysis_events`. |
| Tailoring | A tailored resume is a separate `resumes` row: `kind='tailored'`, `parent_resume_id`, `entry_id` (unique per entry and parent) | Analysis, attachment and Notion keep working unchanged. The master is never touched. Tailored rows are hidden from other applications and from the default. |
| Versions | `resume_versions` rows are immutable. Editor versions store `content_json`, `template_id`, `validation_json` and `renderer_version`. Files are content-addressed in `resume_documents`. | The exact content and template behind every generated file stays recoverable. Large files are never duplicated. |
| Restore | Moves `resumes.current_version_id` to an existing version (`activate_version`). No rows are copied. | Respects `UNIQUE(resume_id, document_id)` and keeps history linear and honest. |
| Drafts | `resume_drafts` holds one working copy per resume with a `revision`. Stale writes raise `ConflictError`, which becomes HTTP 409. | Autosave can never overwrite a newer revision. The editor serializes saves and offers "Load latest / Keep mine". |
| Pinning | `entries.resume_version_id` pins an exact version. Approval, Gmail export and "Use for this application" pin. Changing `resume_id` clears the pin. | Prevents silently attaching a different file than the one approved. New versions reset only unpinned applications to draft. |
| Attachment record | `entries.attachment_sha256`, `attachment_filename` and `attached_at` are written when a Gmail draft is created or updated and when SMTP sends. The bytes are re-hashed against the version before attaching (`attachment_bytes`). | Proves which file went out. Detects a file that changed on disk. |
| Analysis | Targets the application's effective version (pinned, else current). Staleness compares document SHA, not version id. `queue_analysis(resume_version_id=…)` scores a candidate such as an unpinned tailored version. | Fixes a pre-existing bug where identical files under different version ids looked stale forever. |
| Suggestions | Codex returns `{target_id, field, operation, original_text, proposed_text, claim_type}`. The server drops unknown targets and mismatched originals. `fact_guard` flags new numbers, technologies and requirement terms that are absent from the verified corpus (original uploads, the user's own draft and edits, the saved candidate profile). | Only explicit accept applies a change, atomically with the draft revision. Flagged suggestions need `confirm_verified`. Suggestions are cached per (analysis, content hash). |
| Design settings | `meta.layout` holds margins, fonts, spacing, colors, header alignment, heading style, date position, bullet and skills layout. Values are clamped by `resume_model.normalize_layout`. Templates are presets of these values (`LAYOUT_PRESETS`). | Layout is part of the content hash, so every saved version records exactly how it was styled. Values are clamped so the type stays readable. |
| Fit to page | `resume_render.fit_to_pages` reduces section, entry and bullet spacing, then line height, then margins, then type size, stopping at fixed minimums. | Predictable, undoable, and never makes the resume unreadable. Reports when the content alone is too long. |
| Local import | Wrapped-line aware: a line continues the one above if it starts lowercase, the previous line ends with a comma, conjunction or hyphen, or the previous line is near full width without ending a sentence. Achievements and awards are header-plus-description entries. ALL-CAPS custom headings must be letters only. | Real resumes (and pypdf output) emit every visual line separately. Without this, achievements split into many items and lines like "CGPA: 8.6" became sections. |
| Scores | Always shown as an estimate using ApplyDock's methodology. PDF checks say "text extraction checks passed", never "ATS compatible". | Honest claims. |

## Invariants (tested)

- The master resume's versions and current file never change when a tailored copy is created or edited (`tests/test_resume_workflow.py`).
- The uploaded original stays as version 1 (`source='upload'`) with its original SHA.
- A pinned application attaches exactly its pinned version, under the version's filename, and records that SHA.
- A draft write with an old revision returns 409 and changes nothing.
- AI suggestions are never applied without an explicit accept. Flagged suggestions also need confirmation.
- Imported or suggested text cannot introduce content absent from the source without being flagged or dropped.
- Rendering the same content twice produces byte-identical PDFs.

## Storage summary

| Table / column | Purpose |
|---|---|
| `resumes.kind`, `parent_resume_id`, `entry_id` | Master vs. tailored copy |
| `resume_versions.content_json`, `template_id`, `parent_version_id`, `source`, `validation_json`, `label`, `renderer_version` | Exact inputs and checks for generated versions |
| `resume_documents.structured_*` | Cached Codex import per file |
| `resume_drafts` | Revisioned working copy, import source and warnings, `needs_review` |
| `resume_ai_jobs` | Background Codex jobs (import, suggestions) with progress; `UNIQUE(purpose, input_hash)` |
| `resume_suggestions` | Suggestions with status, guard flags and applied/previous text for revert |
| `entries.resume_version_id`, `attachment_sha256`, `attachment_filename`, `attached_at` | Application ↔ exact file |

The migration to `PRAGMA user_version=4` is additive. `backup_before_migration()` copies the database to `data/capture.pre-v4-*.sqlite3` first.

## API

- **Draft:**
  - `GET /api/resumes/{id}/draft` returns editor state and creates the draft on first open.
  - `PATCH /api/resumes/{id}/draft` with `{content, expected_revision, reviewed?}`.
  - `POST /api/resumes/{id}/draft/import` with `{mode: heuristic|codex, expected_revision}`. For Codex this returns `{job}` until the cached result exists.
  - `POST …/draft/reset` with `{expected_revision, version_id?}`.
  - `POST …/draft/preview` with `{content}` returns `application/pdf` plus an `X-Page-Count` header.
  - `POST …/draft/validate` with `{content}`.
  - `POST …/draft/analyze` with `{entry_id, expected_revision}` scores the current draft against an application **without saving a version** ("Re-analyze draft" in Job match). The draft is rendered exactly as Save version would; the run stores the rendered document (`analysis_runs.document_id`, `draft_resume_id`) and, if the same content is saved later, that version reuses the result. Deleting the resume deletes its draft checks and their files.
- **Versions:**
  - `POST /api/resumes/{id}/versions/from-draft` with `{expected_revision, label?}`.
  - `POST …/versions/{vid}/restore`.
  - `GET …/versions/{vid}/file?access=` takes the per-version token or the pairing key. The current-file token is not accepted.
  - `GET …/versions/{vid}/content?draft_of=`.
- **Applications:**
  - `POST /api/entries/{id}/tailor` with `{base_resume_id}`.
  - `POST /api/entries/{id}/pin-resume` with `{resume_id, resume_version_id?}`.
  - `POST /api/entries/{id}/analyses` with `{resume_version_id?}`.
- **Suggestions:**
  - `POST /api/analyses/{id}/suggestions` with `{resume_id}`.
  - `GET /api/resumes/{id}/suggestions?analysis_id=`.
  - `POST /api/resume-suggestions/{sid}/accept` with `{expected_revision, text?, confirm_verified}`.
  - `POST …/{sid}/revert` with `{expected_revision}`.
  - `PATCH /api/resume-suggestions/{sid}` with `{status}`.
- **Jobs:** `GET /api/resume-jobs/{id}`.

## Using the Master Profile in the editor

- **From profile** (side panel tab) lists Master Profile entries with **In resume** or **Add to resume**; entries the job analysis
  cited for a gap come first, tagged "Helps with: …". Adding copies facts exactly (`POST /api/resumes/{id}/draft/add-from-profile`
  with `{key, expected_revision, confirm_unverified, replace}`; `GET …/draft/profile-entries` lists them):

  | Profile entry | Becomes |
  |---|---|
  | Summary / headline (`personal:summary`, `personal:headline`) | `basics.summary` / `basics.label` (replacing existing text needs `replace`) |
  | Experience | a work item with its verified bullets |
  | Project | a project item (live or repo URL, technologies as keywords) with its verified bullets; refused when marked not for resumes |
  | Skill | a keyword in the skill group for its category (created if missing) |
  | Achievement / education / certification | an award / education item / certificate |

  Unverified entries need `confirm_unverified`; entries already present are refused. It is a draft edit (one undo step); nothing
  becomes a version until **Save version**.
- **Recommend from my profile for this job** re-analyzes the draft with the current profile, then asks for suggestions in one click.
  Suggestions may now also *write a missing summary* (the empty summary is sent to Codex; `suggest-v3`).
- **Add a section:** empty sections are listed as chips under Personal information instead of sitting empty in the form; a chip
  opens that section. A section with a pending suggestion (an AI summary, an added project) is always shown.

## Job match buttons

**Check score** (score the unsaved draft, accepted suggestions included, against this analysis; no version and no history entry;
also in the toolbar; the result says what was checked, lists each re-checked requirement with its reason, and offers **Re-check all
requirements**) · **Suggest improvements / Refresh suggestions** ·
**New analysis** (analyze the unsaved draft; added to history) · **Save version & new analysis**. **Open full analysis** shows the analysis page in a large dialog over the editor (`openAnalysisModal` moves `#analysis-view`
into `#analysis-dialog`); ×, Esc, or a backdrop click returns to the editor. Opened from anywhere else it is a normal page. **Recommend from my profile**
reuses the current analysis and only runs one when none exists. See [ats-analysis](ats-analysis.md#stable-verdicts-and-score-checks-2026-10-27).

## Design tab

Cards are grouped into two independent columns (layout: template, page, margins, spacing, header · type: text, color, sections and entries) so short cards never leave gaps; Section order spans both. Sections are reordered by dragging a row (pointer events, so it also works on touch) or by focusing a row's handle and pressing ↑/↓; each move is one undo step.

## Not done yet (candidates for later)

- Evidence bank UI (verified achievements library). `corpus_for()` is the hook.
- Smart resume selection when opening a job.
- DOCX or LaTeX export (JSON Resume export exists in `resume_model`).
- Reproducing custom original designs. Only two restrained templates exist.
- New Notion fields for version or attachment SHA. Notion shows the tailored resume's name and, for pinned applications, the version link.
- OCR for scanned PDFs. Image-only files fall back to manual entry with a warning.
