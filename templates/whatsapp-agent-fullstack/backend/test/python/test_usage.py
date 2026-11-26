"""Usage events and their estimated cost (common.whatsapp.usage) and the
usage-metrics Lambda behind the Dashboard's "Uso y costos" tab. DynamoDB is mocked.

Run from the backend root: python -m unittest discover -s test/python -v
"""
import importlib.util
import json
import unittest
from datetime import date
from decimal import Decimal
from unittest import mock

import test_ws_handler as support
from common.whatsapp import usage

spec = importlib.util.spec_from_file_location(
    "usage_metrics", support.ROOT / "src" / "lambda" / "whatsapp" / "usage-metrics" / "index.py"
)
usage_metrics = importlib.util.module_from_spec(spec)
spec.loader.exec_module(usage_metrics)

DAY = date(2026, 11, 10)
EVENTS = [
    {"day": "2026-11-10", "kind": "agent_turn", "outcome": "answered", "model": "us.anthropic.claude-sonnet-4-6",
     "input_tokens": Decimal(1000), "output_tokens": Decimal(200), "cache_read_tokens": Decimal(10000),
     "duration_ms": Decimal(4000)},
    {"day": "2026-11-10", "kind": "agent_turn", "outcome": "blocked", "model": "us.anthropic.claude-sonnet-4-6",
     "input_tokens": Decimal(500), "output_tokens": Decimal(50), "duration_ms": Decimal(2000)},
    {"day": "2026-11-10", "kind": "speech", "characters": Decimal(1000), "engine": "neural"},
    {"day": "2026-11-10", "kind": "transcription", "seconds": Decimal(5)},
    {"day": "2026-11-10", "kind": "template", "category": "UTILITY"},
    {"day": "2026-11-10", "kind": "message", "direction": "in"},
    {"day": "2026-11-10", "kind": "message", "direction": "out"},
]


class CostTest(unittest.TestCase):
    def test_each_service_is_priced_from_the_list(self):
        self.assertAlmostEqual(usage.cost_of(EVENTS[0])[1], (1000 * 3 + 200 * 15 + 10000 * 0.3) / 1e6)
        self.assertEqual(usage.cost_of(EVENTS[2]), ("polly", 0.016))
        # Transcribe bills at least 15 seconds per job.
        self.assertAlmostEqual(usage.cost_of(EVENTS[3])[1], 15 / 60 * 0.024)
        self.assertAlmostEqual(usage.cost_of(EVENTS[4])[1], 0.02 + 0.005)

    def test_summary_counts_queries_by_outcome_and_fills_every_day(self):
        summary = usage.summarize(EVENTS, date(2026, 11, 9), DAY)
        self.assertEqual(summary["queries"], 2)
        self.assertEqual(summary["outcomes"], {"answered": 1, "blocked": 1, "handoff": 0, "failed": 0})
        self.assertEqual(summary["avg_response_seconds"], 3.0)
        self.assertEqual((summary["voice_answers"], summary["voice_notes"], summary["templates"]), (1, 1, 1))
        self.assertEqual([row["date"] for row in summary["by_day"]], ["2026-11-09", "2026-11-10"])
        self.assertEqual(summary["by_day"][0]["queries"], 0)
        total = summary["costs"]["total"]
        self.assertAlmostEqual(total, sum(summary["costs"][s] for s in usage.SERVICES), places=3)
        self.assertAlmostEqual(summary["costs"]["per_query"], total / 2, places=3)

    def test_messages_and_agentcore_compute_are_counted(self):
        self.assertEqual(usage.cost_of(EVENTS[5]), ("whatsapp", 0.005))
        # 4 s at 1 vCPU and 2 GB.
        self.assertAlmostEqual(usage.agentcore_cost(EVENTS[0]), 4 / 3600 * (0.0895 + 2 * 0.00945))
        summary = usage.summarize(EVENTS, DAY, DAY)
        self.assertEqual(summary["messages"], {"in": 1, "out": 2})
        self.assertGreater(summary["costs"]["agentcore"], 0)
        self.assertEqual(summary["tokens_per_query"], round((1000 + 10000 + 200 + 500 + 50) / 2))

    def test_recording_without_a_table_does_nothing_and_never_raises(self):
        with mock.patch.object(usage, "TABLE_NAME", ""):
            usage.record(usage.SPEECH, characters=10)
        table = mock.MagicMock()
        table.put_item.side_effect = RuntimeError("down")
        with mock.patch.object(usage, "TABLE_NAME", "t"), mock.patch.object(usage, "_usage_table", return_value=table):
            usage.record(usage.SPEECH, characters=10, engine="neural", flag=True)
        item = table.put_item.call_args.kwargs["Item"]
        self.assertEqual((item["kind"], item["characters"], item["engine"]), ("speech", Decimal(10), "neural"))
        self.assertNotIn("flag", item)


class UsageMetricsTest(unittest.TestCase):
    def call(self, query=None, allowed=True):
        event = {"httpMethod": "GET", "queryStringParameters": query}
        with mock.patch.object(usage_metrics.http, "is_allowed", return_value=allowed), \
             mock.patch.object(usage_metrics, "today", return_value=DAY), \
             mock.patch.object(usage, "events", side_effect=lambda start, end: EVENTS if end == DAY else []):
            response = usage_metrics.handler(event, None)
        return response["statusCode"], json.loads(response["body"])

    def test_defaults_to_the_last_seven_days_and_compares_with_the_seven_before(self):
        status, body = self.call()
        self.assertEqual(status, 200)
        data = body["data"]
        self.assertEqual((data["from"], data["to"]), ("2026-11-04", "2026-11-10"))
        self.assertEqual(len(data["by_day"]), 7)
        self.assertEqual(data["queries"], 2)
        self.assertEqual(data["previous"]["queries"], 0)
        self.assertIn("checked_on", data["prices"])

    def test_all_reads_every_day_recorded(self):
        event = {"httpMethod": "GET", "queryStringParameters": {"all": "true"}}
        with mock.patch.object(usage_metrics.http, "is_allowed", return_value=True),              mock.patch.object(usage_metrics, "today", return_value=DAY),              mock.patch.object(usage, "all_events", return_value=EVENTS):
            data = json.loads(usage_metrics.handler(event, None)["body"])["data"]
        self.assertEqual((data["from"], data["to"], data["previous"]), ("2026-11-10", "2026-11-10", None))
        self.assertEqual(data["queries"], 2)

    def test_rejects_bad_periods_and_other_profiles(self):
        self.assertEqual(self.call({"from": "2026-11-11"})[0], 422)
        self.assertEqual(self.call({"to": "2026-11-11"})[0], 422)
        self.assertEqual(self.call({"from": "2025-01-01"})[0], 422)
        self.assertEqual(self.call({"from": "2026-01-01"})[0], 200)
        self.assertEqual(self.call({"from": "x"})[0], 422)
        self.assertEqual(self.call(allowed=False)[0], 403)


if __name__ == "__main__":
    unittest.main()


class RecordingHooksTest(unittest.TestCase):
    """The places that write usage events: every sent message and every received one."""

    def test_a_sent_message_is_recorded_but_a_template_and_a_receipt_are_not(self):
        from common.whatsapp import messaging

        client = mock.MagicMock()
        client.send_whatsapp_message.return_value = {"messageId": "wamid.1"}
        with mock.patch.object(messaging, "social_messaging", client), \
                mock.patch.object(messaging.config, "origination_phone_number_id", return_value="arn:phone"), \
                mock.patch.object(messaging.config, "meta_api_version", return_value="v20.0"), \
                mock.patch.object(messaging.usage, "record") as record:
            messaging.send_text("56911111111", "Hola")
            messaging._send({"messaging_product": "whatsapp", "type": "template"})
            messaging._send({"messaging_product": "whatsapp", "status": "read"})
        record.assert_called_once_with(usage.MESSAGE, direction="out", type="text")
