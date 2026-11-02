"""Shared test helpers: import path, isolated environment and a scripted model.

``FakeModel`` replaces Bedrock: it answers each model call with the next
scripted turn (text or a tool call), so the real Strands event loop, hooks and
tools run without AWS.
"""
import copy
import json
import logging
import os
import sys
from unittest import mock

AGENT_SRC = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "src", "agent", "src"))
if AGENT_SRC not in sys.path:
    sys.path.insert(0, AGENT_SRC)

os.environ.setdefault("AWS_DEFAULT_REGION", "us-east-1")
# Fake credentials so nothing can reach a real account by accident.
os.environ["AWS_ACCESS_KEY_ID"] = "testing"
os.environ["AWS_SECRET_ACCESS_KEY"] = "testing"
os.environ.pop("AWS_PROFILE", None)
# A root handler keeps the entrypoints' basicConfig from printing every turn
# line during the run; assertLogs still captures what a test checks.
logging.getLogger().addHandler(logging.NullHandler())

from strands.models import Model  # noqa: E402

from agent_core import config as agent_config  # noqa: E402

AGENT_ENV_KEYS = (
    "MODEL_ID",
    "MODEL_MAX_TOKENS",
    "MODEL_TEMPERATURE",
    "AGENT_PROMPT_PARAMETER_NAME",
    "AGENT_MEMORY_ID",
    "AGENT_MEMORY_MODE",
    "AGENT_MEMORY_FACTS_NAMESPACE",
    "AGENT_MEMORY_SUMMARIES_NAMESPACE",
    "WHATSAPP_CONVERSATIONS_TABLE_NAME",
    "WHATSAPP_MESSAGES_TABLE_NAME",
    "APPSYNC_GRAPHQL_URL",
    "WHATSAPP_ADMIN_GROUP",
    "AGENT_BUSINESS_API_URL",
    "AGENT_MAX_TOOL_ITERATIONS",
)

PHONE = "56911112222"


def agent_env(**overrides):
    """A patch.dict with every agent variable blank unless overridden."""
    values = {key: "" for key in AGENT_ENV_KEYS}
    values.update({"AWS_REGION": "us-east-1", "AWS_DEFAULT_REGION": "us-east-1"})
    values.update(overrides)
    agent_config.clear_settings_cache()
    return mock.patch.dict(os.environ, values)


def text(value: str) -> tuple:
    return ("text", value)


def tool_call(name: str, arguments: dict | None = None) -> tuple:
    return ("tool", name, arguments or {})


class FakeModel(Model):
    def __init__(self, turns):
        self.turns = list(turns)
        self.calls: list[dict] = []
        self.config: dict = {}

    def update_config(self, **model_config):
        self.config.update(model_config)

    def get_config(self):
        return self.config

    async def structured_output(self, output_model, prompt, system_prompt=None, **kwargs):
        raise NotImplementedError
        yield  # pragma: no cover

    async def stream(self, messages, tool_specs=None, system_prompt=None, **kwargs):
        self.calls.append(
            {
                "messages": copy.deepcopy(messages),
                "system_prompt": system_prompt,
                "system_prompt_content": copy.deepcopy(kwargs.get("system_prompt_content")),
                "tool_names": [spec["name"] for spec in tool_specs or []],
            }
        )
        turn = self.turns.pop(0) if self.turns else text("(no more scripted turns)")
        yield {"messageStart": {"role": "assistant"}}
        if turn[0] == "text":
            for index in range(0, len(turn[1]), 40):
                yield {"contentBlockDelta": {"delta": {"text": turn[1][index : index + 40]}}}
            yield {"contentBlockStop": {}}
            yield {"messageStop": {"stopReason": "end_turn"}}
        else:
            _, name, arguments = turn
            tool_use_id = f"tool-{len(self.calls)}"
            yield {"contentBlockStart": {"start": {"toolUse": {"toolUseId": tool_use_id, "name": name}}}}
            yield {"contentBlockDelta": {"delta": {"toolUse": {"input": json.dumps(arguments)}}}}
            yield {"contentBlockStop": {}}
            yield {"messageStop": {"stopReason": "tool_use"}}
        yield {"metadata": {"usage": {"inputTokens": 10, "outputTokens": 5, "totalTokens": 15}, "metrics": {"latencyMs": 1}}}


def patch_model(model: FakeModel):
    return mock.patch("agent_core.agent.build_model", return_value=model)


def tool_results(model: FakeModel) -> list[str]:
    """The text of every toolResult the model received, in order."""
    found = []
    for call in model.calls:
        last = call["messages"][-1] if call["messages"] else {}
        for block in last.get("content", []):
            if "toolResult" in block:
                found.append(" ".join(item.get("text", "") for item in block["toolResult"].get("content", [])))
    return found
