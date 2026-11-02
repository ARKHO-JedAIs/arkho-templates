"""The minimal slice of the WhatsApp tables and realtime events the agent needs.

Copied from ``src/layer/python-common/python/common/whatsapp`` (``store.py``
and ``realtime.py``) because the agent image does not include that Lambda
layer. Keep the attribute names, notice shape and event names in sync with
it: the web inbox reads what is written here exactly as it reads what the
``put-control`` Lambda writes.
"""
import json
import logging
from datetime import datetime, timezone
from functools import lru_cache
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

import boto3
from botocore.auth import SigV4Auth
from botocore.awsrequest import AWSRequest
from botocore.exceptions import ClientError

logger = logging.getLogger(__name__)

HUMAN_MODE = "human"
INTERNAL = "internal"
EVENT_TYPE = "event"
AGENT_HANDOFF = "agent_handoff"
# Same values as ``common.whatsapp.agent.AGENT_BY`` / ``AGENT_NAME``.
AGENT_ACTOR = "agent"
AGENT_ACTOR_NAME = "Agente IA"
# Inbox and agent bookkeeping the web does not get (``store.INTERNAL_KEYS``).
INTERNAL_KEYS = (
    "search_key",
    "inbox",
    "agent_turn_hour",
    "agent_turns",
    "agent_rate_notice_hour",
    "agent_blocked_since",
    "agent_blocked_count",
)

INBOX_CHANNEL = "inbox"
CONTROL_CHANGED = "CONTROL_CHANGED"
CONVERSATION_EVENT = "CONVERSATION_EVENT"
CONVERSATION_UPDATED = "CONVERSATION_UPDATED"
TIMEOUT_SECONDS = 5

PUBLISH_EVENT = """
mutation PublishEvent($id: ID!, $type: String!, $message: String, $payload: AWSJSON) {
  publishEvent(id: $id, type: $type, message: $message, payload: $payload) {
    id
    type
    timestamp
  }
}
"""


class ConversationNotFound(Exception):
    pass


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds")


@lru_cache(maxsize=4)
def _table(name: str, region: str):
    return boto3.resource("dynamodb", region_name=region).Table(name)


def set_human_mode(conversations_table: str, region: str, phone: str, reason: str) -> dict:
    """Hands the conversation to a person, as ``agent.hand_to_person`` in the layer does.

    The blocked-turns counter starts over, so the agent gets a clean slate if
    a person hands the conversation back. The condition keeps a wrong phone
    from creating a half-empty item that the inbox would then list.
    """
    try:
        response = _table(conversations_table, region).update_item(
            Key={"phone": phone},
            UpdateExpression=(
                "SET #mode = :mode, taken_by = :by, taken_by_name = :name, taken_at = :at, handoff_reason = :reason "
                "REMOVE agent_blocked_since, agent_blocked_count"
            ),
            ConditionExpression="attribute_exists(phone)",
            ExpressionAttributeNames={"#mode": "mode"},
            ExpressionAttributeValues={
                ":mode": HUMAN_MODE,
                ":by": AGENT_ACTOR,
                ":name": AGENT_ACTOR_NAME,
                ":at": now_iso(),
                ":reason": reason,
            },
            ReturnValues="ALL_NEW",
        )
    except ClientError as error:
        if (getattr(error, "response", None) or {}).get("Error", {}).get("Code") == "ConditionalCheckFailedException":
            raise ConversationNotFound(phone) from error
        raise
    return response.get("Attributes", {})


def save_handoff_notice(messages_table: str, region: str, phone: str, reason: str, group: str = "") -> dict:
    """An internal notice (``type: event``) in the conversation, like put-control's takeover notices."""
    payload = {"kind": AGENT_HANDOFF, "by": AGENT_ACTOR_NAME, "reason": reason}
    if group:
        payload["group"] = group
    item = {
        "phone": phone,
        "date": now_iso(),
        "direction": INTERNAL,
        "type": EVENT_TYPE,
        "message": f"El Agente IA derivó la conversación a una persona: {reason}",
        "payload": payload,
    }
    _table(messages_table, region).put_item(Item=item)
    return item


def conversation_view(item: dict | None) -> dict:
    """A conversation as the web gets it: ``unreadCount`` as a number, no internals."""
    if not item:
        return {}
    view = {key: value for key, value in item.items() if key not in INTERNAL_KEYS}
    try:
        view["unreadCount"] = max(int(item.get("unread_count") or 0), 0)
    except (TypeError, ValueError):
        view["unreadCount"] = 0
    return view


def publish(url: str, region: str, channel: str, event_type: str, payload: dict | None = None, message: str | None = None) -> bool:
    """Publishes one AppSync event signed with the role (SigV4). Never raises."""
    if not url:
        logger.warning("APPSYNC_GRAPHQL_URL is not set: %s not published", event_type)
        return False
    body = json.dumps(
        {
            "query": PUBLISH_EVENT,
            "variables": {
                "id": channel,
                "type": event_type,
                "message": message,
                # AWSJSON travels as a JSON string; default=str covers Decimal.
                "payload": json.dumps(payload, default=str) if payload is not None else None,
            },
        }
    ).encode("utf-8")
    try:
        session = boto3.Session(region_name=region)
        signed = AWSRequest(method="POST", url=url, data=body, headers={"Content-Type": "application/json"})
        SigV4Auth(session.get_credentials().get_frozen_credentials(), "appsync", region).add_auth(signed)
        request = Request(url, data=body, headers=dict(signed.headers), method="POST")
        with urlopen(request, timeout=TIMEOUT_SECONDS) as response:
            result = json.loads(response.read().decode("utf-8"))
        if result.get("errors"):
            logger.error("AppSync rejected %s: %s", event_type, json.dumps(result["errors"]))
            return False
    except (HTTPError, URLError, OSError, ValueError, AttributeError) as error:
        logger.error("Could not publish %s: %s", event_type, error)
        return False
    return True
