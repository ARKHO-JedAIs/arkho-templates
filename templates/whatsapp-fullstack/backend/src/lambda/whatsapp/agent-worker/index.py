"""agent-worker: answers the WhatsApp messages ws-handler queued for the AI agent.

One SQS FIFO job per customer message (``{phone, message_id, text, user_name,
session_id, actor_id, origination_phone_number_id}``), one at a time per
customer. For each job:

1. skips it when a person took the conversation or WhatsApp's 24 hour window
   closed (only a template could reach the customer then),
2. invokes the agent: AgentCore Runtime (``AGENT_RUNTIME_ARN``) or its Lambda
   variant (``AGENT_FUNCTION_NAME``), with the payload backend/agent expects,
3. sends the reply as text and stores it as ``sent_by: agent`` (the web labels
   it "Agente IA"), announcing it live,
4. ``blocked`` (off-topic) turns are counted: the third one in 24 hours hands
   the conversation to a person,
5. when the agent fails, the conversation goes to a person with an internal
   notice; the customer never gets an error.

``handoff: true`` means the agent's own handoff tool already handed the
conversation over; its reply (the handoff message) is still sent.

Only a failure before the agent is called (reading the conversation) raises,
so SQS retries the job; after two attempts it lands in the dead-letter queue.
"""
import json
import os
from traceback import format_exc

import boto3
from botocore.config import Config

from common import get_logger
from common.whatsapp import agent, config, messaging, realtime, store

logger = get_logger(__name__)

AGENT_RUNTIME_ARN = os.environ.get("AGENT_RUNTIME_ARN", "")
AGENT_FUNCTION_NAME = os.environ.get("AGENT_FUNCTION_NAME", "")
# AgentCore's DEFAULT endpoint always serves the latest runtime version.
QUALIFIER = "DEFAULT"
CHANNEL = "whatsapp"
# blocked_category of an agent switched off in its prompt parameter.
AGENT_DISABLED = "agent_disabled"
# Only abuse counts towards handing the customer to a person: an empty or
# over-long message is a mistake, not an offence. Mirrors OFFENSE_CATEGORIES
# in agent/src/agent_core/safety/rules.py (the agent image is not importable here).
OFFENSE_CATEGORIES = frozenset(
    {"prompt_injection", "sexual", "sexual_minors", "harassment_hate", "violence_threats", "output_leak"}
)

# Below the worker's own timeout (150 s), so a stuck agent ends as a handoff
# instead of a Lambda timeout that SQS would retry.
AGENTCORE_READ_TIMEOUT = 110
LAMBDA_READ_TIMEOUT = 125

_clients: dict = {}


class AgentFailed(RuntimeError):
    """The agent could not produce a usable answer."""


def _client(name: str, read_timeout: int):
    if name not in _clients:
        # No retries: a retried turn would run the agent (and its tools) twice.
        _clients[name] = boto3.client(
            name,
            config=Config(read_timeout=read_timeout, connect_timeout=5, retries={"mode": "standard", "total_max_attempts": 1}),
        )
    return _clients[name]


def _parse(raw: bytes | str) -> dict:
    """The agent's JSON answer; from a server-sent stream, its last ``data:`` event."""
    text = raw.decode("utf-8") if isinstance(raw, bytes) else str(raw or "")
    try:
        result = json.loads(text)
    except ValueError:
        events = [line[5:].strip() for line in text.splitlines() if line.startswith("data:")]
        try:
            result = json.loads(events[-1]) if events else None
        except ValueError:
            result = None
    if isinstance(result, str):
        try:
            result = json.loads(result)
        except ValueError:
            pass
    if not isinstance(result, dict):
        raise AgentFailed("The agent did not answer with a JSON object")
    return result


def invoke_agent(job: dict) -> dict:
    payload = json.dumps(
        {
            "prompt": job.get("text", ""),
            "actor_id": job.get("actor_id") or agent.actor_id(job["phone"]),
            "session_id": job["session_id"],
            "channel": CHANNEL,
            "user_name": job.get("user_name", ""),
            # Not part of the memory identity (actor_id is a hash): only the
            # agent's handoff tool uses it, to find the conversation.
            "phone": job["phone"],
        },
        ensure_ascii=False,
    ).encode("utf-8")
    if AGENT_RUNTIME_ARN:
        response = _client("bedrock-agentcore", AGENTCORE_READ_TIMEOUT).invoke_agent_runtime(
            agentRuntimeArn=AGENT_RUNTIME_ARN,
            qualifier=QUALIFIER,
            runtimeSessionId=job["session_id"],
            contentType="application/json",
            accept="application/json",
            payload=payload,
        )
        return _parse(response["response"].read())
    if AGENT_FUNCTION_NAME:
        response = _client("lambda", LAMBDA_READ_TIMEOUT).invoke(
            FunctionName=AGENT_FUNCTION_NAME,
            InvocationType="RequestResponse",
            Payload=payload,
        )
        body = response["Payload"].read()
        if response.get("FunctionError"):
            raise AgentFailed(f"The agent Lambda failed: {body[:500]!r}")
        return _parse(body)
    raise AgentFailed("Neither AGENT_RUNTIME_ARN nor AGENT_FUNCTION_NAME is set")


def send_reply(job: dict, text: str, sent_by: str = agent.SENT_BY_AGENT) -> None:
    phone = job["phone"]
    message_id = messaging.send_text(phone, text, job.get("origination_phone_number_id") or None)
    # The reply already reached the customer: a failure from here on is only logged.
    try:
        sent = store.save_message(
            phone,
            store.OUTBOUND,
            "text",
            text,
            message_id=message_id,
            sent_by=sent_by,
            status="sent",
        )
        realtime.announce_message(realtime.MESSAGE_SENT, sent, store.touch_conversation(sent))
    except Exception:  # noqa: BLE001
        logger.error("Reply to %s sent but not stored", phone[-4:])
        logger.error(format_exc())


def fail(job: dict) -> None:
    """Hands the conversation to a person; the customer gets nothing technical."""
    try:
        agent.hand_to_person(job["phone"], agent.AGENT_FAILED, agent.FAILED_NOTICE)
    except Exception:  # noqa: BLE001
        logger.error("Could not hand %s to a person", job["phone"][-4:])
        logger.error(format_exc())


def process(job: dict) -> str:
    """Answers one job; returns what happened, for the log and the tests."""
    phone = job["phone"]
    conversation = store.get_conversation(phone)
    if store.is_answered_by_person(conversation):
        return "skipped_human"
    if not store.window_open(conversation):
        return "skipped_window"

    try:
        result = invoke_agent(job)
    except Exception:  # noqa: BLE001
        logger.error("The agent failed for %s", phone[-4:])
        logger.error(format_exc())
        fail(job)
        return "failed"

    status = str(result.get("status") or "")
    reply = str(result.get("response") or "").strip()
    handoff = result.get("handoff") is True
    if result.get("blocked_category") == AGENT_DISABLED:
        # Switched off after ws-handler queued the job: answer as it would now.
        try:
            fallback = config.auto_reply_message()
            if fallback:
                send_reply(job, fallback, sent_by="assistant")
        except Exception:  # noqa: BLE001
            logger.error(format_exc())
        return "skipped_disabled"
    if status not in ("ok", "blocked") or (not reply and not handoff):
        logger.error("Unusable agent answer for %s: status %s", phone[-4:], status or "missing")
        fail(job)
        return "failed"
    if result.get("usage"):
        logger.info("Agent usage: %s", json.dumps(result["usage"], default=str))

    # A person may have taken the conversation while the agent was thinking.
    if not handoff and store.is_answered_by_person(store.get_conversation(phone)):
        return "skipped_human"

    if reply:
        try:
            send_reply(job, reply)
        except Exception:  # noqa: BLE001
            logger.error("Could not send the agent reply to %s", phone[-4:])
            logger.error(format_exc())
            fail(job)
            return "failed"

    if status == "blocked" and not handoff:
        if result.get("blocked_category") not in OFFENSE_CATEGORIES:
            return "blocked"
        try:
            if agent.record_blocked(phone) >= agent.BLOCKED_LIMIT:
                agent.hand_to_person(phone, agent.AGENT_HANDOFF, agent.BLOCKED_NOTICE)
                return "blocked_handoff"
        except Exception:  # noqa: BLE001
            logger.error(format_exc())
        return "blocked"
    return "handoff" if handoff else "answered"


def handler(event, context):
    for record in event.get("Records", []):
        try:
            job = json.loads(record.get("body") or "{}")
        except ValueError:
            # Malformed for good: retrying cannot fix it.
            logger.error("Agent job %s is not JSON", record.get("messageId"))
            continue
        if not isinstance(job, dict) or not job.get("phone") or not job.get("session_id"):
            logger.error("Agent job %s has no phone or session", record.get("messageId"))
            continue
        outcome = process(job)
        logger.info("Agent job for %s: %s", job["phone"][-4:], outcome)
    return {"status": "processed"}
