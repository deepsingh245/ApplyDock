"""Run every ApplyDock check: lint, Python tests (incl. a real HTTP server smoke test), JS syntax, extension test.

Usage:  py -3 scripts/check.py          # fast checks (about a minute)
        py -3 scripts/check.py --ui     # also the browser flows (needs Chrome or Edge)
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


def main():
    results = []
    if shutil.which("ruff") or subprocess.run([sys.executable, "-m", "ruff", "--version"], capture_output=True).returncode == 0:
        results.append(step("ruff lint", [sys.executable, "-m", "ruff", "check", "."]))
    else:
        print("\n== ruff lint: skipped (py -3 -m pip install -r requirements-dev.txt)")
    results.append(step("python tests", [sys.executable, "-m", "unittest", "discover", "-s", "tests"]))
    node = shutil.which("node")
    if node:
        scripts = sorted((ROOT / "dashboard" / "js").glob("*.js")) + [ROOT / "extension" / "sidepanel.js", ROOT / "extension" / "background.js"]
        results.append(all(step(f"node --check {path.relative_to(ROOT)}", [node, "--check", str(path)]) for path in scripts))
        results.append(step("extension extraction test", [node, "tests/test_post_extraction.js"]))
        if "--ui" in sys.argv:
            results.append(step("browser flows", [node, "tests/ui/run.mjs"]))
    else:
        print("\n== JavaScript checks: skipped (Node.js not installed)")
    print("\nALL CHECKS PASSED" if all(results) else "\nSOME CHECKS FAILED")
    sys.exit(0 if all(results) else 1)


if __name__ == "__main__":
    main()
