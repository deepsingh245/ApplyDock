# Features

Status: **Done** = implemented and covered by tests · **Partial** = works with known gaps · **Deferred** = planned, not built.

| Feature | Description | Status | Docs | Key dependencies |
|---|---|---|---|---|
| Capture | Extension side panel extracts the current job/post; manual capture form in the dashboard | Done | [capture-and-extension](features/capture-and-extension.md) | `extension/`, `applications.capture` |
| Applications workspace | Queue, filters, application editor tabs, stages, inspector | Done | [applications](features/applications.md) | `applications.py`, `dashboard/js/applications.js` |
| Resume library | Upload PDF/DOCX, versions, default, preview, delete | Done | [resume-library](features/resume-library.md) | `resumes.py`, `ats.install_document` |
| Resume editor | Structured editing, live Typst PDF preview, design controls, versions, compare | Done | [resume-editor](features/resume-editor.md) | `resume_*.py`, `resume_workflows.py`, `dashboard/js/resume-editor.js`, `typst` |
| Resume import | PDF/DOCX text → structured sections (local parser; optional Codex) | Done | [resume-editor](features/resume-editor.md#key-decisions) | `resume_import.py`, `pypdf` |
| Tailored resumes | Per-application copies of a master; pinned versions | Done | [resume-editor](features/resume-editor.md) | `resume_store.create_tailored`, `entries.resume_version_id` |
| AI suggestions | Targeted edits from analysis gaps; accept/reject/revert; fact guard | Done | [resume-editor](features/resume-editor.md) | `resume_store`, Codex CLI |
| ATS analysis | Evidence-based job match estimate via Codex, Python scoring, caching, queue | Done | [ats-analysis](features/ats-analysis.md) | `ats.py`, Codex CLI |
| AI email draft | Codex writes subject/body from the job + your profile | Done | [email-delivery](features/email-delivery.md) | `ai_draft.py` |
| Gmail drafts | OAuth, draft create/update with exact resume, "prepare schedule" | Done | [email-delivery](features/email-delivery.md) | `gmail.py` |
| Local 9 AM sender | Approve → SMTP send at 9:00 local time | Done (needs PC on) | [email-delivery](features/email-delivery.md) | `delivery.py` |
| Notion sync | Two-way field sync, stage options, trash reconciliation | Done | [notion-sync](features/notion-sync.md) | `notion.py` |
| Dashboard Content-Security-Policy | CSP header for the dashboard page | Deferred | [TECH_DEBT](TECH_DEBT.md) | — |
| Shared extension/dashboard code | Remove duplicated helpers between extension and dashboard | Deferred | [TECH_DEBT](TECH_DEBT.md) | — |
| OCR for scanned resumes | Read image-only PDFs | Deferred | [resume-editor](features/resume-editor.md) | — |
| Evidence bank, smart resume selection, DOCX export | Resume-editor follow-ups | Deferred | [resume-editor](features/resume-editor.md#not-done-yet-candidates-for-later) | — |
