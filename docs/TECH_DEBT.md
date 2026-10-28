# Technical debt and deferred work

Known items, highest priority first. Remove an entry when it is done.

## 1. ~~Content-Security-Policy for the dashboard~~: resolved 2026-10-28

The React web app is served with a CSP (`http_server.web_csp`):

```text
default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self';
connect-src 'self'; frame-src 'self' blob: <helper origins>; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'
```

`test_http_smoke.py` checks the header, and every Playwright flow fails on a console error, which includes CSP violations.

`style-src` keeps `'unsafe-inline'` because React sets a few computed widths (meters) and Radix positions popovers with inline styles.

## 2. OAuth client-secret file in the repository folder: user action

`client_secret_*.json` sits in the repo root. It is git-ignored and not tracked, and the app already stores the client in `data/config.json`. Move or delete the file so a `git add -f` can't publish it.

## 3. Retire the classic dashboard files

Since 2026-10-28 the helper no longer serves `dashboard/`, and its CDP browser flows (`tests/ui/cdp.mjs`, `run.mjs`, `flow-*.mjs`) have been replaced by `web/e2e/`. Nothing runs either of them any more.

The files are kept only until the user confirms they can go. Some of them had uncommitted edits when the switch happened. `tests/ui/sandbox.py` stays: Playwright uses it.

## 4a. Master Profile follow-ups

These were deliberately left out of the first version (see [features/master-profile.md](features/master-profile.md#not-done-yet)):
- recurring link monitoring;
- confirming Gmail sends, which needs the `gmail.readonly` scope;
- profile suggestions that add a whole new job entry.

The local resume reader can import a technology line as a project; Codex import avoids that.

## 4. Extension duplicates web-app code

`extension/sidepanel.js` re-implements about 15 helpers that the web app also has in `web/src/lib/`: the API client, resume choices, stage helpers and formatters. An MV3 extension can only load its own packaged files.

With Vite already in the repo, the clean fix is a second build entry that bundles the side panel from shared TypeScript modules. `extension/sidepanel.css` keeps a copy of the color tokens, and `test_architecture.py` fails if they drift from `web/src/styles/tokens.css`.

## 6. Large single files that are still cohesive

`applydock/ats.py` is about 900 lines but is one feature. Split it along its existing sections (Codex runner versus analysis queue) when it next changes significantly.

## 7. Tooling gaps

- **Python formatting:** `ruff format` isn't enforced. It would rewrite nearly every line, so do it as a separate commit. The web app is formatted by Prettier (`npm --prefix web run format`).
- **Type hints:** sparse in the older Python modules. Add them where code is touched. The web app is strict TypeScript.
- **CI:** none. `py -3 scripts/check.py --ui` is the single local gate.
