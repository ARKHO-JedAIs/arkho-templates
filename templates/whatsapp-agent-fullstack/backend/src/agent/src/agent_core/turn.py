"""One conversation turn: the invocation contract shared by both entrypoints.

Payload: ``{"prompt", "actor_id", "session_id", "channel", "user_name", "phone"?, "stream"?}``.
Response: ``{"status", "response", "handoff", "blocked_category", "usage"}``,
``status`` being ``ok``, ``blocked`` or ``error``. A turn never raises and never
returns a traceback: failures are logged and answered with a generic message.
"""
import asyncio
import hashlib
import json
import logging
import re
import time
from collections.abc import AsyncIterator
from dataclasses import dataclass
from datetime import datetime, timezone

from strands.types.exceptions import MaxTokensReachedException

from . import config as config_module
from .agent import OutputGuardHook, build_agent
from .config import AgentSettings, RuntimeConfig, load_settings, runtime_config, with_model
from .memory import build_session_manager
from .prompt import CHANNELS, FORMAT_RULES, WHATSAPP, build_system_prompt, fixed_rules, wrap_untrusted
from .safety import (
    BLOCKED,
    EMPTY_INPUT,
    GREETING,
    INPUT_TOO_LONG,
    OUTPUT_LEAK,
    SUPPORT,
    OutputChecker,
    check_input,
)
from .tools import RequestTools, build_tools, perform_handoff

logger = logging.getLogger("agent_core.turn")

STATUS_OK = "ok"
STATUS_BLOCKED = "blocked"
STATUS_ERROR = "error"
AGENT_DISABLED = "agent_disabled"
SELF_HARM_REASON = "Posible riesgo de autolesión: requiere atención de una persona"
TOO_BROAD_MESSAGE = "Tu consulta abarca demasiado para responderla en un solo mensaje. ¿Puedes acotarla un poco?"
# Characters held back while streaming, so a leak can still be stopped before
# the end of it reaches the client.
STREAM_HOLDBACK_CHARS = 200


@dataclass(frozen=True)
class TurnRequest:
    prompt: str
    actor_id: str
    session_id: str
    channel: str
    user_name: str | None
    stream: bool = False
    raw_phone: str = ""

    @property
    def phone(self) -> str:
        """The WhatsApp contact (key of the conversations table) the handoff acts on.

        Only the ``phone`` payload field counts: ``actor_id`` is a hash that
        identifies the memory and never stands for the phone.
        """
        candidate = self.raw_phone.strip()
        if self.channel == WHATSAPP and re.fullmatch(r"\+?\d{6,15}", candidate):
            return candidate.lstrip("+")
        return ""


def parse_request(payload) -> TurnRequest:
    data = payload if isinstance(payload, dict) else {}
    channel = str(data.get("channel") or WHATSAPP).strip().lower()
    actor_id = str(data.get("actor_id") or "").strip()
    session_id = str(data.get("session_id") or "").strip()
    if not session_id:
        session_id = f"{actor_id or 'anonymous'}-{datetime.now(timezone.utc).strftime('%Y%m%d')}"
    user_name = data.get("user_name")
    return TurnRequest(
        prompt=str(data.get("prompt") or ""),
        actor_id=actor_id,
        session_id=session_id,
        channel=channel if channel in CHANNELS else WHATSAPP,
        user_name=str(user_name) if user_name else None,
        stream=data.get("stream") is True,
        raw_phone=str(data.get("phone") or ""),
    )


def wants_stream(payload) -> bool:
    return isinstance(payload, dict) and payload.get("stream") is True


def make_response(
    status: str,
    response: str,
    handoff: bool = False,
    blocked_category: str | None = None,
    usage: dict | None = None,
) -> dict:
    return {
        "status": status,
        "response": response,
        "handoff": handoff,
        "blocked_category": blocked_category,
        "usage": usage,
    }


def error_response() -> dict:
    return make_response(STATUS_ERROR, config_module.GENERIC_ERROR_MESSAGE)


def hash_actor(actor_id: str) -> str:
    return hashlib.sha256(str(actor_id or "").encode("utf-8")).hexdigest()[:16]


def log_turn(request: TurnRequest, response: dict, started: float, extra: dict | None = None) -> None:
    """One structured line per turn. Never the message or the answer: they are customer data."""
    usage = response.get("usage") or {}
    record = {
        "event": "agent_turn",
        "actor": hash_actor(request.actor_id),
        "channel": request.channel,
        "status": response.get("status"),
        "category": response.get("blocked_category"),
        "handoff": response.get("handoff"),
        "input_tokens": usage.get("inputTokens"),
        "output_tokens": usage.get("outputTokens"),
        "duration_ms": int((time.perf_counter() - started) * 1000),
        "stream": request.stream,
    }
    if extra:
        record.update(extra)
    logger.info(json.dumps(record))


def _usage(result) -> dict | None:
    try:
        accumulated = result.metrics.accumulated_usage
        return {"inputTokens": int(accumulated["inputTokens"]), "outputTokens": int(accumulated["outputTokens"])}
    except (AttributeError, KeyError, TypeError, ValueError):
        return None


def _text(result) -> str:
    message = getattr(result, "message", None) or {}
    return "".join(block.get("text", "") for block in message.get("content", []) if "text" in block).strip()


@dataclass
class PreparedTurn:
    request: TurnRequest
    settings: AgentSettings
    agent: object
    tools: RequestTools
    checker: OutputChecker
    guard: OutputGuardHook
    prompt: str


def output_checker(settings: AgentSettings) -> OutputChecker:
    return OutputChecker([fixed_rules(settings.business_name), *FORMAT_RULES.values()])


def _early_response(request: TurnRequest, config: RuntimeConfig, settings: AgentSettings) -> dict | None:
    """The answer when the model must not be called, or None to call it."""
    if not settings.enabled:
        return make_response(STATUS_BLOCKED, "", blocked_category=AGENT_DISABLED)
    verdict = check_input(request.prompt)
    if verdict.action == GREETING:
        return make_response(STATUS_OK, settings.greeting)
    if verdict.action == SUPPORT:
        if request.phone:
            perform_handoff(config, request.phone, SELF_HARM_REASON)
        elif request.channel == WHATSAPP:
            logger.warning("Self-harm turn without a valid phone field: the conversation was not handed over")
        return make_response(STATUS_OK, settings.support_message, handoff=True, blocked_category=verdict.category)
    if verdict.action == BLOCKED:
        messages = {
            EMPTY_INPUT: config_module.EMPTY_INPUT_MESSAGE,
            INPUT_TOO_LONG: config_module.INPUT_TOO_LONG_MESSAGE,
        }
        return make_response(
            STATUS_BLOCKED, messages.get(verdict.category, settings.refusal), blocked_category=verdict.category
        )
    return None


def prepare_turn(request: TurnRequest) -> dict | PreparedTurn:
    config = runtime_config()
    settings = load_settings(config)
    early = _early_response(request, config, settings)
    if early is not None:
        return early
    system_prompt = build_system_prompt(settings, request.channel, request.user_name)
    checker = output_checker(settings)
    guard = OutputGuardHook(checker, settings.refusal)
    if request.channel == WHATSAPP and not request.phone:
        logger.warning("WhatsApp turn without a valid phone field: the handoff tool is disabled")
    tools = build_tools(config, settings, request.channel, request.phone)
    session_manager = build_session_manager(config, request.actor_id, request.session_id)
    model_config = with_model(config, settings)
    agent = build_agent(model_config, tools.tools, session_manager, system_prompt=system_prompt.blocks, hooks=[guard])
    return PreparedTurn(
        request=request,
        settings=settings,
        agent=agent,
        tools=tools,
        checker=checker,
        guard=guard,
        prompt=wrap_untrusted(request.prompt),
    )


def finish_turn(prepared: PreparedTurn, text: str, usage: dict | None) -> dict:
    settings = prepared.settings
    if prepared.guard.leak_reason or prepared.checker.leak_reason(text):
        return make_response(STATUS_BLOCKED, settings.refusal, blocked_category=OUTPUT_LEAK, usage=usage)
    if prepared.tools.handoff is not None and prepared.tools.handoff.triggered:
        return make_response(STATUS_OK, settings.handoff_message, handoff=True, usage=usage)
    if not text:
        logger.warning("The model returned no text")
        return make_response(STATUS_ERROR, config_module.GENERIC_ERROR_MESSAGE, usage=usage)
    return make_response(STATUS_OK, text, usage=usage)


def run_turn(payload) -> dict:
    """The non-streaming turn used by Lambda and by AgentCore without ``stream``."""
    started = time.perf_counter()
    request = parse_request(payload)
    try:
        prepared = prepare_turn(request)
        if isinstance(prepared, dict):
            response = prepared
        else:
            result = prepared.agent(prepared.prompt)
            response = finish_turn(prepared, _text(result), _usage(result))
    except MaxTokensReachedException:
        logger.warning("The answer hit MODEL_MAX_TOKENS")
        response = make_response(STATUS_OK, TOO_BROAD_MESSAGE)
    except Exception:  # noqa: BLE001
        logger.exception("Agent turn failed")
        response = error_response()
    log_turn(request, response, started)
    return response


class StreamGuard:
    """Releases streamed text only once it passed the output check, keeping a tail held back."""

    def __init__(self, checker: OutputChecker, holdback: int = STREAM_HOLDBACK_CHARS):
        self.checker = checker
        self.holdback = holdback
        self.text = ""
        self.sent = 0
        self.leaked = False

    def feed(self, delta: str) -> str:
        if self.leaked:
            return ""
        self.text += delta
        if self.checker.leak_reason(self.text):
            self.leaked = True
            return ""
        release_until = max(len(self.text) - self.holdback, self.sent)
        chunk = self.text[self.sent : release_until]
        self.sent = release_until
        return chunk

    def flush(self) -> str:
        if self.leaked or self.checker.leak_reason(self.text):
            self.leaked = True
            return ""
        chunk = self.text[self.sent :]
        self.sent = len(self.text)
        return chunk


async def stream_turn(payload) -> AsyncIterator[dict]:
    """The streaming turn (AgentCore with ``"stream": true``).

    Yields ``{"event": "chunk", "data": str}`` while the answer is generated,
    then one ``{"event": "done", "response": <contract response>}``, or
    ``{"event": "error", "response": <contract response>}``. The ``done``
    response is authoritative: when it is ``blocked`` or a handoff, the client
    replaces whatever chunks it already showed with ``response.response``.
    """
    started = time.perf_counter()
    request = parse_request(payload)
    response = None
    try:
        prepared = await asyncio.to_thread(prepare_turn, request)
        if isinstance(prepared, dict):
            response = prepared
        else:
            guard = StreamGuard(prepared.checker)
            result = None
            # On a leak the stream is drained, not broken: the turn must finish so
            # OutputGuardHook replaces the message before it enters the history.
            async for event in prepared.agent.stream_async(prepared.prompt):
                if "data" in event and isinstance(event["data"], str):
                    chunk = guard.feed(event["data"])
                    if chunk:
                        yield {"event": "chunk", "data": chunk}
                elif "result" in event:
                    result = event["result"]
            tail = guard.flush()
            if tail:
                yield {"event": "chunk", "data": tail}
            if guard.leaked:
                prepared.guard.leak_reason = prepared.guard.leak_reason or "stream"
            text = _text(result) if result is not None else guard.text.strip()
            response = finish_turn(prepared, text, _usage(result) if result is not None else None)
    except MaxTokensReachedException:
        logger.warning("The answer hit MODEL_MAX_TOKENS")
        response = make_response(STATUS_OK, TOO_BROAD_MESSAGE)
    except Exception:  # noqa: BLE001
        logger.exception("Agent streaming turn failed")
        response = error_response()
        log_turn(request, response, started)
        yield {"event": "error", "response": response}
        return
    log_turn(request, response, started)
    yield {"event": "done", "response": response}
