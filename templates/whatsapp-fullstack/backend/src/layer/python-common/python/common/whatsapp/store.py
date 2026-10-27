"""The conversations and messages tables.

Conversations: one item per contact, keyed by ``phone`` (E.164 digits, no
"+"). It carries the inbox summary (last message, when the contact last wrote)
and who answers it: ``mode`` is ``assistant`` (automatic replies) unless a
person took it over from the web (``human``).

Messages: the exchange itself, keyed by ``phone`` + ``date`` (ISO-8601 UTC with
milliseconds, so two messages in the same second do not overwrite each other).
"""
import os
from datetime import datetime, timedelta, timezone

import boto3
from boto3.dynamodb.conditions import Key

CONVERSATIONS_TABLE_NAME = os.environ.get("WHATSAPP_CONVERSATIONS_TABLE_NAME", "")
MESSAGES_TABLE_NAME = os.environ.get("WHATSAPP_MESSAGES_TABLE_NAME", "")

INBOUND = "inbound"
OUTBOUND = "outbound"
ASSISTANT_MODE = "assistant"
HUMAN_MODE = "human"

# WhatsApp only accepts free-form messages within 24 hours of the contact's
# last message; outside it, only an approved template can be sent.
SERVICE_WINDOW = timedelta(hours=24)

MESSAGES_PAGE_SIZE = 50

# Index names and the constant partition of the inbox index (WhatsAppFactory).
INBOX_INDEX = "by-recent"
INBOX_PARTITION = "all"
MESSAGE_ID_INDEX = "by-message-id"

# Delivery statuses in the order WhatsApp reports them. A late "delivered" must
# not overwrite a "read" that arrived first; "failed" always wins.
STATUS_RANK = {"sent": 1, "delivered": 2, "read": 3, "failed": 4}

_dynamodb = boto3.resource("dynamodb")
conversations_table = _dynamodb.Table(CONVERSATIONS_TABLE_NAME) if CONVERSATIONS_TABLE_NAME else None
messages_table = _dynamodb.Table(MESSAGES_TABLE_NAME) if MESSAGES_TABLE_NAME else None


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds")


def _require(table, name: str):
    if table is None:
        raise ValueError(f"{name} is not configured")
    return table


def get_conversation(phone: str) -> dict:
    table = _require(conversations_table, "WHATSAPP_CONVERSATIONS_TABLE_NAME")
    return table.get_item(Key={"phone": phone}).get("Item", {})


def list_conversations(limit: int = 500) -> list[dict]:
    """The most recent conversations first, through the inbox index (no scan)."""
    table = _require(conversations_table, "WHATSAPP_CONVERSATIONS_TABLE_NAME")
    items: list[dict] = []
    kwargs: dict = {
        "IndexName": INBOX_INDEX,
        "KeyConditionExpression": Key("inbox").eq(INBOX_PARTITION),
        "ScanIndexForward": False,
    }
    while len(items) < limit:
        response = table.query(**kwargs)
        items.extend(response.get("Items", []))
        if "LastEvaluatedKey" not in response:
            break
        kwargs["ExclusiveStartKey"] = response["LastEvaluatedKey"]
    return items[:limit]


def find_message_key(message_id: str) -> dict | None:
    """The table key of the message with this WhatsApp id, or None."""
    table = _require(messages_table, "WHATSAPP_MESSAGES_TABLE_NAME")
    response = table.query(
        IndexName=MESSAGE_ID_INDEX,
        KeyConditionExpression=Key("message_id").eq(message_id),
        Limit=1,
    )
    items = response.get("Items", [])
    if not items:
        return None
    return {"phone": items[0]["phone"], "date": items[0]["date"]}


def update_status(message_id: str, status: str, error: str = "") -> dict | None:
    """Records a delivery status on the stored message; None when it is unknown or older."""
    if status not in STATUS_RANK:
        return None
    key = find_message_key(message_id)
    if key is None:
        return None
    table = _require(messages_table, "WHATSAPP_MESSAGES_TABLE_NAME")
    current = table.get_item(Key=key).get("Item", {})
    if STATUS_RANK.get(str(current.get("status", "")), 0) >= STATUS_RANK[status]:
        return None
    names = {"#status": "status", "#status_at": "status_at"}
    values = {":status": status, ":status_at": now_iso()}
    expression = "SET #status = :status, #status_at = :status_at"
    if error:
        names["#error"] = "error"
        values[":error"] = error
        expression += ", #error = :error"
    return table.update_item(
        Key=key,
        UpdateExpression=expression,
        ExpressionAttributeNames=names,
        ExpressionAttributeValues=values,
        ReturnValues="ALL_NEW",
    ).get("Attributes")


def save_message(phone: str, direction: str, message_type: str, text: str = "", **extra) -> dict:
    """Appends one message to the contact's conversation and returns the item."""
    table = _require(messages_table, "WHATSAPP_MESSAGES_TABLE_NAME")
    item = {
        "phone": phone,
        "date": now_iso(),
        "direction": direction,
        "type": message_type,
    }
    if text:
        item["message"] = text
    item.update({key: value for key, value in extra.items() if value not in (None, "")})
    table.put_item(Item=item)
    return item


def list_messages(phone: str, before: str | None = None) -> list[dict]:
    """The last page of the conversation (oldest first), or the page before ``before``."""
    table = _require(messages_table, "WHATSAPP_MESSAGES_TABLE_NAME")
    condition = Key("phone").eq(phone)
    if before:
        condition = condition & Key("date").lt(before)
    response = table.query(
        KeyConditionExpression=condition,
        ScanIndexForward=False,
        Limit=MESSAGES_PAGE_SIZE,
    )
    return list(reversed(response.get("Items", [])))


def touch_conversation(message: dict, name: str = "") -> dict:
    """Updates the inbox summary with ``message`` and returns the conversation.

    New contacts start answered by the assistant. The name is the WhatsApp
    profile name, only known from what the contact sends.
    """
    table = _require(conversations_table, "WHATSAPP_CONVERSATIONS_TABLE_NAME")
    names = {
        "#last_message": "last_message",
        "#last_message_at": "last_message_at",
        "#last_direction": "last_direction",
        "#last_type": "last_type",
        "#mode": "mode",
        "#inbox": "inbox",
    }
    values = {
        ":last_message": message.get("message", ""),
        ":last_message_at": message["date"],
        ":last_direction": message["direction"],
        ":last_type": message["type"],
        ":assistant": ASSISTANT_MODE,
        ":inbox": INBOX_PARTITION,
    }
    expression = (
        "SET #last_message = :last_message, #last_message_at = :last_message_at, "
        "#last_direction = :last_direction, #last_type = :last_type, "
        "#mode = if_not_exists(#mode, :assistant), #inbox = :inbox"
    )
    if message["direction"] == INBOUND:
        names["#last_inbound_at"] = "last_inbound_at"
        values[":last_inbound_at"] = message["date"]
        expression += ", #last_inbound_at = :last_inbound_at"
        if message.get("message_id"):
            names["#last_inbound_message_id"] = "last_inbound_message_id"
            values[":last_inbound_message_id"] = message["message_id"]
            expression += ", #last_inbound_message_id = :last_inbound_message_id"
    if name:
        names["#name"] = "name"
        values[":name"] = name
        expression += ", #name = :name"
    response = table.update_item(
        Key={"phone": message["phone"]},
        UpdateExpression=expression,
        ExpressionAttributeNames=names,
        ExpressionAttributeValues=values,
        ReturnValues="ALL_NEW",
    )
    return response.get("Attributes", {})


def set_mode(phone: str, mode: str, taken_by: str = "", taken_by_name: str = "") -> dict:
    """Hands the conversation to a person (``human``) or back to the assistant."""
    table = _require(conversations_table, "WHATSAPP_CONVERSATIONS_TABLE_NAME")
    if mode == HUMAN_MODE:
        response = table.update_item(
            Key={"phone": phone},
            UpdateExpression="SET #mode = :mode, taken_by = :by, taken_by_name = :name, taken_at = :at",
            ExpressionAttributeNames={"#mode": "mode"},
            ExpressionAttributeValues={
                ":mode": HUMAN_MODE,
                ":by": taken_by,
                ":name": taken_by_name or taken_by,
                ":at": now_iso(),
            },
            ReturnValues="ALL_NEW",
        )
    else:
        response = table.update_item(
            Key={"phone": phone},
            UpdateExpression="SET #mode = :mode REMOVE taken_by, taken_by_name, taken_at",
            ExpressionAttributeNames={"#mode": "mode"},
            ExpressionAttributeValues={":mode": ASSISTANT_MODE},
            ReturnValues="ALL_NEW",
        )
    return response.get("Attributes", {})


def is_answered_by_person(conversation: dict) -> bool:
    return conversation.get("mode") == HUMAN_MODE


def window_open(conversation: dict, moment: datetime | None = None) -> bool:
    """Whether a free-form message can be sent: the contact wrote in the last 24 hours."""
    last_inbound = conversation.get("last_inbound_at")
    if not last_inbound:
        return False
    try:
        last = datetime.fromisoformat(str(last_inbound))
    except ValueError:
        return False
    return (moment or datetime.now(timezone.utc)) - last < SERVICE_WINDOW
