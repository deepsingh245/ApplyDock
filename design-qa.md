# Sidebar design QA

**Source visual truth:** `../sidebar-design-concept.png` (1586 × 1000 px). The intended app-owned region is the right side panel, approximately 464 × 913 px within the full browser mockup.

**Implementation:** `extension/sidepanel.html`, `extension/sidepanel.css`, and `extension/sidepanel.js`. Intended Chrome side panel viewport: about 464 × 913 CSS px.

**State:** Connected local app, three captured items, first item expanded, settings hidden. The first item opens by default; clicking any row collapses or expands it. The review form is revealed by **Review application**.

**Rendered screenshot:** Unavailable. The Codex in-app browser could not connect to the local preview, and its URL policy blocked opening a local file. Chrome was not available as a connected browser surface. A screenshot, pixel density, and side-by-side image comparison could not be produced. No alternate browser execution was attempted after the policy block.

## Findings

- [P1] Visual and interaction QA is unverified. The source image was opened, but the implementation could not be rendered in an accessible browser surface. A real Chrome check is needed for spacing, scroll behavior, settings, capture, and toolbar toggling.

## Static review

- Typography: Arial fallback, 23 px heading, 15 px item title, and 12–13 px supporting text aim to match the reference hierarchy. Browser font rendering has not been compared.
- Spacing and layout: 24 px panel gutters, 8 px card gaps, compact rounded cards, and a separate settings screen match the intended structure in code. Viewport fit has not been observed.
- Color: warm off-white page, dark ink text, cobalt primary action, muted borders, and semantic status badges follow the selected mockup.
- Imagery/assets: the app-owned panel in the reference has no necessary raster imagery. The LinkedIn page at left belongs to Chrome's browsing content and is not reproduced by the extension.
- Copy/content: the capture action, count, expandable cards, status, and settings labels match the planned user journey. The full review form sits behind an additional **Review application** control to keep the first card compact.

**Comparison history:** No visual iteration was possible because implementation capture was blocked.

**Implementation checklist:** Reload the unpacked extension in Chrome; open an item on LinkedIn and a second hiring site; verify sidebar toggle, per-site permission prompt, capture preview, card expansion, review form, Settings navigation, night switch, and visual fit at the installed panel width.

## Current iteration

- Added a persistent Night switch in the header, dark surfaces and form controls, and an editable capture preview for multiple hiring sites.
- Added Gmail draft and schedule-preparation controls inside each email application's review form, plus a separate Gmail OAuth setup card in Settings.
- Static JavaScript syntax checks and Python tests pass. Browser rendering remains unverified because the available browser surface could not open the local extension preview during the prior visual QA attempt.

**Visual result: unverified in Chrome.**

## Web workspace update

- Replaced the older settings-first dashboard with a queue, full editor, action inspector, manual capture screen, and separate Settings screen. The layout rules and color roles are recorded in `DESIGN.md`.
- The extension now hides locally sent items and opens the web workspace from an icon button with an accessible name. The web queue also hides locally sent items.
- Python unit tests, JavaScript syntax checks, manifest parsing, and static dashboard ID checks passed.
- Browser screenshot verification remains unavailable here: the connected browser could not access the isolated localhost preview, and headless Chrome and Edge did not produce a screenshot. Check the layout and toolbar shortcut in your installed Chrome before treating the visual fit as verified.
