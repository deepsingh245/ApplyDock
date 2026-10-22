"""Start the real HTTP server on a random port with temporary data and exercise it over HTTP.

This is the "is the app actually running?" check: static dashboard files, authentication,
and the main API flows, end to end through sockets rather than function calls.
"""
import base64
import json
from pathlib import Path
import re
import threading
import unittest
import urllib.error
import urllib.request
from unittest.mock import patch

from support import isolate_app
from applydock import app, config, resume_model, resume_render

try:
    import typst  # noqa: F401
    HAVE_TYPST = True
except ImportError:
    HAVE_TYPST = False

FIXTURE = Path(__file__).resolve().parent / "fixtures" / "sample_resume.json"


class HttpSmokeTests(unittest.TestCase):
    def setUp(self):
        isolate_app(self, {"pairing_key": "smoke-key", "notion_data_source_id": "", "smtp": {}})
        self.server = app.create_server(port=0)
        port = self.server.server_address[1]
        patcher = patch.object(config, "PORT", port)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.base = f"http://127.0.0.1:{port}"
        thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)

    def request(self, path, method="GET", data=None, key="smoke-key", headers=None):
        body = None if data is None else json.dumps(data).encode()
        request = urllib.request.Request(self.base + path, data=body, method=method)
        if key:
            request.add_header("X-Local-Key", key)
        if body is not None:
            request.add_header("Content-Type", "application/json")
        for name, value in (headers or {}).items():
            request.add_header(name, value)
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                return response.status, dict(response.headers), response.read()
        except urllib.error.HTTPError as error:
            return error.code, dict(error.headers), error.read()

    def json(self, path, method="GET", data=None, **kwargs):
        status, _, payload = self.request(path, method, data, **kwargs)
        return status, json.loads(payload or b"{}")

    def test_dashboard_and_every_referenced_asset_load(self):
        status, headers, html = self.request("/", key="")
        self.assertEqual(status, 200)
        self.assertIn("text/html", headers["Content-Type"])
        assets = re.findall(r'(?:src|href)="(/[^"?]+\.(?:js|css))', html.decode())
        self.assertTrue(assets)
        for asset in assets:
            status, headers, _ = self.request(asset, key="")
            self.assertEqual(status, 200, asset)
            self.assertEqual(headers["X-Content-Type-Options"], "nosniff")

    def test_files_outside_the_dashboard_are_never_served(self):
        for path in ("/../server.py", "/js/../../server.py", "/%2e%2e/applydock/config.py", "/data/config.json", "/README.md"):
            status, _, _ = self.request(path, key="")
            self.assertIn(status, (401, 404), path)

    def test_api_requires_pairing_key_host_and_origin(self):
        self.assertEqual(self.json("/api/state", key="")[0], 401)
        self.assertEqual(self.json("/api/state", key="wrong")[0], 401)
        self.assertEqual(self.json("/api/state", headers={"Origin": "https://evil.example"})[0], 403)
        status, state = self.json("/api/state")
        self.assertEqual(status, 200)
        self.assertEqual(state["entries"], [])
        status, headers, _ = self.request("/api/state", "OPTIONS", key="", headers={"Origin": "chrome-extension://abc"})
        self.assertEqual(status, 204)
        self.assertEqual(headers["Access-Control-Allow-Origin"], "chrome-extension://abc")

    def test_errors_are_json(self):
        self.assertEqual(self.json("/api/nope")[0], 404)
        self.assertEqual(self.json("/api/capture", "POST", {"url": "https://example.com/"})[0], 400)
        self.assertEqual(self.json("/api/analyses/abc")[0], 404)

    def test_capture_edit_and_delete_an_application(self):
        status, result = self.json("/api/capture", "POST", {"url": "https://jobs.lever.co/acme/123", "title": "Engineer"})
        self.assertEqual(status, 200)
        entry_id = result["entry"]["id"]
        status, result = self.json(f"/api/entries/{entry_id}", "PATCH", {"company": "Acme"})
        self.assertEqual((status, result["entry"]["company"]), (200, "Acme"))
        self.assertEqual(self.json(f"/api/entries/{entry_id}", "DELETE")[1], {"ok": True, "notion_unchanged": True})

    @unittest.skipUnless(HAVE_TYPST, "typst is not installed")
    def test_resume_upload_editor_preview_and_version_link(self):
        pdf = resume_render.render(resume_model.normalize(json.loads(FIXTURE.read_text(encoding="utf-8"))))
        status, result = self.json("/api/resumes", "POST", {"filename": "cv.pdf", "content": base64.b64encode(pdf).decode()})
        self.assertEqual(status, 200)
        resume_id = result["resume_id"]
        status, editor = self.json(f"/api/resumes/{resume_id}/draft")
        self.assertEqual(status, 200)
        self.assertEqual(editor["draft"]["content"]["basics"]["name"], "Jordan Rivera")
        status, headers, preview = self.request(f"/api/resumes/{resume_id}/draft/preview", "POST", {"content": editor["draft"]["content"]})
        self.assertEqual((status, headers["Content-Type"], headers["X-Page-Count"]), (200, "application/pdf", "1"))
        self.assertTrue(preview.startswith(b"%PDF-"))
        stale = self.json(f"/api/resumes/{resume_id}/draft", "PATCH", {"content": editor["draft"]["content"], "expected_revision": 99})
        self.assertEqual(stale[0], 409)
        _, state = self.json("/api/state")
        file_url = state["resumes"][0]["file_url"].replace(f"http://{config.HOST}:{config.PORT}", "")
        status, headers, content = self.request(file_url, key="")
        self.assertEqual((status, content), (200, pdf))
        self.assertEqual(self.request(file_url.split("?")[0], key="")[0], 401)


if __name__ == "__main__":
    unittest.main()
