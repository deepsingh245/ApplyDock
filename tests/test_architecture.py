"""Guards for the module structure described in docs/ARCHITECTURE.md."""
import ast
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import unittest

from applydock import http_server

PACKAGE = Path(__file__).resolve().parents[1] / "applydock"

# Lower layers must not import higher ones (prevents the resume <-> application cycle from returning).
FORBIDDEN_IMPORTS = {
    "config": {"*"},
    "events": {"*"},
    "resume_model": {"*"} - {"resume_model"},
    "database": {"applications", "resumes", "notion", "gmail", "delivery", "http_server", "app", "resume_workflows"},
    "resumes": {"applications", "notion", "gmail", "delivery", "http_server", "app", "resume_workflows"},
    "applications": {"notion", "gmail", "delivery", "http_server", "app", "resume_workflows"},
    "notion": {"gmail", "delivery", "http_server", "app"},
    "gmail": {"notion", "delivery", "http_server", "app"},
}


def package_imports(path):
    tree = ast.parse(path.read_text(encoding="utf-8"))
    names = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom) and node.level == 1:
            names.update(alias.name for alias in node.names) if node.module is None else names.add(node.module)
    return names


class ArchitectureTests(unittest.TestCase):
    def test_importing_the_app_has_no_side_effects(self):
        with tempfile.TemporaryDirectory() as folder:
            data_dir = Path(folder) / "never-created"
            env = {**os.environ, "APPLYDOCK_DATA_DIR": str(data_dir)}
            code = "import server, applydock.app, applydock.http_server, applydock.delivery, applydock.gmail"
            subprocess.run([sys.executable, "-c", code], cwd=PACKAGE.parent, env=env, check=True, capture_output=True)
            self.assertFalse(data_dir.exists(), "importing must not create data, config, or a database")

    def test_layering_and_no_import_cycles(self):
        graph = {path.stem: package_imports(path) for path in PACKAGE.glob("*.py") if path.stem != "__init__"}
        for module, forbidden in FORBIDDEN_IMPORTS.items():
            imported = graph.get(module, set())
            if forbidden == {"*"}:
                self.assertEqual(imported, set(), f"{module} must not import other ApplyDock modules")
            else:
                self.assertFalse(imported & forbidden, f"{module} imports {imported & forbidden}")
        visiting, done = set(), set()

        def visit(node, trail):
            if node in visiting:
                self.fail("import cycle: " + " -> ".join(trail + [node]))
            if node in done or node not in graph:
                return
            visiting.add(node)
            for child in graph[node]:
                visit(child, trail + [node])
            visiting.discard(node)
            done.add(node)
        for module in graph:
            visit(module, [])

    def test_routes_are_unique_and_documented_methods(self):
        keys = [(method, pattern.pattern) for method, pattern, _ in http_server.ROUTES]
        self.assertEqual(len(keys), len(set(keys)))
        self.assertTrue({method for method, _ in keys} <= {"GET", "POST", "PATCH", "DELETE"})
        self.assertTrue(all(pattern.startswith("/api/") for _, pattern in keys))

    def test_extension_colors_match_dashboard_tokens(self):
        # The side panel cannot load the helper's tokens.css, so it keeps a copy; this catches drift.
        def colors(css):
            light, _, dark = css.partition(':root[data-theme="dark"]' if '[data-theme="dark"]' in css else ":root[data-theme=dark]")
            pick = lambda block: {name: value.upper() for name, value in re.findall(r"(--[a-z0-9-]+):\s*(#[0-9A-Fa-f]{3,6})", block)}
            return pick(light), pick(dark.split("}")[0])
        root = PACKAGE.parent
        dashboard = colors((root / "dashboard" / "tokens.css").read_text(encoding="utf-8"))
        extension = colors((root / "extension" / "sidepanel.css").read_text(encoding="utf-8"))
        for index, theme in enumerate(("light", "dark")):
            self.assertTrue(dashboard[index], theme)
            self.assertEqual(extension[index], dashboard[index], f"{theme} tokens differ between tokens.css and sidepanel.css")


if __name__ == "__main__":
    unittest.main()
