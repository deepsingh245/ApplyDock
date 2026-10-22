# ApplyDock Slate — Implementation and Design Prompt

You are a senior product designer and frontend engineer redesigning an existing, functional developer-focused job application workspace called ApplyDock. Existing screenshots show the Application Workspace, Resume Library, Settings, and ATS Analysis. Use the four supplied UI reference PNGs as **visual direction**, not literal text/data fixtures.

## First: analyze and plan

Before editing code, inspect the repository, technology stack, routing, components, styles, and all functional workflows. Understand Notion synchronization, local helper and private resume storage, ATS analysis via Codex, Gmail drafts, scheduled delivery, and explicit application approval. Write `REDESIGN_PLAN.md` with a route/component map, UI problems, target information architecture, shared components, design tokens, data/action risk assessment, implementation phases, and QA criteria. **Present the plan first.** Do not rewrite backends, change persistence contracts, remove actions, introduce fake data, or silently alter approval/sending flows.

## Global design system — ApplyDock Slate

Product personality: quiet, deliberate, information-dense but readable, technically precise, zero decorative noise. Design for a keyboard-and-mouse power user who repeatedly handles applications. Inspired by the discipline of Linear/Raycast, but not a clone.

**Dark palette:** canvas `#10161C`, surface `#1A222A`, raised `#222D36`, border `#303C46`, primary text `#EEF2F5`, muted `#A0AFBA`, action blue `#88B9E0`.

**Light palette:** canvas `#F5F7F8`, surface `#FFFFFF`, raised `#EDF1F4`, border `#E3E8ED`, primary text `#1C2832`, muted `#637584`, action blue `#286C9B`.

Use semantically separate and accessible status colors; do not represent positive, warning, destructive and selected states with the same action hue. Validate computed WCAG contrast.

Typography: **Geist**, fallback to good system sans-serif, and **Geist Mono** only for dates/IDs/counts/technical metadata. Page titles 20–22px/600, section titles 15–16px/600, body 14px/400–500, secondary 12–13px with adequate contrast. Minimize uppercase captions and avoid enormous marketing headings, generic bold-everywhere styling, and monospace for prose.

Component rules: 4/8/12/16/24/32px spacing scale, 6px input corners, 8px panel corners, 36–40px desktop control heights and accessible 44px touch targets. Prefer simple dividers to nested borders. No neon effects, blurred glass, gratuitous gradients, glows, AI-themed decoration, redundant helper paragraphs, gigantic stacked forms, or pointless motion. Transition 120–180ms and honor reduced-motion settings. Centralize all theme tokens.

## Page 1 — Application Workspace

**Objective:** Work through jobs quickly while keeping all actions and details discoverable.

- App shell: compact 64px global toolbar, consistent section navigation and search; persistent selected navigation state.
- Left: compact 260–290px job list with count, search, filters (All / To Apply / Review / Applied / Scheduled), single selected state, role + company + one status line. No stacked cards.
- Center: selected job heading, company/location/route, stage badge, tabs (Overview / ATS Analysis / Email / Activity); grouped editable job details; readable truncated job description with expansion; clear assigned resume; visible save/unsaved/error state.
- Right: optional 260–290px contextual sidebar showing estimated match, genuine checklist/progress and one appropriate next action. Collapse this rail on narrower layouts.
- Group secondary actions into contextual menus, but preserve source links, Notion sync, drafts, local scheduling, approval, generated prompts, resume selection and deletion. Make email sending/approval explicitly gated. Autosave only where safe.

**Definition of done:** user can scan/select a job and understand the next action in seconds; long job text and email forms do not dominate the default screen.

## Page 2 — Resume Library

**Objective:** reuse and maintain 3–5 variants of a resume without permanent upload/edit forms consuming the screen.

- Header with title, compact storage explanation and one Upload Resume button.
- Compact accessible table or responsive list: Name, Category, File, Version, Last Updated, Linked Applications, Default, Actions, when data exists.
- Selected resume preview and a slim details panel; contextual menu includes Preview, Download, Rename/Edit, Replace, Set Default, Delete.
- Upload and edit use dialogs/drawers; validate formats/sizes and preserve local persistence, version history, previous associations, and download behavior.
- Do not lose linkages from saved applications when a resume is renamed/replaced/deleted.

**Definition of done:** at least 4 resume variants scan at a glance, and a user can switch default or assign an existing resume in very few steps.

## Page 3 — Settings

**Objective:** clear status and quick management; configuration fields appear only when needed.

- Sections: Connected Services (Notion, Gmail OAuth, Codex), Email Delivery (local SMTP, local 9 AM helper, Gmail scheduling), AI Writing Background, Preferences, Diagnostics.
- Connection rows have icon, service, descriptive line, precise connected/disconnected/error status, Configure/Details.
- Expand complex configuration in a drawer/section only on request. Mask tokens/app passwords and avoid logging secrets. Confirm before discarding edits.
- Distinguish local scheduled delivery requiring a running helper from Gmail-native remote scheduling.
- Theme chooser supports accessible dark/light themes; optional density controls only if easily supported.

**Definition of done:** everything important is discoverable, but the default view does not expose 15 empty configuration fields.

## Page 4 — ATS Analysis

**Objective:** turn long analysis output into an actionable decision surface.

- Heading: selected job, employer, analyzed timestamp, resume and exact version, Re-run Analysis and Analysis History.
- First view: prominent **estimated** match score, brief rationale, counts of Matched / Partial / Missing Evidence, 3–5 useful category indicators as data actually returned by the analysis. Don't invent metrics or claim official employer ATS scoring.
- Requirements explorer: collapsible rows, search, filters All / Missing / Partial / Matched, concise requirement description, clear verdict; expand to show JD evidence, resume evidence, explanation, and recommendation.
- Secondary right rail: prioritized truthful improvements and selected evidence. Link to original source where provided.
- Preserve current scoring algorithm, status semantics, evidence, historical records, caching and re-analysis; do not hallucinate experience/metrics/qualifications.

**Definition of done:** the first fold answers *What's my fit?*, *What exactly is missing?*, *Where's the evidence?*, and *What should I do next?*; no unstructured 10-screen requirement scroll.

## Cross-screen behavior and implementation

Build one shared shell, typography, colors, form components, button hierarchy, badges, tabs, tables, dialogs, notifications, focus styles, spacing and responsive rules. Use existing UI library where possible; don't arbitrarily reinstall frameworks. Preserve all data and network behavior. Inputs have labels and visible validation. Ensure sensible keyboard operation (`/` search and `Ctrl/Cmd+S` save only where no native shortcut is displaced). Handle tab changes, selected rows, URL navigation, pending saves, network errors, retries, loading, empty states and safe destructive confirmations. On mobile collapse multicolumn regions to one content pane/drawer, not microscopic 3-column layout.

**Validation:** run existing typechecks/lints/tests, manually test Notion sync, local resume management, Codex ATS requests, Gmail drafts, approval and scheduling (never send a real email as a test without consent). Capture actual implementations at 390, 768, 1024, 1440, 1728 pixels; compare before/after for hierarchy and content parity. Verify no horizontal overflow or lost actions, test both themes and focus states. Report modified files, verification results, and remaining limitations. **Do not report success until actual screenshots and interactions have been inspected.**
