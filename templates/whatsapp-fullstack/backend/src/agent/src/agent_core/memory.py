"""AgentCore Memory as the Strands session manager.

The session manager talks to AgentCore Memory through boto3, so it works the
same from the AgentCore Runtime and from Lambda. ``conversation`` keeps only
the short-term turns of the session; ``facts`` and ``facts_summaries`` also
retrieve long-term records from the namespaces the Memory strategies write.
"""
import json
import logging
import re
from typing import Any, Optional

from bedrock_agentcore.memory.integrations.strands.bedrock_converter import AgentCoreMemoryConverter
from bedrock_agentcore.memory.integrations.strands.config import AgentCoreMemoryConfig, RetrievalConfig
from bedrock_agentcore.memory.integrations.strands.session_manager import AgentCoreMemorySessionManager
from strands.types.session import SessionMessage

from .config import MEMORY_FACTS, MEMORY_FACTS_SUMMARIES, RuntimeConfig

logger = logging.getLogger(__name__)

_EXCLUDED_CONTENT_KEYS = ("toolUse", "toolResult", "reasoningContent")
_INVALID_ID_CHARS = re.compile(r"[^a-zA-Z0-9_/-]")
MAX_ID_CHARS = 100


def memory_safe_id(value: str, fallback: str) -> str:
    """AgentCore ids must start with a letter or digit and use only ``[a-zA-Z0-9_/-]``."""
    text = _INVALID_ID_CHARS.sub("-", str(value or "")).strip("-_/")[:MAX_ID_CHARS]
    return text or fallback


def _strip_excluded_content(message: dict) -> dict:
    content = message.get("content", [])
    return {**message, "content": [block for block in content if not any(key in block for key in _EXCLUDED_CONTENT_KEYS)]}


class CustomAgentCoreMemorySessionManager(AgentCoreMemorySessionManager):
    def create_message(
        self, session_id: str, agent_id: str, session_message: SessionMessage, **kwargs: Any
    ) -> Optional[dict[str, Any]]:
        # Persisting tool calls and reasoning makes a restored session replay
        # toolUse/toolResult pairs whose tools may no longer exist (or whose
        # pair was cut by the sliding window), which Bedrock rejects; it also
        # stores raw API data in long-term memory. Only the text is kept.
        session_message.message = _strip_excluded_content(session_message.message)
        if not session_message.message.get("content"):
            return None
        return super().create_message(session_id, agent_id, session_message, **kwargs)


def _merge_same_role(messages: list[SessionMessage]) -> list[SessionMessage]:
    merged: list[SessionMessage] = []
    for message in messages:
        if merged and merged[-1].message.get("role") == message.message.get("role"):
            previous = merged[-1]
            content = list(previous.message.get("content", [])) + list(message.message.get("content", []))
            message.message = {**message.message, "content": content}
            merged[-1] = message
        else:
            merged.append(message)
    return merged


class SafeAgentCoreMemoryConverter(AgentCoreMemoryConverter):
    @staticmethod
    def events_to_messages(events: list[dict]) -> list[SessionMessage]:
        # The base converter assumes every conversational event is a JSON
        # SessionMessage; one event written by anything else (e.g. add_turns
        # plain text) makes json.loads fail and the whole history is dropped.
        # Those events are skipped instead. Dropping tool-only messages on
        # write can leave two turns of the same role in a row, which Bedrock
        # rejects, so consecutive ones are merged.
        sanitized = []
        for event in events:
            payload = []
            for item in event.get("payload", []):
                conversational = item.get("conversational")
                if conversational is not None:
                    text = (conversational.get("content") or {}).get("text", "")
                    try:
                        data = json.loads(text)
                    except (json.JSONDecodeError, TypeError):
                        data = None
                    if not isinstance(data, dict) or "message" not in data:
                        logger.warning("Skipping a memory event that is not a Strands SessionMessage")
                        continue
                payload.append(item)
            if payload:
                sanitized.append({**event, "payload": payload})
        return _merge_same_role(AgentCoreMemoryConverter.events_to_messages(sanitized))


def retrieval_config(config: RuntimeConfig) -> dict[str, RetrievalConfig] | None:
    if config.memory_mode not in (MEMORY_FACTS, MEMORY_FACTS_SUMMARIES):
        return None
    namespaces = {
        config.facts_namespace: RetrievalConfig(top_k=5, relevance_score=0.3),
        config.preferences_namespace: RetrievalConfig(top_k=3, relevance_score=0.3),
    }
    if config.memory_mode == MEMORY_FACTS_SUMMARIES:
        namespaces[config.summaries_namespace] = RetrievalConfig(top_k=3, relevance_score=0.3)
    return namespaces


def build_session_manager(config: RuntimeConfig, actor_id: str, session_id: str):
    """The session manager for this actor and session, or None when memory is off."""
    if not config.memory_enabled:
        return None
    memory_config = AgentCoreMemoryConfig(
        memory_id=config.memory_id,
        actor_id=memory_safe_id(actor_id, "anonymous"),
        session_id=memory_safe_id(session_id, "default"),
        retrieval_config=retrieval_config(config),
        filter_restored_tool_context=True,
    )
    return CustomAgentCoreMemorySessionManager(
        memory_config,
        region_name=config.region,
        converter=SafeAgentCoreMemoryConverter,
    )
