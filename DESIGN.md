# ApplyDock design system: "Ledger"

The rules the web app and the extension follow. ApplyDock is a quiet, dense work tool: the content (jobs, scores, resumes) is the interface, and the chrome stays out of the way. Read this before changing anything visual.

**Where things live:**
- **Tokens:** `web/src/styles/tokens.css` holds colors, shadow, motion and layout. The type, radius, spacing and breakpoint scales are in the `@theme` block of `web/src/styles/globals.css`, which Tailwind turns into utilities.
- **Components:** `web/src/components/ui/`, shadcn-style primitives on Radix, restyled to Ledger. Screens compose these and never restyle them inline.
- **Extension:** `extension/sidepanel.css` holds a copy of the color, radius and type tokens. `tests/test_architecture.py` fails if the colors drift between the copies.
- **Gallery:** `npm --prefix web run dev`, then open `/kit` (dev builds only). It shows every primitive in the current theme.

## Principles

1. **One accent, used sparingly.** Teal marks the primary action, the selection and links. Everything else is ink on warm neutrals.
2. **Borders, not shadows.** Panels are separated by 1px lines. The only shadow is `shadow-popover`, for floating layers: menus, dialogs and toasts.
3. **One primary action per context.** The inspector's "Next step" block promotes exactly one button; the rest are secondary or quiet.
4. **Data in mono.** Scores, dates, versions, counts, hashes and keyboard keys use IBM Plex Mono (the `tabular` utility), so figures line up and read as data.
5. **Status by word and color, never color alone.** Pills always carry a label.
6. **Nothing below 12px, nothing below AA contrast.** Both are enforced by `web/e2e/visual.spec.ts` (see Verification).

## Tokens → Tailwind

Tailwind's default palette, font sizes, radii, shadows and breakpoints are removed (`--color-*: initial` …), so only these exist:

| Group | Utilities | Notes |
|---|---|---|
| Surfaces | `bg-canvas` < `bg-surface` < `bg-surface-2` < `bg-surface-3` | Canvas is the app background, surface is panels and inputs, 2 and 3 are hover, fills and meter tracks |
| Lines | `border-line`, `border-line-strong` | `line-strong` for control borders |
| Text | `text-ink`, `text-ink-2`, `text-ink-3` | All three pass AA (≥4.5:1) on every surface in both themes |
| Accent | `bg-accent`, `hover:bg-accent-hover`, `text-accent-ink`, `bg-accent-soft` | `accent-ink` is the text color on an accent fill |
| Status | `text-success/warn/danger`, `bg-*-soft` | `-soft` is the pill or note background; the strong color is its text |
| Type | `text-xs` 12 · `text-sm` 13 (body) · `text-md` 14 · `text-lg` 16 · `text-xl` 20 · `text-2xl` 24 | `text-xs` is the minimum |
| Space | `p-1` = 4px … `p-12` = 48px | A 4px grid |
| Shape | `rounded-sm` 4 (controls) · `rounded-md` 6 (panels) · `rounded-pill` (pills only) | |
| Motion | `transition-ledger` (uses `--duration`, `--ease`) | Zeroed under `prefers-reduced-motion` |
| Layout | `h-(--control-h)` 32 · `w-(--list-w)` 360 · `w-(--context-w)` 280 · `h-(--topbar-h)` 52 | Read the CSS variables directly |
| Breakpoints | `md` ≥ 761 · `lg` ≥ 961 · `xl` ≥ 1281 · `2xl` ≥ 1600 | Below `md` is the phone layout |

Colors are declared with `@theme inline`, so every utility resolves through the token at use time. Switching `data-theme` re-colors the whole app without `dark:` prefixes.

**Fonts:** IBM Plex Sans (400/500/600) and Plex Mono (400/500). They are self-hosted in `web/src/assets/fonts/` under the SIL Open Font License, bundled with hashed names and an immutable cache, and need no network access.

**Themes:** set by `data-theme` on `<html>`. With no saved choice the app follows `prefers-color-scheme`, live. An explicit choice is stored in `localStorage["applydock-theme"]`.

## Components

| Component | Import | Rules |
|---|---|---|
| Button | `Button` (`variant` primary · secondary · quiet · danger · text; `size` md · sm · icon) | One `primary` per region. `asChild` renders a link styled as a button |
| Icon button | `IconButton label=…` | The label becomes `aria-label` and the tooltip. Icons come from `lucide-react` |
| Pill | `Pill tone=…`, `toneFor(statusKey)` | One tone map for every status, match and coverage key, so a value always has the same color |
| Card | `Card`, `CardHeader title aside description` | 1px `line`, `rounded-md`, no shadow |
| Fields | `Field label help error`, `Input`, `Textarea`, `Select` (native), `Checkbox`, `CheckLine`, `FieldGrid` | The label wraps the control. Help text is linked with `aria-describedby`. Errors are announced |
| Tabs | `Tabs` + `TabsList variant="underline"` (page sections) or `"segmented"` (panel switchers) | Radix: arrow keys, Home/End. The selected content must be a `TabsContent`, so `aria-controls` resolves |
| Segmented | `Segmented` | Single-choice filter rows (Radix ToggleGroup) |
| Menu | `Menu`, `MenuTrigger`, `MenuContent`, `MenuItem danger` | Radix dropdown menu |
| Dialog | `Dialog`, `DialogContent title size="sm, md or full"` | The full analysis over the resume editor uses `full` |
| Confirm / prompt | `useDialogs().confirm(…)`, `.prompt(…)` | Replace `window.confirm` and `window.prompt`, which are not used anywhere |
| Note | `Note tone=info, warn, danger, success or neutral` | Inline guidance next to what it is about: a 3px left rule on a soft fill |
| Toast | `notify(message, isError?)` | Bottom right. Errors stay longer |
| Data | `ScoreFigure`, `Meter`, `KeyValue`, `Count`, `Eyebrow`, `Spinner`, `EmptyState` | Scores use tabular figures, out of "/ 100" |
| Page | `Page`, `PageHeading`, `BackButton` | Full width with fluid side padding `clamp(16px, 3vw, 48px)`. Prose stops at 72ch |

**Interface rules:**
- React escapes output, and `dangerouslySetInnerHTML` is a lint error.
- Prefer roles and labels in tests. Keep the ids the extension, docs and tests rely on: `#applications-button`, `#settings-button` and `#theme-button`.
- If a pattern appears in two features, promote it to `components/ui` rather than copying it.

## Layout and breakpoints

There is no sidebar. The top bar holds:
- the brand, which returns to Applications;
- the current view name and the connection state;
- refresh and theme;
- last, the **Settings gear**.

Applications is the home screen, a full-width three-pane workspace. Every screen has a URL, so reload and back work:
- `/applications/:id`
- `/analysis/:id`
- `/resumes/:id`
- `/resumes/:id/edit`
- `/settings/:tab`

On load, Applications opens the first application that still needs action (not applied, sent, submitted or rejected). When there is none, the middle pane shows **No active applications** with *Add a job* and *View applied*. In the resume editor, wider than 760px, the page does not scroll; the form and the side panel each scroll on their own.

| Width | Behavior |
|---|---|
| ≥ 1281px (`xl`) | Three panes: list (`--list-w`), editor, inspector (`--context-w`), each scrolling on its own |
| 761–1280px | List + editor; the inspector moves under the editor |
| ≤ 760px | Phone layout. The list and one application are separate screens (`/` and `/applications/:id`, with a back button). One-column forms |

## Accessibility

- **Focus:** `:focus-visible` draws a 2px accent ring everywhere.
- **Keyboard:**
  - Tab order follows the layout.
  - `/` focuses application search, and Ctrl+S saves.
  - Arrow keys move within tabs, menus and segmented controls.
  - Esc closes dialogs and menus.
- **Live regions:** the connection state and the lists that update are announced.
- **Motion:** every animation and transition is disabled under `prefers-reduced-motion`.

## Verification

- `py -3 scripts/check.py --ui` runs everything, including `npm --prefix web run e2e`.
- `web/e2e/visual.spec.ts` opens every screen at 375, 768, 1440 and 1920px in both themes. It fails on horizontal scroll, text under 12px, or any axe WCAG 2 A/AA violation, and saves screenshots to `web/test-results/visual/`.
