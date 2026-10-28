# Features

Status: **Done** = implemented and covered by tests · **Partial** = works with known gaps · **Deferred** = planned, not built.

| Feature | Description | Status | Docs | Key dependencies |
|---|---|---|---|---|
| Capture | Extension side panel extracts the current job/post; manual capture form in the dashboard | Done | [capture-and-extension](features/capture-and-extension.md) | `extension/`, `applications.capture` |
| Applications workspace | Queue, filters, application editor tabs, stages, inspector | Done | [applications](features/applications.md) | `applications.py`, `web/src/features/applications/` |
| Resume library | Upload PDF/DOCX, versions, default, preview, delete | Done | [resume-library](features/resume-library.md) | `resumes.py`, `ats.install_document` |
| Resume editor | Structured editing, live Typst PDF preview, design controls, versions, compare | Done | [resume-editor](features/resume-editor.md) | `resume_*.py`, `resume_workflows.py`, `web/src/features/resume-editor/`, `typst` |
| Resume import | PDF/DOCX text → structured sections (local parser; optional Codex) | Done | [resume-editor](features/resume-editor.md#key-decisions) | `resume_import.py`, `pypdf` |
| Tailored resumes | Per-application copies of a master; pinned versions | Done | [resume-editor](features/resume-editor.md) | `resume_store.create_tailored`, `entries.resume_version_id` |
| AI suggestions | Targeted edits from analysis gaps; accept/reject/revert; fact guard | Done | [resume-editor](features/resume-editor.md) | `resume_store`, Codex CLI |
| ATS analysis | Evidence-based job match estimate via Codex: fixed requirement checklist per job, Python scoring, caching, queue, run-to-run comparison | Done | [ats-analysis](features/ats-analysis.md) | `ats.py`, Codex CLI |
| Master Profile | Settings → Master Profile: personal details, experience, projects, skills, achievements, education, certifications; verification; import from a resume | Done | [master-profile](features/master-profile.md) | `profile.py`, `career.py`, `dashboard/js/profile.js` |
| Link verification | On-demand, SSRF-safe reachability checks for project links; your own functional test recorded separately | Done | [master-profile](features/master-profile.md#link-verification) | `linkcheck.py` |
| Career intelligence | Job ↔ resume ↔ profile coverage, potential score, profile-sourced resume suggestions (add project / bullet) | Done | [master-profile](features/master-profile.md) | `ats.py`, `resume_store.py`, Codex CLI |
| Submission history | Immutable record of the exact file sent per application; audit trail; usage in the library; Applied filter shows sent history | Done | [master-profile](features/master-profile.md#data-model-and-relationships) | `submissions.py` |
| Recurring link monitoring, verified Gmail sends | Background link checks; read sent Gmail to confirm sends | Deferred | [master-profile](features/master-profile.md#not-done-yet) | — |
| AI email draft | Codex writes subject/body from the job + your profile | Done | [email-delivery](features/email-delivery.md) | `ai_draft.py` |
| Gmail drafts | OAuth, draft create/update with exact resume, "prepare schedule" | Done | [email-delivery](features/email-delivery.md) | `gmail.py` |
| Local 9 AM sender | Approve → SMTP send at 9:00 local time | Done (needs PC on) | [email-delivery](features/email-delivery.md) | `delivery.py` |
| Notion sync | Two-way field sync, stage options, trash reconciliation | Done | [notion-sync](features/notion-sync.md) | `notion.py` |
| Dashboard Content-Security-Policy | CSP header for the dashboard page | Deferred | [TECH_DEBT](TECH_DEBT.md) | — |
| Shared extension/dashboard code | Remove duplicated helpers between extension and dashboard | Deferred | [TECH_DEBT](TECH_DEBT.md) | — |
| OCR for scanned resumes | Read image-only PDFs | Deferred | [resume-editor](features/resume-editor.md) | — |
| Evidence bank, smart resume selection, DOCX export | Resume-editor follow-ups | Deferred | [resume-editor](features/resume-editor.md#not-done-yet-candidates-for-later) | — |
