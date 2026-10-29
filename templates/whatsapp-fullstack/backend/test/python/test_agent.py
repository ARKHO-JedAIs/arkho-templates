"""Unit tests of the AI agent wiring: ws-handler routing, agent-worker and the agent helpers.

Run from the backend root: python -m unittest discover -s test/python -v
"""
import importlib.util
import io
import json
import unittest
from datetime import datetime, timedelta, timezone
from unittest import mock

import test_ws_handler as support

agent = support.agent
config = support.config
messaging = support.messaging
realtime = support.realtime
store = support.store
ws_handler = support.ws_handler

spec = importlib.util.spec_from_file_location(
    "agent_worker", support.ROOT / "src" / "lambda" / "whatsapp" / "agent-worker" / "index.py"
)
agent_worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(agent_worker)

PHONE = "56911111111"
NOW = datetime(2026, 10, 1, 14, 30, tzinfo=timezone.utc)


def client_error(code: str) -> Exception:
    error = agent.ClientError(code)
    error.response = {"Error": {"Code": code, "Message": code}}
    return error


def conditional_failed() -> Exception:
    return client_error("ConditionalCheckFailedException")


def open_conversation(**extra) -> dict:
    return {"phone": PHONE, "mode": "assistant", "last_inbound_at": datetime.now(timezone.utc).isoformat(), **extra}


def job(**extra) -> dict:
    return {
        "phone": PHONE,
        "message_id": "wamid.1",
        "text": "Hola, ¿tienen despacho?",
        "user_name": "Camila",
        "session_id": agent.session_id(PHONE, NOW),
        "actor_id": agent.actor_id(PHONE),
        "origination_phone_number_id": "arn:phone",
        **extra,
    }


def sqs_event(body: dict) -> dict:
    return {"Records": [{"messageId": "m-1", "body": json.dumps(body)}]}


class AgentHelpersTest(unittest.TestCase):
    def setUp(self):
        self.table = mock.MagicMock()
        patcher = mock.patch.object(store, "conversations_table", self.table)
        patcher.start()
        self.addCleanup(mock.patch.stopall)

    def test_session_ids_meet_agentcore_minimum_and_rotate_daily(self):
        today = agent.session_id(PHONE, NOW)
        self.assertGreaterEqual(len(today), 33)
        self.assertTrue(today.startswith("wa-") and today.endswith("-20261001"))
        self.assertNotIn(PHONE, today)
        self.assertNotEqual(today, agent.session_id(PHONE, NOW + timedelta(days=1)))
        self.assertEqual(today, agent.session_id(PHONE, NOW + timedelta(hours=1)))

    def test_actor_id_is_stable_and_hides_the_phone(self):
        self.assertEqual(agent.actor_id(PHONE), agent.actor_id(PHONE))
        self.assertEqual(len(agent.actor_id(PHONE)), 35)
        self.assertNotIn(PHONE, agent.actor_id(PHONE))
        self.assertNotEqual(agent.actor_id(PHONE), agent.actor_id("56922222222"))

    def test_take_turn_counts_within_the_hour(self):
        self.assertTrue(agent.take_turn(PHONE, NOW))
        kwargs = self.table.update_item.call_args.kwargs
        self.assertEqual(kwargs["ConditionExpression"], "#hour = :hour AND #turns < :limit")
        self.assertEqual(kwargs["ExpressionAttributeValues"][":hour"], "2026100114")

    def test_take_turn_starts_a_new_hour(self):
        self.table.update_item.side_effect = [conditional_failed(), {}]
        self.assertTrue(agent.take_turn(PHONE, NOW))
        self.assertIn("SET #hour = :hour, #turns = :one", self.table.update_item.call_args.kwargs["UpdateExpression"])

    def test_take_turn_refuses_over_the_limit(self):
        self.table.update_item.side_effect = conditional_failed()
        with mock.patch.dict("os.environ", {"AGENT_RATE_LIMIT_PER_HOUR": "5"}):
            self.assertFalse(agent.take_turn(PHONE, NOW))
        self.assertEqual(self.table.update_item.call_args_list[0].kwargs["ExpressionAttributeValues"][":limit"], 5)

    def test_rate_notice_is_claimed_once_per_hour(self):
        self.assertTrue(agent.claim_rate_notice(PHONE, NOW))
        self.table.update_item.side_effect = conditional_failed()
        self.assertFalse(agent.claim_rate_notice(PHONE, NOW))

    def test_blocked_turns_count_within_24_hours_and_restart_after(self):
        self.table.update_item.return_value = {"Attributes": {"agent_blocked_count": 2}}
        self.assertEqual(agent.record_blocked(PHONE, NOW), 2)
        self.table.update_item.side_effect = [conditional_failed(), {}]
        self.assertEqual(agent.record_blocked(PHONE, NOW), 1)

    def test_enqueue_groups_by_customer_and_dedupes_by_message(self):
        sqs = mock.MagicMock()
        with mock.patch.object(agent, "_client", return_value=sqs), mock.patch.object(agent, "JOBS_QUEUE_URL", "https://sqs/q.fifo"):
            agent.enqueue(job())
            agent.enqueue(job())
        first, second = (call.kwargs for call in sqs.send_message.call_args_list)
        self.assertEqual(first["QueueUrl"], "https://sqs/q.fifo")
        self.assertEqual(first["MessageGroupId"], second["MessageGroupId"])
        self.assertEqual(first["MessageDeduplicationId"], second["MessageDeduplicationId"])
        self.assertNotIn(PHONE, first["MessageGroupId"])
        self.assertEqual(json.loads(first["MessageBody"])["text"], "Hola, ¿tienen despacho?")

    def test_enabled_reads_the_switch_and_treats_errors_as_off(self):
        ssm = mock.MagicMock()
        ssm.get_parameter.return_value = {"Parameter": {"Value": json.dumps({"enabled": False})}}
        with mock.patch.object(agent, "_client", return_value=ssm), mock.patch.object(agent, "PROMPT_PARAMETER_NAME", "/p"):
            agent._enabled_cache.update(until=0.0)
            self.assertFalse(agent.enabled())
            ssm.get_parameter.side_effect = RuntimeError("throttled")
            agent._enabled_cache.update(until=0.0)
            self.assertFalse(agent.enabled())
            ssm.get_parameter.side_effect = None
            ssm.get_parameter.return_value = {"Parameter": {"Value": json.dumps({"enabled": True})}}
            agent._enabled_cache.update(until=0.0)
            self.assertTrue(agent.enabled())
        agent._enabled_cache.update(until=0.0, value=True)

    def test_the_web_never_sees_the_agent_counters(self):
        view = store.conversation_view({"phone": PHONE, "agent_turns": 3, "agent_blocked_count": 1, "mode": "assistant"})
        self.assertEqual(view, {"phone": PHONE, "mode": "assistant", "unreadCount": 0})


class WsHandlerRoutingTest(unittest.TestCase):
    """Same stubs as the ws-handler tests; only the agent path is new."""

    def setUp(self):
        support.WsHandlerTest.setUp(self)
        self.mocks["auto_reply_message"].return_value = "Gracias"
        patches = [
            mock.patch.object(agent, "enabled", return_value=True),
            mock.patch.object(agent, "take_turn", return_value=True),
            mock.patch.object(agent, "claim_rate_notice", return_value=True),
            mock.patch.object(agent, "enqueue"),
        ]
        self.mocks.update({p.attribute: p.start() for p in patches})

    def with_agent(self):
        patcher = mock.patch.object(agent, "JOBS_QUEUE_URL", "https://sqs/agent-jobs.fifo")
        patcher.start()

    def test_without_an_agent_the_fixed_auto_reply_answers(self):
        ws_handler.handler(support.sns_event(support.text_message()), None)
        self.mocks["enqueue"].assert_not_called()
        self.mocks["send_text"].assert_called_once_with(PHONE, "Gracias", "arn:phone")

    def test_with_the_agent_the_message_is_queued_instead(self):
        self.with_agent()
        ws_handler.handler(
            support.sns_event(support.text_message("Hola"), contacts=[{"wa_id": PHONE, "profile": {"name": "Camila"}}]),
            None,
        )
        self.mocks["send_text"].assert_not_called()
        queued = self.mocks["enqueue"].call_args.args[0]
        self.assertEqual(queued["phone"], PHONE)
        self.assertEqual(queued["message_id"], "wamid.1")
        self.assertEqual(queued["text"], "Hola")
        self.assertEqual(queued["user_name"], "Camila")
        self.assertEqual(queued["origination_phone_number_id"], "arn:phone")
        self.assertGreaterEqual(len(queued["session_id"]), 33)
        self.assertEqual(queued["actor_id"], agent.actor_id(PHONE))

    def test_a_switched_off_agent_falls_back_to_the_auto_reply(self):
        self.with_agent()
        self.mocks["enabled"].return_value = False
        ws_handler.handler(support.sns_event(support.text_message()), None)
        self.mocks["enqueue"].assert_not_called()
        self.mocks["send_text"].assert_called_once_with(PHONE, "Gracias", "arn:phone")

    def test_the_agent_does_not_answer_a_conversation_a_person_took(self):
        self.with_agent()
        self.conversation = {"phone": PHONE, "mode": "human"}
        ws_handler.handler(support.sns_event(support.text_message()), None)
        self.mocks["enqueue"].assert_not_called()

    def test_a_reaction_is_not_queued(self):
        self.with_agent()
        reaction = {"from": PHONE, "id": "wamid.r", "type": "reaction", "reaction": {"message_id": "wamid.0", "emoji": "x"}}
        ws_handler.handler(support.sns_event(reaction), None)
        self.mocks["enqueue"].assert_not_called()

    def test_over_the_rate_limit_one_polite_notice_per_hour(self):
        self.with_agent()
        self.mocks["take_turn"].return_value = False
        ws_handler.handler(support.sns_event(support.text_message()), None)
        self.mocks["enqueue"].assert_not_called()
        self.mocks["send_text"].assert_called_once_with(PHONE, agent.RATE_LIMITED_TEXT, "arn:phone")
        self.mocks["claim_rate_notice"].return_value = False
        ws_handler.handler(support.sns_event(support.text_message(message_id="wamid.2")), None)
        self.assertEqual(self.mocks["send_text"].call_count, 1)

    def test_a_queue_failure_falls_back_to_the_auto_reply(self):
        self.with_agent()
        self.mocks["enqueue"].side_effect = RuntimeError("SQS down")
        self.assertEqual(ws_handler.handler(support.sns_event(support.text_message()), None), {"status": "processed"})
        self.mocks["send_text"].assert_called_once_with(PHONE, "Gracias", "arn:phone")


class AgentWorkerTest(unittest.TestCase):
    def setUp(self):
        self.saved = []

        def save_message(phone, direction, message_type, text="", **extra):
            item = {"phone": phone, "date": "2026-10-01T14:30:00Z", "direction": direction, "type": message_type, "message": text, **extra}
            self.saved.append(item)
            return item

        self.conversation = open_conversation()
        self.result = {"status": "ok", "response": "Sí, despachamos a todo Chile.", "handoff": False, "usage": {"inputTokens": 10}}
        patches = [
            mock.patch.object(store, "get_conversation", side_effect=lambda phone: self.conversation),
            mock.patch.object(store, "save_message", side_effect=save_message),
            mock.patch.object(store, "touch_conversation", side_effect=lambda *a, **k: self.conversation),
            mock.patch.object(realtime, "announce_message"),
            mock.patch.object(messaging, "send_text", return_value="wamid.reply"),
            mock.patch.object(agent, "hand_to_person"),
            mock.patch.object(agent, "record_blocked", return_value=1),
            mock.patch.object(agent_worker, "invoke_agent", side_effect=lambda job: self.result),
        ]
        self.mocks = {p.attribute: p.start() for p in patches}
        self.addCleanup(mock.patch.stopall)

    def run_job(self, **extra):
        return agent_worker.process(job(**extra))

    def test_ok_sends_and_stores_the_reply_as_the_agent(self):
        self.assertEqual(self.run_job(), "answered")
        self.mocks["send_text"].assert_called_once_with(PHONE, "Sí, despachamos a todo Chile.", "arn:phone")
        self.assertEqual(self.saved[0]["direction"], store.OUTBOUND)
        self.assertEqual(self.saved[0]["sent_by"], "agent")
        self.assertEqual(self.saved[0]["message_id"], "wamid.reply")
        self.mocks["announce_message"].assert_called_once()
        self.mocks["hand_to_person"].assert_not_called()

    def test_skips_a_conversation_a_person_took(self):
        self.conversation = open_conversation(mode="human")
        self.assertEqual(self.run_job(), "skipped_human")
        self.mocks["invoke_agent"].assert_not_called()

    def test_skips_when_the_24_hour_window_closed(self):
        self.conversation = open_conversation(last_inbound_at=(datetime.now(timezone.utc) - timedelta(hours=25)).isoformat())
        self.assertEqual(self.run_job(), "skipped_window")
        self.mocks["invoke_agent"].assert_not_called()
        self.mocks["send_text"].assert_not_called()

    def test_drops_the_reply_when_a_person_took_over_meanwhile(self):
        conversations = iter([open_conversation(), open_conversation(mode="human")])
        self.mocks["get_conversation"].side_effect = lambda phone: next(conversations)
        self.assertEqual(self.run_job(), "skipped_human")
        self.mocks["send_text"].assert_not_called()

    def test_handoff_sends_the_handoff_message_even_after_the_takeover(self):
        self.result = {"status": "ok", "response": "Te comunico con una persona.", "handoff": True}
        conversations = iter([open_conversation(), open_conversation(mode="human")])
        self.mocks["get_conversation"].side_effect = lambda phone: next(conversations)
        self.assertEqual(self.run_job(), "handoff")
        self.mocks["send_text"].assert_called_once_with(PHONE, "Te comunico con una persona.", "arn:phone")
        self.mocks["hand_to_person"].assert_not_called()

    def test_blocked_turns_are_counted_and_the_third_hands_over(self):
        self.result = {"status": "blocked", "response": "No puedo ayudarte con eso.", "handoff": False, "blocked_category": "prompt_injection"}
        self.assertEqual(self.run_job(), "blocked")
        self.mocks["send_text"].assert_called_once()
        self.mocks["hand_to_person"].assert_not_called()
        self.mocks["record_blocked"].return_value = 3
        self.assertEqual(self.run_job(), "blocked_handoff")
        self.mocks["hand_to_person"].assert_called_once_with(PHONE, agent.AGENT_HANDOFF, agent.BLOCKED_NOTICE)

    def test_a_blocked_mistake_is_answered_but_never_counted(self):
        for category in ("empty_input", "input_too_long"):
            self.result = {"status": "blocked", "response": "Tu mensaje es muy largo.", "handoff": False, "blocked_category": category}
            self.mocks["record_blocked"].return_value = 3
            self.assertEqual(self.run_job(), "blocked")
        self.mocks["record_blocked"].assert_not_called()
        self.mocks["hand_to_person"].assert_not_called()

    def test_an_agent_switched_off_meanwhile_answers_with_the_auto_reply(self):
        self.result = {"status": "blocked", "response": "", "handoff": False, "blocked_category": "agent_disabled"}
        with mock.patch.object(config, "auto_reply_message", return_value="Gracias"):
            self.assertEqual(self.run_job(), "skipped_disabled")
        self.mocks["send_text"].assert_called_once_with(PHONE, "Gracias", "arn:phone")
        self.assertEqual(self.saved[0]["sent_by"], "assistant")
        self.mocks["record_blocked"].assert_not_called()
        self.mocks["hand_to_person"].assert_not_called()

    def test_an_agent_error_hands_over_without_telling_the_customer(self):
        self.result = {"status": "error", "response": "Traceback (most recent call last): ...", "handoff": False}
        self.assertEqual(self.run_job(), "failed")
        self.mocks["send_text"].assert_not_called()
        self.mocks["hand_to_person"].assert_called_once_with(PHONE, agent.AGENT_FAILED, agent.FAILED_NOTICE)

    def test_an_agent_exception_hands_over_too(self):
        self.mocks["invoke_agent"].side_effect = TimeoutError("read timeout")
        self.assertEqual(self.run_job(), "failed")
        self.mocks["send_text"].assert_not_called()
        self.mocks["hand_to_person"].assert_called_once()

    def test_a_failed_send_hands_over(self):
        self.mocks["send_text"].side_effect = RuntimeError("throttled")
        self.assertEqual(self.run_job(), "failed")
        self.mocks["hand_to_person"].assert_called_once()

    def test_handler_ignores_malformed_jobs(self):
        self.assertEqual(agent_worker.handler({"Records": [{"messageId": "x", "body": "not json"}]}, None), {"status": "processed"})
        self.assertEqual(agent_worker.handler(sqs_event({"text": "no phone"}), None), {"status": "processed"})
        self.mocks["invoke_agent"].assert_not_called()

    def test_handler_retries_when_the_conversation_cannot_be_read(self):
        self.mocks["get_conversation"].side_effect = RuntimeError("DynamoDB down")
        with self.assertRaises(RuntimeError):
            agent_worker.handler(sqs_event(job()), None)
        self.mocks["invoke_agent"].assert_not_called()


class InvokeAgentTest(unittest.TestCase):
    def setUp(self):
        self.client = mock.MagicMock()
        patcher = mock.patch.object(agent_worker, "_client", return_value=self.client)
        patcher.start()
        self.addCleanup(mock.patch.stopall)

    def test_agentcore_gets_the_contract_payload_and_session(self):
        self.client.invoke_agent_runtime.return_value = {"response": io.BytesIO(b'{"status": "ok", "response": "Hola"}')}
        with mock.patch.object(agent_worker, "AGENT_RUNTIME_ARN", "arn:runtime"):
            result = agent_worker.invoke_agent(job())
        self.assertEqual(result["response"], "Hola")
        kwargs = self.client.invoke_agent_runtime.call_args.kwargs
        self.assertEqual(kwargs["agentRuntimeArn"], "arn:runtime")
        self.assertEqual(kwargs["qualifier"], "DEFAULT")
        self.assertEqual(kwargs["runtimeSessionId"], job()["session_id"])
        payload = json.loads(kwargs["payload"].decode("utf-8"))
        self.assertEqual(
            payload,
            {
                "prompt": "Hola, ¿tienen despacho?",
                "actor_id": agent.actor_id(PHONE),
                "session_id": job()["session_id"],
                "channel": "whatsapp",
                "user_name": "Camila",
                "phone": PHONE,
            },
        )

    def test_agentcore_stream_takes_the_last_event(self):
        stream = b'data: {"status": "ok", "response": "parcial"}\n\ndata: {"status": "ok", "response": "final"}\n\n'
        self.client.invoke_agent_runtime.return_value = {"response": io.BytesIO(stream)}
        with mock.patch.object(agent_worker, "AGENT_RUNTIME_ARN", "arn:runtime"):
            self.assertEqual(agent_worker.invoke_agent(job())["response"], "final")

    def test_lambda_variant_and_its_errors(self):
        self.client.invoke.return_value = {"Payload": io.BytesIO(b'{"status": "ok", "response": "Hola"}')}
        with mock.patch.object(agent_worker, "AGENT_RUNTIME_ARN", ""), mock.patch.object(agent_worker, "AGENT_FUNCTION_NAME", "fn"):
            self.assertEqual(agent_worker.invoke_agent(job())["status"], "ok")
            self.assertEqual(self.client.invoke.call_args.kwargs["FunctionName"], "fn")
            self.client.invoke.return_value = {"Payload": io.BytesIO(b'{"errorMessage": "boom"}'), "FunctionError": "Unhandled"}
            with self.assertRaises(agent_worker.AgentFailed):
                agent_worker.invoke_agent(job())

    def test_a_non_json_answer_is_a_failure(self):
        self.client.invoke_agent_runtime.return_value = {"response": io.BytesIO(b"<html>")}
        with mock.patch.object(agent_worker, "AGENT_RUNTIME_ARN", "arn:runtime"):
            with self.assertRaises(agent_worker.AgentFailed):
                agent_worker.invoke_agent(job())


if __name__ == "__main__":
    unittest.main()
