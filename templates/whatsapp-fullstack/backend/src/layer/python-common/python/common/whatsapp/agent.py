"""The AI agent's side of the inbox (AgentFactory), shared by ws-handler and agent-worker.

ws-handler queues each customer message on the ``agent-jobs`` FIFO queue
(``enqueue``) instead of sending the fixed automatic reply, once ``take_turn``
allows it; agent-worker invokes the agent and replies. Everything kept per
customer lives on the conversation item:

* ``agent_turn_hour`` / ``agent_turns`` - the hourly rate limit counter,
* ``agent_rate_notice_hour`` - the hour the "too many messages" notice went out,
* ``agent_blocked_since`` / ``agent_blocked_count`` - off-topic turns in 24 h.

The agent is switched on and off with ``enabled`` in its prompt parameter,
without a deploy; when it is off, the fixed automatic reply answers again.
"""
import hashlib
import json
import logging
import os
import time
from datetime import datetime, timedelta, timezone

import boto3
from botocore.exceptions import ClientError

from . import realtime, store

logger = logging.getLogger(__name__)

JOBS_QUEUE_URL = os.environ.get("AGENT_JOBS_QUEUE_URL", "")
PROMPT_PARAMETER_NAME = os.environ.get("AGENT_PROMPT_PARAMETER_NAME", "")
DEFAULT_RATE_LIMIT_PER_HOUR = 30

# A prompt parameter edit (the on/off switch) is picked up within this time.
ENABLED_CACHE_SECONDS = 60

BLOCKED_LIMIT = 3
BLOCKED_WINDOW = timedelta(hours=24)

# Who the inbox shows as having taken a conversation the agent handed over.
AGENT_BY = "agent"
AGENT_NAME = "Agente IA"
SENT_BY_AGENT = "agent"

# ``payload.kind`` of the internal notices the agent side writes.
AGENT_HANDOFF = "agent_handoff"
AGENT_FAILED = "agent_failed"

RATE_LIMITED_TEXT = (
    "Recibimos muchos mensajes seguidos. Te responderemos en un momento; "
    "si es urgente, una persona del equipo revisará la conversación."
)
FAILED_NOTICE = "El agente no pudo responder; la conversación quedó para una persona"
BLOCKED_NOTICE = "El agente derivó la conversación: varios mensajes fuera de tema en 24 horas"

_clients: dict = {}
_enabled_cache: dict = {"until": 0.0, "value": True}


def _client(name: str):
    if name not in _clients:
        _clients[name] = boto3.client(name)
    return _clients[name]


def _now(moment: datetime | None = None) -> datetime:
    return moment or datetime.now(timezone.utc)


def _conditional_failed(error: Exception) -> bool:
    return (getattr(error, "response", None) or {}).get("Error", {}).get("Code") == "ConditionalCheckFailedException"


def configured() -> bool:
    """Whether this deployment has an agent (AGENT_RUNTIME is not none)."""
    return bool(JOBS_QUEUE_URL)


def rate_limit_per_hour() -> int:
    try:
        return max(int(os.environ.get("AGENT_RATE_LIMIT_PER_HOUR") or DEFAULT_RATE_LIMIT_PER_HOUR), 1)
    except ValueError:
        return DEFAULT_RATE_LIMIT_PER_HOUR


def enabled() -> bool:
    """``enabled`` of the agent prompt parameter, re-read at most once a minute.

    A parameter that cannot be read counts as off, so the fixed automatic reply
    answers instead of queuing work for an agent that would fail the same way.
    """
    if not PROMPT_PARAMETER_NAME:
        return True
    if time.monotonic() < _enabled_cache["until"]:
        return _enabled_cache["value"]
    try:
        raw = _client("ssm").get_parameter(Name=PROMPT_PARAMETER_NAME)["Parameter"]["Value"]
        value = json.loads(raw).get("enabled", True) is not False
    except Exception as error:  # noqa: BLE001
        logger.error("Could not read %s: %s", PROMPT_PARAMETER_NAME, error)
        value = False
    _enabled_cache.update(until=time.monotonic() + ENABLED_CACHE_SECONDS, value=value)
    return value


def _digest(phone: str) -> str:
    return hashlib.sha256(phone.encode("utf-8")).hexdigest()


def session_id(phone: str, moment: datetime | None = None) -> str:
    """One agent session per customer and UTC day (36 characters).

    AgentCore requires a runtimeSessionId of at least 33 characters; the phone
    is hashed so it never reaches the runtime's logs.
    """
    return f"wa-{_digest(phone)[:24]}-{_now(moment):%Y%m%d}"


def actor_id(phone: str) -> str:
    """The customer as the agent's memory knows them, stable across sessions."""
    return f"wa-{_digest(phone)[:32]}"


def take_turn(phone: str, moment: datetime | None = None) -> bool:
    """Counts one agent turn for this customer; False when the hour's limit is spent.

    Atomic: the counter moves only through conditional updates, so two
    messages processed at once cannot both take the last turn.
    """
    table = store._require(store.conversations_table, "WHATSAPP_CONVERSATIONS_TABLE_NAME")
    hour = _now(moment).strftime("%Y%m%d%H")
    names = {"#hour": "agent_turn_hour", "#turns": "agent_turns"}
    # Two rounds cover a concurrent reset of the counter at the turn of the hour.
    for _ in range(2):
        try:
            table.update_item(
                Key={"phone": phone},
                UpdateExpression="SET #turns = #turns + :one",
                ConditionExpression="#hour = :hour AND #turns < :limit",
                ExpressionAttributeNames=names,
                ExpressionAttributeValues={":one": 1, ":hour": hour, ":limit": rate_limit_per_hour()},
            )
            return True
        except ClientError as error:
            if not _conditional_failed(error):
                raise
        try:
            table.update_item(
                Key={"phone": phone},
                UpdateExpression="SET #hour = :hour, #turns = :one",
                ConditionExpression="attribute_not_exists(#hour) OR #hour <> :hour",
                ExpressionAttributeNames=names,
                ExpressionAttributeValues={":one": 1, ":hour": hour},
            )
            return True
        except ClientError as error:
            if not _conditional_failed(error):
                raise
    return False


def claim_rate_notice(phone: str, moment: datetime | None = None) -> bool:
    """True once per hour and customer: whoever gets it sends the "too many messages" notice."""
    table = store._require(store.conversations_table, "WHATSAPP_CONVERSATIONS_TABLE_NAME")
    hour = _now(moment).strftime("%Y%m%d%H")
    try:
        table.update_item(
            Key={"phone": phone},
            UpdateExpression="SET #notice = :hour",
            ConditionExpression="attribute_not_exists(#notice) OR #notice <> :hour",
            ExpressionAttributeNames={"#notice": "agent_rate_notice_hour"},
            ExpressionAttributeValues={":hour": hour},
        )
        return True
    except ClientError as error:
        if _conditional_failed(error):
            return False
        raise


def enqueue(job: dict) -> None:
    """Queues one customer message for agent-worker.

    The message group is the phone, so a customer's turns run in order; the
    deduplication id is the WhatsApp message id, so a redelivered notification
    is not answered twice.
    """
    dedupe = job.get("message_id") or f"{job['phone']}-{time.time_ns()}"
    _client("sqs").send_message(
        QueueUrl=JOBS_QUEUE_URL,
        MessageBody=json.dumps(job, ensure_ascii=False),
        MessageGroupId=_digest(job["phone"])[:64],
        MessageDeduplicationId=hashlib.sha256(dedupe.encode("utf-8")).hexdigest(),
    )


def record_blocked(phone: str, moment: datetime | None = None) -> int:
    """Counts one off-topic turn; returns how many in the current 24 hour window."""
    table = store._require(store.conversations_table, "WHATSAPP_CONVERSATIONS_TABLE_NAME")
    now = _now(moment)
    names = {"#since": "agent_blocked_since", "#count": "agent_blocked_count"}
    try:
        response = table.update_item(
            Key={"phone": phone},
            UpdateExpression="ADD #count :one",
            ConditionExpression="#since > :cutoff",
            ExpressionAttributeNames=names,
            ExpressionAttributeValues={":one": 1, ":cutoff": (now - BLOCKED_WINDOW).isoformat(timespec="milliseconds")},
            ReturnValues="UPDATED_NEW",
        )
        return int(response.get("Attributes", {}).get("agent_blocked_count") or 1)
    except ClientError as error:
        if not _conditional_failed(error):
            raise
    table.update_item(
        Key={"phone": phone},
        UpdateExpression="SET #since = :now, #count = :one",
        ExpressionAttributeNames=names,
        ExpressionAttributeValues={":one": 1, ":now": now.isoformat(timespec="milliseconds")},
    )
    return 1


def hand_to_person(phone: str, kind: str, text: str) -> dict:
    """Takes the conversation away from the agent, with a notice everyone sees.

    The blocked-turns counter starts over, so the agent gets a clean slate if
    a person hands the conversation back.
    """
    conversation = store.set_mode(phone, store.HUMAN_MODE, AGENT_BY, AGENT_NAME)
    try:
        store._require(store.conversations_table, "WHATSAPP_CONVERSATIONS_TABLE_NAME").update_item(
            Key={"phone": phone},
            UpdateExpression="REMOVE agent_blocked_since, agent_blocked_count",
        )
    except Exception as error:  # noqa: BLE001
        logger.warning("Could not reset the blocked counter: %s", error)
    realtime.publish(phone, realtime.CONTROL_CHANGED, payload=store.conversation_view(conversation))
    realtime.announce_conversation(conversation)
    notice = store.save_notice(phone, kind, AGENT_NAME, text)
    realtime.publish(phone, realtime.CONVERSATION_EVENT, payload=notice, message=text)
    return conversation
