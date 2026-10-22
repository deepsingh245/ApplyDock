# Technical debt and deferred work

Known items, highest priority first. Remove an entry when it is done.

## 1. Content-Security-Policy for the dashboard — deferred (security)

**Status:** deliberately postponed (decision 2026-10-23). The dashboard page (`/`) is sent without a CSP. Only the Gmail OAuth result page and the DOCX preview set one.

**Why it matters:** defence in depth against injected script. Every dynamic value is already escaped with `esc()` (`dashboard/js/core.js`), and the server only binds to `127.0.0.1`, so this is a hardening step, not a known hole.

**Proposed policy** (in `http_server.serve_public_get` for the HTML response):

```text
default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:;
frame-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'
```

**Watch out for:**
- **Inline styles:** progress bars and score tracks use `style="width:…"` in rendered HTML, so `style-src` needs `'unsafe-inline'` unless those move to classes or CSS variables.
- **PDF previews:** the resume editor shows the generated PDF and the original upload in `blob:` iframes, so `frame-src` needs `blob:`.
- **Testing:** run `node tests/ui/run.mjs` afterwards; it exercises the preview, compare and download flows.

## 2. OAuth client-secret file in the repository folder — user action

`client_secret_*.json` sits in the repo root. It is git-ignored and not tracked, and the app already stores the client in `data/config.json`. Move or delete the file so a `git add -f` can't publish it.

## 3. Two stacked CSS layers — design phase

`dashboard/style.css` is the original stylesheet (lines 1–450) plus a redesign layer (from `/* ApplyDock workspace redesign */`) that overrides it, with 67 selectors defined twice. Consolidating them changes the cascade, so it belongs in the UI redesign. See [DESIGN_HANDOFF.md](DESIGN_HANDOFF.md).

## 4. Extension duplicates dashboard code

`extension/sidepanel.js` re-implements about 15 helpers that also exist in `dashboard/js/core.js` (`api`, `resumeOptions`, stage helpers, formatters). An MV3 extension can only load its own packaged files, so sharing them needs a copy step or a build step. Its CSS (`sidepanel.css`) has hard-coded colors instead of the dashboard tokens.

## 5. Dashboard scripts share globals instead of ES modules

The 2026-10 refactor split `app.js` into feature files as classic `defer` scripts that share top-level `let` and `function` declarations. That changed no behavior, but the dependencies are implicit (documented in each file header). Converting to `type="module"` with explicit imports needs shared state such as `state`, `selectedId` and `dirty` to move into an exported object.

## 6. Large single files that are still cohesive

`applydock/ats.py` (about 900 lines) and `dashboard/js/resume-editor.js` (about 1,000 lines, with clear section headers) are each one feature. Split them along their existing sections when they next change significantly: Codex runner versus analysis queue; editor core, design panel and suggestions.

## 7. Tooling gaps

- **Formatting:** `ruff format` isn't enforced. It would rewrite nearly every line, so do it as a separate commit.
- **Type hints:** sparse in the older modules; add them where code is touched.
- **CI:** none. `py -3 scripts/check.py` is the single local gate.

## 8. HTML built from strings

Views render with template strings and `innerHTML`. That's fine at this size, but there is no component abstraction, so repeated markup (buttons, cards, badges) is duplicated across feature files. This is a design-phase decision.
