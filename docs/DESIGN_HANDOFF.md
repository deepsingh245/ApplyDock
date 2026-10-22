# Design handoff

This note covers the state of the UI after the October 2026 "Ledger" redesign: what changed, what was measured, and what is left. For the rules and tokens themselves, see [DESIGN.md](../DESIGN.md).

## What changed

| Area | Before | After |
|---|---|---|
| Styles | Two overlapping CSS layers (67 selectors defined twice), with a legacy and a redesign token set | One `tokens.css` and one ordered `style.css` |
| Type | System font. 23 distinct sizes from 8 to 44px; about 45% of visible text under 12px | Self-hosted IBM Plex Sans/Mono. Six sizes (12–30px), none under 12px |
| Color | Blue accent; `--subtle`/`--muted` failed AA in light mode (532 failing text nodes across the audit) | Teal accent and warm neutrals; every text token passes AA in both themes (0 failures) |
| Shape | 13 radius values and soft shadows | Radii 4/6/pill; borders instead of shadows |
| Topbar | Breadcrumb, global search (a duplicate of the list search), hard-coded avatar and name | Brand, current view, connection state, refresh, theme |
| Applications list | Avatar, analysis chip and meta text | Title, monospace score, company · platform, status chips |
| Editor header | Title and badges; delete inside the inspector | Title, kind, stage and status. Delete moved to a "More" menu. A five-step progress strip (Captured → Analyzed → Resume → Email → Applied) |
| Inspector | A long list of equal-weight buttons | Score figure and meter. "Next step" with one primary action. A key/value status list. Email preview |
| Settings | Duplicate "system status" card | Connection rows in one column; a "Maintenance" card for checks and Notion resync |
| Phones | List and editor stacked; glyph-only bottom nav; clipped tabs | Separate list and detail screens, labelled bottom nav, 44px controls |
| Theme | Manual only | Follows `prefers-color-scheme` until the user picks one |
| Extension | Its own blue palette and hard-coded dark mode | The same tokens (copied), system font |

**No behavior changed:**
- All element ids and `data-*` attributes used by the JS and the browser flows were kept.
- The API is unchanged.
- The only server change is that `/fonts/*.woff2` is served as `font/woff2` with an immutable cache. A smoke test checks this.

## Measured results (sandbox data, 46 screenshots: 375/768/1440px × light/dark × every view)

| Metric | Before | After |
|---|---|---|
| Text nodes under 12px | 1636 of 3616 | 0 of 3096 |
| Distinct font sizes | 23 | 6 |
| Text below WCAG AA contrast | 532 | 0 |
| Interactive targets under 24px | 109 | 16px checkboxes inside clickable labels, plus inline links |
| Horizontal overflow at 375px | none | none |
| Console errors | 0 | 0 |

**Keyboard and motion checks:**
- `:focus-visible` outline on every tab stop.
- Arrow-key tab switching.
- `/` focuses search.
- Esc closes the menu.
- Reduced motion sets all transitions to 0s.

## Remaining issues

1. **Content-Security-Policy** is still deferred ([TECH_DEBT.md](TECH_DEBT.md) item 1). The redesign added no inline scripts.
2. **The analysis view** keeps its own internal layout (hero, breakdown, requirements). It is restyled on the tokens but not re-structured.
3. **The resume editor toolbar** wraps onto two rows on phones. It works, but could become an overflow menu.
4. **The progress strip** scrolls horizontally in narrow detail panes (768px) instead of compressing.
5. **The extension** copies the color tokens by hand. `test_architecture.py` fails if they drift, so change both files together.
6. **Checkboxes** are visually 16px. They pass because their labels are the targets, but a larger custom checkbox would be clearer on touch screens.

## Verifying a change

- `py -3 scripts/check.py --ui` runs both browser flows; they rely on ids and `data-*` attributes (`data-editor-tab`, `data-re`, `data-side`, `data-left`, `data-layout`, `data-entry-resume`, `data-mobile-back`).
- Screenshots are written to `tests/ui/output/`.
- When you change a color, recheck contrast for `--ink-3` on `--surface-2` in both themes. That pairing has the least headroom.
