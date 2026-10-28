# ApplyDock web

The React workspace for ApplyDock. The Python helper (`applydock/`) is the only server: it serves the built app from `web/dist` and every `/api` route. Node is needed only to build and test.

## Commands

Run from `web/` (or use `npm --prefix web run …` from the repo root):

| Command | What it does |
|---|---|
| `npm ci` | Install the exact locked dependencies |
| `npm run dev` | Vite dev server on http://localhost:5173/. It proxies `/api` to the helper on 8765, so start `py -3 server.py` first and pair once |
| `npm run build` | Production build into `dist/`, which the helper serves at `/` (`start.cmd` runs it) |
| `npm run check` | Typecheck + lint + unit tests (Vitest) |
| `npm run e2e` | Playwright against a sandbox helper (`tests/ui/sandbox.py`: temp data, fake Codex). Needs a build and Chrome or Edge |

To test a build other than `dist/`, set `APPLYDOCK_WEB_DIST` for the E2E run, for example `npx vite build --outDir .builds/x` and then `$env:APPLYDOCK_WEB_DIST="<abs>/.builds/x"; npx playwright test e2e/x.spec.ts`.

## Stack

React 19 · TypeScript (strict) · Vite · Tailwind v4 · shadcn-style primitives on Radix (`radix-ui`) · TanStack Query · React Router 7 · React Hook Form + Zod · Zustand + Immer (resume editor) · dnd-kit · sonner · lucide-react · Vitest + Testing Library · Playwright.

## Layout

```
src/
  main.tsx              providers; imports bridge/extension first
  app/                  shell: router, AppShell (pairing gate), TopBar, ExtensionOpenHandler, KitPage (dev only, /kit)
  api/                  types.ts (helper payloads), state.ts (queryClient, keys, useAppState, useReloadState), <domain>.ts hooks
  bridge/extension.ts   applydock-paired / applydock-open listeners (registered before render)
  components/ui/        primitives: button, pill, card, field, dialog, confirm (useDialogs), menu, tabs, segmented, switch, note, toaster (notify), misc
  features/<feature>/   one folder per screen; it owns its components, hooks and tests
  lib/                  api client (the only code that knows the pairing key), format, domain rules, theme, cn
  styles/               tokens.css (Ledger colors; kept equal to extension/sidepanel.css by a Python test), globals.css (@theme)
e2e/                    Playwright specs; every spec calls setupSandbox() and uses the `app` fixture
```

## Conventions

- **Design tokens only.** Tailwind's default palette and type scale are removed. Use the token utilities:
  - colors: `bg-canvas|surface|surface-2|surface-3`, `border-line|line-strong`, `text-ink|ink-2|ink-3`, `accent*`, `success|warn|danger(-soft)`;
  - type: `text-xs` (12px, the minimum) to `text-2xl`;
  - spacing: the 4px grid (`p-4` = 16px);
  - radii: `rounded-sm|md|pill`.
  - Breakpoints: `md` 761px (≥ tablet), `lg` 961, `xl` 1281, `2xl` 1600.
  - For layout tokens, use `h-(--control-h)` and `w-(--list-w)`.
  - Raw colors and pixel font sizes are not allowed.
- **Compose primitives.** Build screens from `components/ui`, and don't restyle a primitive inline. If a pattern repeats in two features, promote it to `components/ui`.
- **Server state lives in TanStack Query**, with keys from `api/state.ts` (`keys`). After a mutation, call `useReloadState()` (or invalidate the matching keys). Don't copy server data into `useState`, except as form defaults.
- **Errors:**
  - Problems the user must act on go in a `notify(message, true)` toast.
  - Problems tied to a spot on screen go in a `<Note tone="danger">` there.
  - Never use `window.confirm` or `window.prompt`; use `useDialogs().confirm/prompt`.
- **Escaping.** React escapes text output, and `dangerouslySetInnerHTML` is banned by ESLint.
- **Privacy.** Never log resume text, tokens or the pairing key.
- **Accessibility:**
  - Every control has a label.
  - Icon-only buttons use `IconButton label=…`.
  - Lists that update use `aria-live="polite"`.
  - Respect keyboard order.
- **Test hooks.** Prefer roles and labels in tests. Add `data-testid` only where no accessible name fits. Keep these ids, which the extension and docs rely on: `#applications-button`, `#settings-button` and `#theme-button`.
- **Comments** explain *why*, not *what*.
