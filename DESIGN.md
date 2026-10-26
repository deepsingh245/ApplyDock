# ApplyDock design system: "Ledger"

The rules the dashboard and the extension follow. A quiet, dense work tool: the content (jobs, scores, resumes) is the interface, and the chrome stays out of the way. Read this before changing anything visual.

- **Tokens:** `dashboard/tokens.css` (the single source)
- **Styles:** `dashboard/style.css` (one stylesheet, ordered base → primitives → shell → views → responsive)
- **Extension:** `extension/sidepanel.css` holds a copy of the color, radius and type tokens. Keep the two in sync; `tests/test_architecture.py` fails if the colors drift.

## Principles

1. **One accent, used sparingly.** Teal marks the primary action, the selection and links. Everything else is ink on warm neutrals.
2. **Borders, not shadows.** Panels are separated by 1px lines. The only shadow is `--shadow-pop`, for floating layers (menus, the toast).
3. **One primary action per context.** The inspector's "Next step" block promotes exactly one button; the rest are secondary or quiet.
4. **Data in mono.** Scores, dates, versions, counts, hashes and keyboard keys use IBM Plex Mono so figures line up and read as data.
5. **Status by word and color, never color alone.** Chips always carry a label.
6. **Nothing below 12px, nothing below AA contrast.** Both are measured (see Verification).

## Tokens

| Group | Tokens | Notes |
|---|---|---|
| Surfaces | `--canvas` < `--surface` < `--surface-2` < `--surface-3` | Canvas is the app background. Surface is used for panels and inputs. 2 and 3 are hover, fills and meter tracks |
| Lines | `--line`, `--line-strong` | `--line-strong` for control borders |
| Text | `--ink`, `--ink-2`, `--ink-3` | All three pass AA (≥4.5:1) on every surface in both themes |
| Accent | `--accent`, `--accent-hover`, `--accent-ink`, `--accent-soft` | `--accent-ink` is the text color on an accent fill |
| Status | `--success`, `--warn`, `--danger`, each with `-soft` | `-soft` is the chip/note background; the strong color is its text |
| Type | `--text-xs` 12 · `--text-sm` 13 (body) · `--text-md` 14 · `--text-lg` 16 · `--text-xl` 20 · `--text-2xl` 24 | Large score figures use 30px |
| Space | `--space-1` … `--space-12` | A 4px grid: 4, 8, 12, 16, 20, 24, 32, 48 |
| Shape | `--radius-sm` 4 (controls) · `--radius-md` 6 (panels) · `--radius-pill` (chips only) | |
| Motion | `--duration-fast` 120ms · `--duration` 160ms · `--ease` | Both become 0 under `prefers-reduced-motion` |
| Layout | `--topbar-h` 52 · `--list-w` 360 · `--context-w` 280 · `--control-h` 32 | `--list-w` is 280 at ≤ 960px; `--control-h` is 44 on phones |

**Fonts:** IBM Plex Sans (400/500/600) and IBM Plex Mono (400/500). They are self-hosted in `dashboard/fonts/` under the SIL Open Font License (`OFL.txt`), served with a one-year immutable cache, and need no network access. The extension uses the system font stack.

**Themes:** light and dark are set by `data-theme` on `<html>`. With no saved choice, the dashboard follows `prefers-color-scheme`. An explicit choice is stored in `localStorage["applydock-theme"]`.

## Components (CSS classes)

| Component | Classes | Rules |
|---|---|---|
| Button | `.button` + `.primary` / `.secondary` / `.quiet-button` / `.danger-button` | Height `--control-h`. One `.primary` per region |
| Icon button | `.icon-action` | Always has an `aria-label`. The icon is an inline Lucide SVG with `class="icon"` |
| Text link button | `.text-button`, `.back-button`, `.small-link` | At least 24px tall |
| Chip | `.badge`, `.mini-badge`, `.sub-status`, `.match-status`, `.kind-label` | Status modifiers map to the status tokens. `.stage` is outlined |
| Panel | `.view-card`, `.inspector-block`, `.email-preview`, `.re-section` | 1px `--line`, `--radius-md`, no shadow |
| Key/value list | `dl.kv` | Label left in `--ink-3`, value right |
| Score | `.score-figure` + `.score-meter` (`strong`/`medium`/`weak`/`neutral`) | The figure uses tabular numbers, out of "/ 100" |
| Progress strip | `ol.progress-strip > li.step.done/.current/.todo/.warn` | Shows the five application stages; scrolls horizontally when narrow |
| Tabs (navigation) | `.editor-tabs` with `role="tablist"` | Underline style. Arrow keys, Home and End move between tabs (`main.js`) |
| Segmented control | `.filter-row`, `.requirement-filters`, `.re-left-tabs`, `.re-side-tabs`, `.re-mobile-tabs`, `.re-segmented` | One look: a bordered group, with the active item in ink |
| Menu | `[popover].menu > .menu-item` | Native popover with CSS anchor positioning; Esc and outside click close it |
| Disclosure | `<details class="filter-menu">`, `details.requirement-card` | Native `<details>`, no JS |
| Note | `.inline-alert` (warn), `.workflow-note` / `.ai-notes` (accent) | 2px left rule on a soft fill |
| Coverage chip | `.coverage-chip.represented/.weak/.profile_only/.unsupported` | How a requirement is covered by resume and Master Profile; always labelled |
| Link check | `a.link-check.success/.warn/.danger` | Last on-demand result per project link; the title holds the detail and time |
| Profile card | `.pf-card`, `.pf-form` (fields from `PROFILE_FIELDS` in `profile.js`) | Settings → Master Profile; forms are generated, never hand-written per kind |
| Submission card | `#submission-card` with `dl.kv` | The exact submitted file per application, with View/Download/Compare/History |
| Toast | `#notice.notice` (`.error`) | Bottom-right (full width on phones), click to dismiss |

**Interface rules:**

- Escape every interpolated value with `esc()`.
- Keep element ids and `data-*` attributes stable, because the browser flows depend on them.
- Don't add a UI library without approval. Native `popover`, `<details>` and `<dialog>` come first.

## Layout and breakpoints

There is no sidebar. The top bar holds the brand (a button that returns to Applications), the current view name, the connection
state, refresh, theme and, last, the **Settings gear**. Applications is the home screen: a full-width three-pane workspace.
Resumes and Analysis are reached from an application (Resume tab → Manage resumes, inspector → View analysis) and from
Settings (Resume library). Every other page is full width with fluid side padding (`clamp(16px, 3vw, 48px)`); long prose
keeps a readable 72ch measure.

| Width | Behavior |
|---|---|
| > 1280px | Three panes: list (`--list-w`), editor, context (`--context-w`) |
| ≤ 1280px | The context pane moves under the editor as a grid of blocks |
| ≤ 1080px | Analysis and settings drop to one column |
| ≤ 960px | The list narrows to 280px; the context pane stays under the editor |
| ≤ 760px | Phone layout. List and detail are separate screens (`body.detail-open`, with a back button). 44px controls. One-column forms. The resume editor switches to Edit/Preview tabs |

## Accessibility

- **Focus:** `:focus-visible` draws a 2px accent outline everywhere; inputs show an accent border.
- **Keyboard:** Tab order follows the layout. `/` focuses application search. Arrow keys work in tab lists. Esc closes the menu.
- **Labels:** the connection state is a live region. On phones its label is visually hidden but still read.
- **Motion:** every animation and transition is disabled under `prefers-reduced-motion`.
- **Known exception:** checkboxes are drawn at 16px, but each one sits inside a clickable `<label>` that is the real target.

## Verification

- `py -3 scripts/check.py --ui` runs the lint, unit, smoke and browser flows.
- For visual changes, take screenshots at 375, 768 and 1440px in both themes, and measure contrast and font sizes. The October 2026 audit script, its results and the before/after numbers are summarized in [docs/DESIGN_HANDOFF.md](docs/DESIGN_HANDOFF.md).
