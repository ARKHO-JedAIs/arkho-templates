"""The agent's live settings: defaults, validation and the cached read.

Run from the backend root: python -m unittest discover -s test/python -v
"""
import json
import sys
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "src" / "layer" / "python-common" / "python"))

from common.whatsapp import agent_settings  # noqa: E402


class SettingsTest(unittest.TestCase):
    def setUp(self):
        agent_settings.clear_cache()
        self.addCleanup(agent_settings.clear_cache)
        self.client = mock.MagicMock()
        for patcher in (
            mock.patch.object(agent_settings, "_client", return_value=self.client),
            mock.patch.object(agent_settings, "SETTINGS_PARAMETER_NAME", "/p-agent-settings"),
        ):
            patcher.start()
            self.addCleanup(patcher.stop)

    def stored(self, value):
        self.client.get_parameter.return_value = {"Parameter": {"Value": value if isinstance(value, str) else json.dumps(value)}}

    def test_defaults_keep_a_window_and_the_deploy_time_limit(self):
        with mock.patch.dict("os.environ", {"AGENT_RATE_LIMIT_PER_HOUR": "12"}):
            defaults = agent_settings.defaults()
        self.assertEqual(defaults["memory"], {"mode": "window", "minutes": 60})
        self.assertEqual(defaults["rateLimit"], {"enabled": True, "perHour": 12})

    def test_a_zero_limit_from_the_deploy_means_no_limit(self):
        with mock.patch.dict("os.environ", {"AGENT_RATE_LIMIT_PER_HOUR": "0"}):
            defaults = agent_settings.defaults()
        self.assertEqual(defaults["rateLimit"], {"enabled": False, "perHour": 30})

    def test_reads_the_stored_settings_and_caches_them(self):
        self.stored({"memory": {"mode": "off", "minutes": 5}, "rateLimit": {"enabled": False, "perHour": 99}})
        first = agent_settings.read()
        agent_settings.read()
        self.assertEqual(first["memory"], {"mode": "off", "minutes": 5})
        self.assertFalse(first["rateLimit"]["enabled"])
        self.client.get_parameter.assert_called_once()

    def test_an_unreadable_parameter_gives_the_defaults(self):
        self.client.get_parameter.side_effect = RuntimeError("SSM down")
        self.assertEqual(agent_settings.read()["memory"]["mode"], "window")

    def test_a_bad_field_falls_back_to_its_default_and_keeps_the_rest(self):
        self.stored({"memory": {"mode": "forever", "minutes": 15}, "rateLimit": {"perHour": "many"}})
        settings = agent_settings.read()
        self.assertEqual(settings["memory"], {"mode": "window", "minutes": 15})
        self.assertEqual(settings["rateLimit"]["perHour"], agent_settings.defaults()["rateLimit"]["perHour"])

    def test_text_that_is_not_json_gives_the_defaults(self):
        self.stored("not json")
        self.assertEqual(agent_settings.read(), agent_settings.defaults())

    def test_merge_changes_only_what_is_sent(self):
        current = agent_settings.defaults()
        merged = agent_settings.merge(current, {"memory": {"minutes": 120}})
        self.assertEqual(merged["memory"], {"mode": "window", "minutes": 120})
        self.assertEqual(merged["rateLimit"], current["rateLimit"])
        self.assertEqual(current["memory"]["minutes"], 60)

    def test_merge_refuses_what_is_not_valid(self):
        current = agent_settings.defaults()
        for bad in (
            {"memory": {"mode": "forever"}},
            {"memory": {"minutes": 0}},
            {"memory": {"minutes": 10081}},
            {"memory": {"minutes": 1.5}},
            {"memory": {"minutes": True}},
            {"rateLimit": {"enabled": "yes"}},
            {"rateLimit": {"perHour": 0}},
            {"rateLimit": "off"},
            "memory",
        ):
            with self.assertRaises(agent_settings.SettingsError, msg=str(bad)):
                agent_settings.merge(current, bad)

    def test_write_stores_compact_json_and_drops_the_cache(self):
        self.stored(agent_settings.defaults())
        agent_settings.read()
        agent_settings.write(agent_settings.defaults())
        kwargs = self.client.put_parameter.call_args.kwargs
        self.assertEqual(kwargs["Name"], "/p-agent-settings")
        self.assertTrue(kwargs["Overwrite"])
        self.assertEqual(json.loads(kwargs["Value"]), agent_settings.defaults())
        agent_settings.read()
        self.assertEqual(self.client.get_parameter.call_count, 2)


if __name__ == "__main__":
    unittest.main()
