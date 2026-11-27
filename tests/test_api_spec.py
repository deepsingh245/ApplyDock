import unittest
from unittest.mock import patch

from applydock import agent_commands, api_spec, http_server


class ApiSpecTests(unittest.TestCase):
    def test_routes_and_commands_are_in_spec_with_local_key_security(self):
        spec = api_spec.build()
        seen = []
        for _path, methods in spec["paths"].items():
            for _method, operation in methods.items():
                seen.append(operation["operationId"])
                self.assertEqual(operation["security"], [{"LocalKey": []}])
        self.assertEqual(len(seen), len(set(seen)))
        self.assertTrue(set(agent_commands.COMMANDS).issubset(seen))
        self.assertGreaterEqual(len(seen), len(http_server.ROUTES))
        self.assertTrue(spec["paths"]["/api/entries/{id}"]["patch"]["x-human-only"])

    def test_agent_spec_has_exact_host_and_only_safe_commands(self):
        with patch("applydock.config.PUBLIC_URL", "https://sample.ngrok-free.app"):
            spec = api_spec.build_agent()
            self.assertIn("sample.ngrok-free.app", http_server.allowed_hosts())
        operation_ids = [operation["operationId"] for methods in spec["paths"].values() for operation in methods.values()]
        self.assertCountEqual(operation_ids, list(agent_commands.COMMANDS))
        self.assertEqual(spec["servers"][0]["url"], "https://sample.ngrok-free.app")
        self.assertNotIn("/api/entries/{id}", spec["paths"])
        self.assertIn("/api/jobs/{id}/cancel", spec["paths"])

    def test_tunnel_url_must_be_an_exact_https_origin(self):
        for value in ("http://sample.ngrok-free.app", "https://sample.ngrok-free.app/path", "https://user@sample.ngrok-free.app"):
            with self.subTest(value=value), patch("applydock.config.PUBLIC_URL", value):
                self.assertEqual(http_server._public_origin(), "")
