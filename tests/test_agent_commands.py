import unittest
from unittest.mock import patch

from applydock import agent_commands, applications, mcp_server


class AgentCommandTests(unittest.TestCase):
    def test_identity_uses_company_and_role_then_post_fallbacks(self):
        self.assertEqual(applications.identity({"id": "x", "company": "Acme", "title": "Engineer"})["label"], "Acme — Engineer")
        self.assertEqual(applications.identity({"id": "x", "title": "Hiring post", "url": "https://www.linkedin.com/posts/a_activity-123/"})["label"], "LinkedIn activity 123")
        self.assertEqual(applications.identity({"id": "x", "title": "Job opportunity", "recipient": "jobs@example.org"})["label"], "example.org")

    def test_email_preview_only_builds_a_draft(self):
        entry = {"id": "entry", "recipient": "jobs@example.org", "resume_id": "", "resume_version": None}
        with patch.object(applications, "get_entry", return_value=entry), \
                patch("applydock.auto_email.build_draft", return_value={"subject": "Hello", "body": "Draft"}) as build, \
                patch("applydock.delivery.send_mail") as send:
            result = agent_commands.email_preview("entry")
        build.assert_called_once_with(entry)
        send.assert_not_called()
        self.assertEqual(result["body"], "Draft")

    def test_command_registry_excludes_human_actions(self):
        self.assertNotIn("approve", agent_commands.COMMANDS)
        self.assertNotIn("gmail", agent_commands.COMMANDS)
        self.assertNotIn("send", agent_commands.COMMANDS)

    def test_job_state_flags_stale_work_and_maps_terminal_states(self):
        self.assertEqual(agent_commands._job_state("complete", ""), "done")
        self.assertEqual(agent_commands._job_state("cancelled", ""), "cancelled")
        self.assertEqual(agent_commands._job_state("running", "2000-01-01T00:00:00+00:00"), "stuck")

    def test_mcp_lists_cancellation_but_no_send_or_approval_tool(self):
        names = {tool["name"] for tool in mcp_server._tool_list()}
        self.assertIn("job_cancel", names)
        self.assertNotIn("approve", names)
        self.assertNotIn("send", names)
        with self.assertRaisesRegex(ValueError, "Unknown tool"):
            mcp_server.handle({"jsonrpc": "2.0", "id": 7, "method": "tools/call", "params": {"name": "send", "arguments": {}}})
