import unittest
from unittest import mock

import support  # noqa: F401
from support import PHONE, FakeModel, agent_env, text

from botocore.exceptions import ClientError
from strands.handlers.callback_handler import null_callback_handler

from agent_core import whatsapp_store as store
from agent_core.agent import OutputGuardHook, build_agent
from agent_core.config import runtime_config
from agent_core.safety import CANARY, OutputChecker
from agent_core.tools import build_tools, perform_handoff
from agent_core.tools.business_api import BusinessApiTools
from agent_core.tools.handoff import HandoffTools


class FakeTables:
    def __init__(self):
        self.conversations = mock.MagicMock()
        self.conversations.update_item.return_value = {
            "Attributes": {"phone": PHONE, "mode": "human", "search_key": "x", "inbox": "all", "unread_count": 2, "agent_turns": 4}
        }
        self.messages = mock.MagicMock()

    def table(self, name, region):
        return {"conversations": self.conversations, "messages": self.messages}[name]


def handoff_env():
    return agent_env(
        WHATSAPP_CONVERSATIONS_TABLE_NAME="conversations",
        WHATSAPP_MESSAGES_TABLE_NAME="messages",
        APPSYNC_GRAPHQL_URL="https://example.appsync-api.us-east-1.amazonaws.com/graphql",
        WHATSAPP_ADMIN_GROUP="admin",
    )


class HandoffTest(unittest.TestCase):
    def test_handoff_writes_mode_notice_and_events(self):
        tables = FakeTables()
        with handoff_env(), mock.patch.object(store, "_table", side_effect=tables.table), mock.patch.object(
            store, "publish", return_value=True
        ) as publish:
            self.assertTrue(perform_handoff(runtime_config(), PHONE, "  Quiere   hablar con una persona "))

        update = tables.conversations.update_item.call_args.kwargs
        self.assertEqual(update["Key"], {"phone": PHONE})
        self.assertEqual(update["ExpressionAttributeNames"], {"#mode": "mode"})
        self.assertEqual(update["ExpressionAttributeValues"][":mode"], "human")
        self.assertEqual(update["ExpressionAttributeValues"][":by"], "agent")
        self.assertIn("REMOVE agent_blocked_since, agent_blocked_count", update["UpdateExpression"])
        self.assertEqual(update["ExpressionAttributeValues"][":reason"], "Quiere hablar con una persona")
        self.assertIn("SET #mode = :mode", update["UpdateExpression"])
        self.assertEqual(update["ConditionExpression"], "attribute_exists(phone)")

        notice = tables.messages.put_item.call_args.kwargs["Item"]
        self.assertEqual(notice["phone"], PHONE)
        self.assertEqual(notice["direction"], "internal")
        self.assertEqual(notice["type"], "event")
        self.assertEqual(
            notice["payload"],
            {"kind": "agent_handoff", "by": "Agente IA", "reason": "Quiere hablar con una persona", "group": "admin"},
        )

        events = [(call.args[2], call.args[3]) for call in publish.call_args_list]
        self.assertEqual(
            events,
            [(PHONE, "CONTROL_CHANGED"), ("inbox", "CONVERSATION_UPDATED"), (PHONE, "CONVERSATION_EVENT")],
        )
        inbox_payload = publish.call_args_list[1].kwargs["payload"]
        self.assertEqual(inbox_payload["unreadCount"], 2)
        self.assertNotIn("search_key", inbox_payload)
        self.assertNotIn("agent_turns", inbox_payload)

    def test_unknown_conversation_is_not_created(self):
        tables = FakeTables()
        tables.conversations.update_item.side_effect = ClientError(
            {"Error": {"Code": "ConditionalCheckFailedException", "Message": "no"}}, "UpdateItem"
        )
        with handoff_env(), mock.patch.object(store, "_table", side_effect=tables.table), mock.patch.object(
            store, "publish"
        ) as publish:
            self.assertFalse(perform_handoff(runtime_config(), PHONE, "motivo"))
        publish.assert_not_called()
        tables.messages.put_item.assert_not_called()

    def test_tool_reports_failure_and_does_not_flag_the_turn(self):
        with handoff_env(), mock.patch("agent_core.tools.handoff.perform_handoff", return_value=False):
            tools = HandoffTools(runtime_config(), PHONE)
            result = tools.request_human_handoff(reason="motivo")
        self.assertIn("could not be completed", result)
        self.assertFalse(tools.triggered)

    def test_tool_is_bound_to_the_request_phone(self):
        with handoff_env(), mock.patch("agent_core.tools.handoff.perform_handoff", return_value=True) as handoff:
            tools = HandoffTools(runtime_config(), PHONE)
            tools.request_human_handoff(reason="motivo")
            tools.request_human_handoff(reason="otra vez")
        handoff.assert_called_once()
        self.assertEqual(handoff.call_args.args[1], PHONE)
        self.assertTrue(tools.triggered)


class BusinessApiToolTest(unittest.TestCase):
    def test_get_only_relative_paths_truncated_and_wrapped(self):
        tool = BusinessApiTools("https://api.example.com/v1")
        response = mock.MagicMock()
        response.read.return_value = ("x" * 5000).encode()
        response.__enter__.return_value = response
        with mock.patch("agent_core.tools.business_api.urlopen", return_value=response) as urlopen:
            result = tool.call_business_api(path="orders/4821", params={"fields": "status"})
        request = urlopen.call_args.args[0]
        self.assertEqual(request.get_method(), "GET")
        self.assertEqual(request.full_url, "https://api.example.com/v1/orders/4821?fields=status")
        self.assertEqual(urlopen.call_args.kwargs["timeout"], 10)
        self.assertTrue(result.startswith('<tool_output source="business_api">'))
        self.assertIn("[truncated]", result)
        self.assertLess(len(result), 4200)

    def test_rejects_other_hosts_and_traversal(self):
        tool = BusinessApiTools("https://api.example.com/v1")
        with mock.patch("agent_core.tools.business_api.urlopen") as urlopen:
            for path in ("https://evil.example.com/x", "../admin", "a/../../b", r"a\b"):
                with self.subTest(path=path):
                    self.assertIn("Invalid path", tool.call_business_api(path=path))
        urlopen.assert_not_called()

    def test_registered_only_when_configured(self):
        with agent_env():
            names = [t.tool_name for t in build_tools(runtime_config(), mock.MagicMock(timezone="UTC"), "web", "").tools]
        self.assertEqual(names, ["get_current_datetime"])


class OutputGuardHookTest(unittest.TestCase):
    def test_leaking_message_is_replaced_before_entering_the_history(self):
        guard = OutputGuardHook(OutputChecker([]), "No puedo compartir eso.")
        model = FakeModel([text(f"mi codigo es {CANARY}")])
        with agent_env(), support.patch_model(model):
            agent = build_agent(runtime_config(), [], None, system_prompt="sys", hooks=[guard])
            result = agent("hola")
        self.assertEqual(guard.leak_reason, "canary")
        self.assertEqual(agent.messages[-1]["content"], [{"text": "No puedo compartir eso."}])
        self.assertEqual(result.message["content"][0]["text"], "No puedo compartir eso.")

    def test_agent_is_built_without_the_printing_callback(self):
        with agent_env(MODEL_TEMPERATURE="0", MODEL_MAX_TOKENS="500"):
            agent = build_agent(runtime_config(), [], None, system_prompt="sys")
        config = agent.model.get_config()
        self.assertEqual(config["model_id"], "us.anthropic.claude-sonnet-4-6")
        self.assertEqual(config["temperature"], 0.0)
        self.assertEqual(config["max_tokens"], 500)
        self.assertEqual(config["cache_config"].strategy, "auto")
        self.assertEqual(agent.conversation_manager.window_size, 20)
        self.assertIs(agent.callback_handler, null_callback_handler)


if __name__ == "__main__":
    unittest.main()
