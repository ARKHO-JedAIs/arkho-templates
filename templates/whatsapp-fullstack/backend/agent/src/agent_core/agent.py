"""Building the Strands agent: model, hooks and conversation window."""
import logging

from strands import Agent
from strands.agent.conversation_manager import SlidingWindowConversationManager
from strands.hooks import AfterModelCallEvent, BeforeInvocationEvent, BeforeToolCallEvent, HookProvider, HookRegistry
from strands.models import BedrockModel, CacheConfig

from .config import RuntimeConfig
from .safety import OutputChecker

logger = logging.getLogger(__name__)

WINDOW_SIZE = 20


def build_model(config: RuntimeConfig) -> BedrockModel:
    """CacheConfig "auto" only caches when Strands knows the model supports it (Claude on Bedrock)."""
    return BedrockModel(
        model_id=config.model_id,
        region_name=config.region,
        max_tokens=config.max_tokens,
        temperature=config.temperature,
        cache_config=CacheConfig(strategy="auto"),
    )


class ToolLimitHook(HookProvider):
    """Caps the tool calls of one turn; the extra ones are cancelled with a note so the model answers."""

    def __init__(self, max_calls: int):
        self.max_calls = max_calls
        self.calls = 0

    def register_hooks(self, registry: HookRegistry, **kwargs) -> None:
        registry.add_callback(BeforeInvocationEvent, self._reset)
        registry.add_callback(BeforeToolCallEvent, self._count)

    def _reset(self, event: BeforeInvocationEvent) -> None:
        self.calls = 0

    def _count(self, event: BeforeToolCallEvent) -> None:
        self.calls += 1
        if self.calls > self.max_calls:
            event.cancel_tool = (
                "Tool call limit reached for this turn. Answer the user now with the information you already have."
            )


class OutputGuardHook(HookProvider):
    """Replaces a leaking model message before it is added to the history.

    It runs on AfterModelCallEvent, before the message is appended and before
    the session manager persists it, so a leak never reaches the memory either.
    The message is edited in place because the event exposes it read-only.
    """

    def __init__(self, checker: OutputChecker, refusal: str):
        self.checker = checker
        self.refusal = refusal
        self.leak_reason: str | None = None

    def register_hooks(self, registry: HookRegistry, **kwargs) -> None:
        registry.add_callback(AfterModelCallEvent, self._check)

    def _check(self, event: AfterModelCallEvent) -> None:
        if event.stop_response is None:
            return
        message = event.stop_response.message
        text = "".join(block.get("text", "") for block in message.get("content", []) if "text" in block)
        reason = self.checker.leak_reason(text)
        if reason is None:
            return
        self.leak_reason = reason
        logger.warning("Model output blocked: %s", reason)
        # Non-text blocks (a toolUse) stay so the event loop still sees the call it expects.
        message["content"] = [{"text": self.refusal}] + [
            block for block in message.get("content", []) if "text" not in block
        ]


def build_agent(config: RuntimeConfig, tools: list, session_manager=None, *, system_prompt, hooks=()) -> Agent:
    """``callback_handler=None`` because the default handler prints every token
    to stdout, which on AgentCore and Lambda is CloudWatch: the customers'
    messages and answers would end up in the logs."""
    return Agent(
        model=build_model(config),
        system_prompt=system_prompt,
        tools=tools,
        callback_handler=None,
        session_manager=session_manager,
        conversation_manager=SlidingWindowConversationManager(window_size=WINDOW_SIZE, should_truncate_results=True),
        hooks=[ToolLimitHook(config.max_tool_iterations), *hooks],
    )
