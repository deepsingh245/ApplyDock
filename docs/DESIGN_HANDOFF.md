# Design handoff

The starting point for the UI/UX redesign: what the UI is built from today, where to change it, and what to fix first. The 2026-10 architecture refactor deliberately changed **nothing visual**. Rendered DOM snapshots of all 11 main views were identical before and after.

## Stack

- **Plain HTML, CSS and JavaScript**, no framework and no build step. The dashboard is served by the helper from `dashboard/`.
- **No component library.** React libraries (shadcn/ui, Radix, Mantine, MUI) would need a framework migration. A framework-agnostic option that fits a no-build stack is **Web Awesome** (formerly Shoelace) web components, loaded from vendored local files and themed with CSS variables. Verify its license and version when adopting it.
- **Icons:** Unicode glyphs and a few inline SVGs; no icon set.
- **Fonts:** system stack (`Inter, "Segoe UI Variable", "Segoe UI", system-ui`). No web fonts are loaded, although the archived redesign brief mentions Geist.
- **Resume PDFs** are rendered by Typst (`applydock/resume_templates/`), separate from the web UI.

## Where styling lives

| Location | What |
|---|---|
| `dashboard/style.css` lines 1–450 | Original base styles and the first token set (`:root`, `:root[data-theme="dark"]`), including `--success`/`--warn`/`--danger` (+`-soft`) |
| `dashboard/style.css` from `/* ApplyDock workspace redesign */` (line ~452) | Current look: overrides the neutral and accent tokens, topbar, sidebar, workspace grid, cards, tabs, analysis views |
| `dashboard/style.css` from `/* Resume editor: … */` (line ~715) | Resume editor, design panel, application-editor tabs |
| `extension/sidepanel.css` | Extension side panel. Separate file with hard-coded colors and its own dark mode |
| `dashboard/js/settings.js` → `setTheme()` | Theme switch: `data-theme` on `<html>`, saved in `localStorage["applydock-theme"]`. No `prefers-color-scheme` auto-detection |

**Current tokens** (redesign layer):

| Token | Light | Dark |
|---|---|---|
| `--canvas` | `#f3f6f7` | `#0f181d` |
| `--surface` | `#fff` | `#18232a` |
| `--surface-soft` | `#f5f8fa` | `#1d2a31` |
| `--rail` | `#f1f5f7` | `#121d23` |
| `--inspector-surface` | `#fff` | `#172229` |
| `--ink` | `#1c2a34` | `#eef2f4` |
| `--muted` | `#607488` | `#a8b6c1` |
| `--subtle` | `#8294a2` | `#7f929e` |
| `--line` | `#d9e2e8` | `#304049` |
| `--accent` | `#2675a7` | `#87bce2` |
| `--accent-hover` | `#1e638f` | `#a7d0ec` |
| `--accent-soft` | `#dfedf7` | `#263f50` |
| `--shadow` | `0 2px 10px rgba(26,48,62,.035)` | `none` |

**Breakpoints:**

| Area | Widths |
|---|---|
| Workspace (redesign layer) | 1260, 960, 760 px |
| Legacy layer, still partly active | 1230, 800, 560 px |
| Resume editor | 1100, 860, 560 px |

## Layout and navigation

- **Shell:** `index.html` has a sticky 64px `.topbar` (brand, breadcrumb, global search, theme and refresh), a 226px `.global-sidebar`, and `.workspace-content`.
- **Views:** sections toggled by `showView(name)` in `dashboard/js/main.js`: `queue`, `create`, `resumes`, `analysis`, `settings`, `resume-editor`. There is no URL routing.
- **Applications (`#queue-view`):** a three-column grid of the queue rail, the editor (tabbed panes: Overview, Job details, Resume, Email; ATS Analysis opens the analysis view), and the inspector.
- **Secondary views:** `.secondary-view` with a maximum width of 1240px. The resume editor uses the full width.
- **Mobile (below 760px):** the sidebar becomes a bottom tab bar and the resume editor switches to Edit/Preview tabs.

## Reusable pieces today (CSS classes, not components)

| Kind | Classes |
|---|---|
| Buttons | `.button` + `.primary` / `.secondary` / `.quiet-button` / `.danger-button` (about 60 uses); `.icon-action`, `.back-button`, `.text-button`, `.re-icon` |
| Surfaces | `.view-card`, `.form-section`, `.card-heading`, `.re-section`, `.re-design-card` |
| Status | `.badge` (+ state modifiers), `.sub-status`, `.inline-alert`, `.match-status.<status>`, `.re-check.ok/.warn`, `.re-banner` |
| Tabs and segmented controls | `.editor-tabs` (application editor), `.re-side-tabs`, `.re-left-tabs`, `.re-segmented`, `.re-mobile-tabs`. **Five similar implementations; a prime candidate for one tabs component** |
| Forms | Global `input/select/textarea` rule, `.field-grid`, `.field-help`, `.check-line`, `.re-field`, `.re-slider` |
| Feedback | `#notice` toast (`notify()` in `core.js`), `.analysis-spinner`, progress tracks |

Rendering is done with template strings in each feature file. For example, `renderEditor`/`renderInspector` in `js/applications.js`, `renderAnalysis` in `js/analysis.js`, `renderResumeLibrary` in `js/resume-library.js`, and `render*` functions in `js/resume-editor.js`. Business logic stays on the server; the JS files call `api()` and render.

## Known UI architecture limitations

1. **Two CSS layers:** 67 selectors are defined twice, so it's hard to know which rule wins.
2. **No shared components:** the markup for buttons, cards and tabs is repeated in string templates.
3. **Small text:** much of it is 10–12px, which needs a contrast and legibility review.
4. **Extension:** it doesn't share the dashboard's tokens or styles.
5. **No `prefers-color-scheme` support,** and only button transitions honor `prefers-reduced-motion`.
6. **No Content-Security-Policy yet** (see [TECH_DEBT.md](TECH_DEBT.md)). Avoid inline `<script>` in the redesign.

## Priorities for the design phase

1. **Tokens:** one token file (color, type scale, spacing, radius, elevation) that replaces both CSS layers, applied to the dashboard and the extension.
2. **Component approach:** decide between a small in-repo set of render helpers and CSS classes, or Web Awesome. Start with tabs, buttons, cards, form fields and toasts.
3. **Applications editor and inspector density:** the most-used screen.
4. **Resume editor:** design panel ergonomics and the suggestion cards.
5. **Accessibility pass:** focus order, contrast, touch targets of 44px or more on mobile.

## Verifying a redesign

- `node tests/ui/run.mjs` runs both browser flows. They rely on element ids and `data-*` attributes (for example `data-editor-tab`, `data-re`, `data-side`, `data-left`, `data-layout`); keep them or update the flows.
- Screenshots are written to `tests/ui/output/`.
