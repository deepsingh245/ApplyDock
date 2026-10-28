"""Run every ApplyDock check: lint, Python tests (incl. a real HTTP server smoke test), JS syntax, extension test,
and the web app (typecheck, lint, unit tests, production build).

Usage:  py -3 scripts/check.py          # fast checks (a few minutes)
        py -3 scripts/check.py --ui     # also the browser flows: Playwright for the web app (needs Chrome or Edge)
None of these touch your real data/ folder.
"""
from pathlib import Path
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]


def step(name, command):
    print(f"\n== {name}", flush=True)
    result = subprocess.run(command, cwd=ROOT)
    print(f"-- {name}: {'ok' if result.returncode == 0 else 'FAILED'}", flush=True)
    return result.returncode == 0


def web_checks():
    npm = shutil.which("npm")
    if not npm:
        print("\n== web app: skipped (npm not found)")
        return []
    if not (ROOT / "web" / "node_modules").is_dir():
        print("\n== web app: FAILED - dependencies missing. Run: npm --prefix web ci")
        return [False]
    web = ["--prefix", "web", "run"]
    results = [step("web typecheck + lint + unit tests", [npm, *web, "check"]), step("web production build", [npm, *web, "build"])]
    if "--ui" in sys.argv:
        # Includes the extension side panel (e2e/extension.spec.ts) and the design-rule pass (e2e/visual.spec.ts).
        results.append(step("browser flows (Playwright)", [npm, *web, "e2e"]))
    return results


def main():
    results = []
    if shutil.which("ruff") or subprocess.run([sys.executable, "-m", "ruff", "--version"], capture_output=True).returncode == 0:
        results.append(step("ruff lint", [sys.executable, "-m", "ruff", "check", "."]))
    else:
        print("\n== ruff lint: skipped (py -3 -m pip install -r requirements-dev.txt)")
    results.append(step("python tests", [sys.executable, "-m", "unittest", "discover", "-s", "tests"]))
    node = shutil.which("node")
    if node:
        scripts = [ROOT / "extension" / "sidepanel.js", ROOT / "extension" / "background.js"]
        results.append(all(step(f"node --check {path.relative_to(ROOT)}", [node, "--check", str(path)]) for path in scripts))
        results.append(step("extension extraction test", [node, "tests/test_post_extraction.js"]))
        results.extend(web_checks())
    else:
        print("\n== JavaScript checks: skipped (Node.js not installed)")
    print("\nALL CHECKS PASSED" if all(results) else "\nSOME CHECKS FAILED")
    sys.exit(0 if all(results) else 1)


if __name__ == "__main__":
    main()
