import json
import unittest
from unittest import mock

import support  # noqa: F401
from support import PHONE, FakeModel, agent_env, patch_model, text

from bedrock_agentcore.memory.integrations.strands.session_manager import AgentCoreMemorySessionManager
from strands.types.session import SessionMessage

from agent_core import config as agent_config
from agent_core import memory, turn
from agent_core.config import AgentSettings, load_settings, parse_settings, runtime_config


def session_message(role: str, content: list, message_id: int = 0) -> SessionMessage:
    return SessionMessage(message={"role": role, "content": content}, message_id=message_id)


def event(message: SessionMessage) -> dict:
    return {"eventId": "e", "payload": [{"conversational": {"content": {"text": json.dumps(message.to_dict())}, "role": "USER"}}]}


class MemoryBranchTest(unittest.TestCase):
    def test_no_memory_id_means_no_session_manager(self):
        with agent_env():
            self.assertIsNone(memory.build_session_manager(runtime_config(), PHONE, "s1"))
        with agent_env(AGENT_MEMORY_ID="mem-1", AGENT_MEMORY_MODE="off"):
            self.assertIsNone(memory.build_session_manager(runtime_config(), PHONE, "s1"))

    def test_turn_passes_no_session_manager_when_memory_is_off(self):
        model = FakeModel([text("ok")])
        with agent_env(), patch_model(model), mock.patch.object(memory, "CustomAgentCoreMemorySessionManager") as manager:
            turn.run_turn({"prompt": "mi pedido 4821", "actor_id": PHONE, "session_id": "s1"})
        manager.assert_not_called()

    def test_conversation_mode_builds_the_session_manager_without_long_term(self):
        with agent_env(AGENT_MEMORY_ID="mem-1"), mock.patch.object(memory, "CustomAgentCoreMemorySessionManager") as manager:
            built = memory.build_session_manager(runtime_config(), "+56911112222", "session 1")
        self.assertIs(built, manager.return_value)
        memory_config = manager.call_args.args[0]
        self.assertEqual(memory_config.memory_id, "mem-1")
        self.assertEqual(memory_config.actor_id, "56911112222")
        self.assertEqual(memory_config.session_id, "session-1")
        self.assertIsNone(memory_config.retrieval_config)
        self.assertTrue(memory_config.filter_restored_tool_context)
        self.assertIs(manager.call_args.kwargs["converter"], memory.SafeAgentCoreMemoryConverter)
        self.assertEqual(manager.call_args.kwargs["region_name"], "us-east-1")

    def test_facts_modes_add_long_term_namespaces(self):
        with agent_env(AGENT_MEMORY_ID="mem-1", AGENT_MEMORY_MODE="facts"), mock.patch.object(
            memory, "CustomAgentCoreMemorySessionManager"
        ) as manager:
            memory.build_session_manager(runtime_config(), PHONE, "s1")
        self.assertEqual(sorted(manager.call_args.args[0].retrieval_config), ["/facts/{actorId}", "/preferences/{actorId}"])
        with agent_env(AGENT_MEMORY_ID="mem-1", AGENT_MEMORY_MODE="facts_summaries"), mock.patch.object(
            memory, "CustomAgentCoreMemorySessionManager"
        ) as manager:
            memory.build_session_manager(runtime_config(), PHONE, "s1")
        self.assertEqual(
            sorted(manager.call_args.args[0].retrieval_config),
            ["/facts/{actorId}", "/preferences/{actorId}", "/summaries/{actorId}/{sessionId}"],
        )

    def test_turn_uses_the_session_manager_when_memory_is_on(self):
        model = FakeModel([text("ok")])
        with agent_env(AGENT_MEMORY_ID="mem-1"), patch_model(model), mock.patch.object(
            memory, "CustomAgentCoreMemorySessionManager"
        ) as manager, mock.patch("agent_core.agent.Agent") as agent_class:
            agent_class.return_value.return_value = mock.MagicMock(
                message={"role": "assistant", "content": [{"text": "ok"}]}
            )
            response = turn.run_turn({"prompt": "mi pedido 4821", "actor_id": PHONE, "session_id": "s1"})
        manager.assert_called_once()
        self.assertIs(agent_class.call_args.kwargs["session_manager"], manager.return_value)
        self.assertEqual(response["status"], "ok")

    def test_unknown_memory_mode_turns_memory_off(self):
        with agent_env(AGENT_MEMORY_ID="mem-1", AGENT_MEMORY_MODE="everything"):
            self.assertFalse(runtime_config().memory_enabled)


class MemoryFixesTest(unittest.TestCase):
    def test_tool_and_reasoning_blocks_are_not_persisted(self):
        manager = object.__new__(memory.CustomAgentCoreMemorySessionManager)
        message = session_message(
            "assistant",
            [{"text": "Reviso tu pedido"}, {"toolUse": {"toolUseId": "1", "name": "x", "input": {}}}, {"reasoningContent": {}}],
        )
        with mock.patch.object(AgentCoreMemorySessionManager, "create_message", return_value={"eventId": "e"}) as base:
            manager.create_message("s1", "agent", message)
        persisted = base.call_args.args[2].message["content"]
        self.assertEqual(persisted, [{"text": "Reviso tu pedido"}])

    def test_tool_only_messages_are_skipped(self):
        manager = object.__new__(memory.CustomAgentCoreMemorySessionManager)
        message = session_message("user", [{"toolResult": {"toolUseId": "1", "content": [{"text": "x"}]}}])
        with mock.patch.object(AgentCoreMemorySessionManager, "create_message") as base:
            self.assertIsNone(manager.create_message("s1", "agent", message))
        base.assert_not_called()

    def test_converter_ignores_foreign_events_instead_of_dropping_the_history(self):
        good = session_message("user", [{"text": "hola"}], 0)
        foreign = {"eventId": "f", "payload": [{"conversational": {"content": {"text": "plain text turn"}, "role": "USER"}}]}
        # AgentCore lists events newest first.
        messages = memory.SafeAgentCoreMemoryConverter.events_to_messages([foreign, event(good)])
        self.assertEqual([m.message["content"] for m in messages], [[{"text": "hola"}]])

    def test_converter_merges_consecutive_turns_of_the_same_role(self):
        first = session_message("assistant", [{"text": "Reviso"}], 1)
        second = session_message("assistant", [{"text": "Listo"}], 2)
        user = session_message("user", [{"text": "hola"}], 0)
        messages = memory.SafeAgentCoreMemoryConverter.events_to_messages([event(second), event(first), event(user)])
        self.assertEqual([m.message["role"] for m in messages], ["user", "assistant"])
        self.assertEqual(messages[1].message["content"], [{"text": "Reviso"}, {"text": "Listo"}])

    def test_memory_ids_are_sanitized(self):
        self.assertEqual(memory.memory_safe_id("+56 9 1111", "x"), "56-9-1111")
        self.assertEqual(memory.memory_safe_id("", "anonymous"), "anonymous")


class SettingsTest(unittest.TestCase):
    def test_runtime_defaults(self):
        with agent_env():
            config = runtime_config()
        self.assertEqual(config.model_id, "us.anthropic.claude-sonnet-4-6")
        self.assertEqual(config.max_tokens, 1000)
        self.assertEqual(config.temperature, 0.2)
        self.assertEqual(config.max_tool_iterations, 6)
        self.assertFalse(config.memory_enabled)

    def test_parse_settings_keeps_defaults_for_missing_or_invalid_keys(self):
        settings = parse_settings(json.dumps({"enabled": False, "businessName": "Salmones Sur", "greeting": "", "refusal": 3}))
        self.assertFalse(settings.enabled)
        self.assertEqual(settings.business_name, "Salmones Sur")
        self.assertEqual(settings.greeting, AgentSettings().greeting)
        self.assertEqual(settings.refusal, AgentSettings().refusal)
        self.assertEqual(parse_settings("not json"), AgentSettings())

    def test_load_settings_caches_for_a_minute(self):
        client = mock.MagicMock()
        client.get_parameter.return_value = {"Parameter": {"Value": json.dumps({"businessName": "Salmones Sur"})}}
        clock = mock.MagicMock(side_effect=[0.0, 30.0, 61.0])
        with agent_env(AGENT_PROMPT_PARAMETER_NAME="/p/agent"), mock.patch.object(
            agent_config, "_ssm_client", return_value=client
        ):
            config = runtime_config()
            self.assertEqual(load_settings(config, clock).business_name, "Salmones Sur")
            load_settings(config, clock)
            load_settings(config, clock)
        self.assertEqual(client.get_parameter.call_count, 2)
        client.get_parameter.assert_called_with(Name="/p/agent")

    def test_missing_parameter_falls_back_to_defaults(self):
        client = mock.MagicMock()
        client.get_parameter.side_effect = RuntimeError("ParameterNotFound")
        with agent_env(AGENT_PROMPT_PARAMETER_NAME="/p/missing"), mock.patch.object(
            agent_config, "_ssm_client", return_value=client
        ), self.assertLogs("agent_core.config", level="ERROR"):
            self.assertEqual(load_settings(runtime_config()), AgentSettings())


if __name__ == "__main__":
    unittest.main()
