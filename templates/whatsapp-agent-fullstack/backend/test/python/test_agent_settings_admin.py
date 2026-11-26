"""settings-admin: who may read and change the agent's memory and answer limit.

Run from the backend root: python -m unittest discover -s test/python -v
"""
import importlib.util
import json
import os
import sys
import types
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "src" / "layer" / "python-common" / "python"))

from common import access  # noqa: E402
from common.whatsapp import agent_settings  # noqa: E402


def load_lambda():
    for name in ("boto3", "botocore", "botocore.exceptions"):
        sys.modules.setdefault(name, types.ModuleType(name))
    with mock.patch.dict(os.environ, {"AGENT_MEMORY_MODE": "facts"}):
        spec = importlib.util.spec_from_file_location(
            "settings_admin", ROOT / "src" / "lambda" / "agent" / "settings-admin" / "index.py"
        )
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
    return module


def call(module, method, body=None, groups="developer"):
    event = {
        "httpMethod": method,
        "resource": "/admin/agent/settings",
        "body": json.dumps(body) if body is not None else None,
        "requestContext": {"authorizer": {"username": "dev@example.com", "groups": groups}},
    }
    response = module.handler(event, None)
    parsed = json.loads(response["body"]) if response.get("body") else {}
    return response["statusCode"], parsed.get("data")


class SettingsAdminTest(unittest.TestCase):
    def setUp(self):
        access.clear_cache()
        self.addCleanup(access.clear_cache)
        patcher = mock.patch.object(access, "_access_table", return_value=None)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.module = load_lambda()
        self.stored = agent_settings.defaults()
        self.write = mock.MagicMock()
        for patcher in (
            mock.patch.object(agent_settings, "read", side_effect=lambda force=False: json.loads(json.dumps(self.stored))),
            mock.patch.object(agent_settings, "write", self.write),
        ):
            patcher.start()
            self.addCleanup(patcher.stop)

    def test_reads_the_settings_with_the_long_term_memory_of_the_deploy(self):
        status, data = call(self.module, "GET")
        self.assertEqual(status, 200)
        self.assertEqual(data["memory"], {"mode": "window", "minutes": 60})
        self.assertEqual(data["longTermMemory"], "facts")

    def test_only_who_sees_the_agent_page_may_read(self):
        status, _ = call(self.module, "GET", groups="member")
        self.assertEqual(status, 403)

    def test_a_developer_changes_the_memory_and_the_limit(self):
        status, data = call(
            self.module,
            "PUT",
            {"memory": {"mode": "each_message"}, "rateLimit": {"enabled": False}},
        )
        self.assertEqual(status, 200)
        self.assertEqual(data["memory"]["mode"], "each_message")
        self.assertFalse(data["rateLimit"]["enabled"])
        saved = self.write.call_args.args[0]
        self.assertEqual(saved["memory"]["mode"], "each_message")
        self.assertEqual(saved["rateLimit"]["perHour"], self.stored["rateLimit"]["perHour"])

    def test_changing_needs_the_agent_settings_permission(self):
        status, _ = call(self.module, "PUT", {"memory": {"minutes": 10}}, groups="admin")
        self.assertEqual(status, 403)
        self.write.assert_not_called()

    def test_a_role_can_be_given_the_permission(self):
        table = mock.MagicMock()
        table.get_item.return_value = {"Item": {"menu": ["agent"], "actions": ["agent.settings"]}}
        access.clear_cache()
        with mock.patch.object(access, "_access_table", return_value=table):
            status, _ = call(self.module, "PUT", {"memory": {"minutes": 10}}, groups="supervisor")
        self.assertEqual(status, 200)

    def test_invalid_values_are_refused_and_nothing_is_saved(self):
        for bad in ({"memory": {"mode": "forever"}}, {"memory": {"minutes": 0}}, {"rateLimit": {"perHour": -1}}):
            status, _ = call(self.module, "PUT", bad)
            self.assertEqual(status, 422, bad)
        self.write.assert_not_called()


if __name__ == "__main__":
    unittest.main()
