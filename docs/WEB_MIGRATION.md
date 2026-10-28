# Dashboard → React migration

The classic dashboard (`dashboard/`, plain JS) has been replaced by the React app in `web/`, which the helper serves at `/` since 2026-10-28. During the port the React app ran at `/app/`, and those URLs now redirect. This file records parity, screen by screen. A row is **Done** when the behavior is ported *and* covered by a Playwright spec in `web/e2e/`.

| Area | Parity items | E2E spec | Status |
|---|---|---|---|
| Shell | Pairing (session → local key), helper status, refresh (Notion sync), theme follows the system until chosen, gear last, brand goes home, not-found page | `shell.spec.ts` | Done |
| Extension bridge | `applydock-paired` / `applydock-open` handled before and after render; deep links: profile, analysis, optimize, submission | `shell.spec.ts`, `applications.spec.ts`, `settings.spec.ts` | Done |
| Applications | Six filters (Rejected hidden elsewhere), search with the `/` shortcut, analysis/score/sort, default selection by "needs action", "No active applications" empty state, editor tabs (required field brings its tab forward), progress strip, alerts, email panel, unsaved-changes guard, Ctrl+S, inspector next steps, Gmail/approve/AI draft/copy prompt/delete, submission record and history, phone layout | `applications.spec.ts` | Done |
| Add a job | Validation, kind-dependent labels, email toggle, default resume | `applications.spec.ts` | Done |
| Analysis | Queue, running state with log polling, hero, coverage, potential score, delta, categories, explorer (filters, search, evidence, profile evidence), checklist, Addressed + Reopen, priority improvements, history, versions, profile-changed note | `analysis.spec.ts` | Done |
| Resume library | Upload, table (masters then tailored), preview, rename/category/replace/default/delete, editor link, usage list | `resume-library.spec.ts` | Done |
| Settings | Connections cards with status and Configure, Codex check, Notion, SMTP, Gmail OAuth, AI writing background, appearance, default resume, notifications, maintenance, resume library link | `settings.spec.ts` | Done |
| Master Profile | Five sections, schema-driven forms, claims, verify links, functional test, import, archive/restore, 409 reload, `?item=` deep link | `profile.spec.ts` | Done |
| Resume editor | Undo/redo, autosave and conflicts, preview and page count, content and Add-a-section, design (sliders, presets, fonts, Fit, drag-and-drop order), versions, compare, Job match (Check score incl. re-check all, suggestions, analyses, full-analysis dialog), From profile | `resume-editor.spec.ts` | Done |
| Design rules | Every screen at 375/768/1440/1920 in light and dark: no horizontal scroll, no text under 12px, axe WCAG A/AA | `visual.spec.ts` | Done |

## Deliberate differences

- Every screen has a real URL (`/applications/:id`, `/analysis/:id`, `/resumes/:id/edit`, `/settings/profile/projects`, …), so reload and the browser's back button work.
- Browser `confirm()`/`prompt()` are replaced by accessible in-app dialogs.
- The full analysis over the resume editor is a real modal component; the old code moved DOM nodes between containers.
- The served page has a Content-Security-Policy (`script-src 'self'`), closing TECH_DEBT #1.
- Opening a history or queue row *inside* the analysis dialog swaps the run shown in place, so you stay over the editor.
