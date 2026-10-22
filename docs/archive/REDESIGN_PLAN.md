# ApplyDock Slate Redesign Plan

## Scope and constraints

ApplyDock remains a local first Chrome MV3 extension plus a Python helper, SQLite storage, Notion synchronization, Gmail draft support, local SMTP scheduling, reusable resume files, and Codex powered ATS analysis. The redesign changes the dashboard presentation and interaction structure only. Existing API routes, persistence contracts, stage semantics, approval gates, explicit email confirmation, resume associations, analysis scoring, and one way Notion deletion behavior remain intact.

No framework migration, backend rewrite, fake application data, automatic email approval, or automatic ATS invocation is part of this work.

## Current route and component map

The helper serves one vanilla HTML dashboard at `/` from `dashboard/index.html`. Client side view state in `dashboard/app.js` switches between these screens without changing the URL:

| View | Existing source | Primary workflows |
| --- | --- | --- |
| Applications | `#queue-view` | Select, filter, edit and save an application; change stage; manage email details; open source and Notion; run ATS analysis; approve or prepare delivery; remove locally. |
| Manual capture | `#create-view` | Add one selected job or hiring post, contact data, application route and assigned resume. |
| Resume Library | `#resumes-view` | Upload, preview, download, rename, categorize, replace, set default and delete local resumes. |
| ATS Analysis | `#analysis-view` | Queue and monitor analysis, view transparent scores and evidence, update recommendation checklist, inspect history and resume versions. |
| Settings | `#settings-view` | Configure Notion, SMTP, Gmail OAuth, Codex and factual writing background. |

Shared data is loaded from `/api/state`. Mutations continue through the existing capture, entry, resume, settings, sync and analysis endpoints in `server.py` and `ats.py`.

## Current UI problems

- Navigation changes location between screens and makes the product feel like separate utilities.
- The original application list, editor and inspector use similar surface colors, weakening hierarchy.
- Application forms and email fields occupy too much of the first screen.
- Resume upload and edit forms compete with the library content.
- Settings exposes detailed configuration fields before the user asks to edit a service.
- ATS results are complete but long; priorities and requirement states are difficult to scan.
- Typography, control density, radii and spacing vary between older and newer features.
- Narrow screens need one content pane instead of compressed multicolumn regions.

## Target information architecture

### Shared shell

- A 64px toolbar with brand, breadcrumb, global search, local helper status, refresh, theme control and workspace avatar.
- A persistent global sidebar for Applications, Resume Library, ATS Analysis and Settings.
- `/` focuses global search; `Ctrl/Cmd+S` keeps its existing application save behavior.
- Light and dark themes use one centralized token set.

### Applications

- Compact 260 to 290px application rail with count, search, All, To Apply, Review, Applied and Scheduled filters.
- Center pane with application heading, stage, Overview, ATS Analysis, Email and Activity tabs.
- Overview groups job details, keeps source/apply links available, limits long text by default and shows the assigned resume.
- Context rail contains estimated match, readiness checklist, recent state and the next appropriate action.
- Email composition stays collapsed until requested. Delivery, approval and destructive actions retain their current gates and confirmations.

### Resume Library

- Header with storage explanation and one Upload Resume action.
- Dense table showing file identity, category, version, date, usage and default state.
- One selected preview and slim details panel.
- Upload and edit controls open only on request. Existing versioning, file availability checks and application relationships remain authoritative.

### Settings

- Default screen is a status dashboard: Connected Services, Email Delivery, AI Writing Background, Preferences and Diagnostics.
- Configuration forms are collapsed until Configure or Edit is selected.
- Local 9 AM delivery is labeled as dependent on the running helper; Gmail scheduling is labeled as Gmail managed.
- Secret values remain masked and are never echoed into the page or logs.

### ATS Analysis

- First fold shows the estimated score, rationale, matched/partial/missing counts and returned category scores.
- Requirements become searchable, filterable expandable rows.
- The right rail contains truthful priority improvements and the evidence for the selected requirement.
- Queue progress, detailed activity log, analysis history, exact resume version, caching and rerun behavior remain available.

## Shared components and design tokens

- `AppShell`: toolbar, breadcrumb, global search, global sidebar and responsive navigation.
- `ApplicationRail`: filters, compact rows and selected state.
- `Panel`, `SectionHeader`, `StatusBadge`, `Button`, `Tabs`, `Field`, `DataTable`, `EmptyState`, `Notice` and confirmation patterns.
- `ResumeTable`, `ResumePreview`, `ServiceRow`, `SystemStatus`, `ScoreRing`, `ScoreBar`, `RequirementRow`, `EvidencePanel` and `ActivityConsole` reuse the same tokens.
- Spacing: 4, 8, 12, 16, 24 and 32px.
- Radius: 6px inputs, 8px panels, fully rounded status dots only.
- Controls: 36 to 40px desktop; responsive controls reach 44px where touch use is likely.
- Typography: Geist when locally available, followed by Segoe UI Variable and system sans serif. Geist Mono or system monospace is limited to IDs, times, counts and analysis logs.
- Light: canvas `#F5F7F8`, surface `#FFFFFF`, raised `#EDF1F4`, border `#E3E8ED`, ink `#1C2832`, muted `#637584`, action `#286C9B`.
- Dark: canvas `#10161C`, surface `#1A222A`, raised `#222D36`, border `#303C46`, ink `#EEF2F5`, muted `#A0AFBA`, action `#88B9E0`.
- Success, warning and destructive states keep separate green, amber and red roles.

## Data and action risk assessment

| Area | Risk | Required protection |
| --- | --- | --- |
| Application save | Unsaved edits or altered stage semantics | Preserve dirty state, discard confirmation, current stage options and Notion update path. |
| Email delivery | Accidental sending or approval | Keep explicit user actions, resume/recipient validation and confirmation gates. Never send during UI verification. |
| Resume replacement/deletion | Broken assignments or lost versions | Reuse existing APIs and warning text; never directly manipulate files from the dashboard. |
| Notion synchronization | Accidental remote deletion or field drift | Keep one way deletion reconciliation and existing field mapping. UI refresh uses `/api/sync` only. |
| ATS analysis | Invented evidence or unplanned plan usage | Keep manual Run Analysis action, existing scoring and validation, queue/caching, exact resume version and plan limit handling. |
| Credentials | Secret exposure | Leave password/token fields blank after save and retain secure placeholders/status only. |

## Implementation phases

1. Build shared shell, navigation, theme tokens, global search and responsive structure.
2. Restructure Applications into a compact rail, focused editor and contextual readiness panel.
3. Replace permanent Resume Library forms with a table, selected preview/details and on demand upload/edit controls.
4. Convert Settings into status rows with expandable configuration and diagnostics.
5. Convert ATS requirements into filters and expandable evidence rows with priority/evidence side rail.
6. Refine empty, loading, failure, dirty, saved and narrow screen states.
7. Update README and capture final visual evidence.

## QA criteria

- Existing data is rendered; no fixture records are introduced.
- Every existing mutation and external link remains reachable.
- No email is sent or scheduled during verification.
- Both themes preserve readable hierarchy and distinct semantic states.
- Keyboard focus is visible; `/` search and `Ctrl/Cmd+S` behave as documented.
- No persistent control is hidden by horizontal overflow at 390, 768, 1024, 1440 or 1728px.
- Application, resume, settings and ATS loading, empty, error and completed states remain understandable.
- Source screenshots and implementation captures are compared at matching viewport/state before the redesign is reported complete.
- Existing automated tests are not run unless the user explicitly requests them. Static syntax and whitespace checks may be used during implementation.
