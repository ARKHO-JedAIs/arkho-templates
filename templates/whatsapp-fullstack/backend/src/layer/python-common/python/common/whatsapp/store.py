"""The conversations and messages tables.

Conversations: one item per contact, keyed by ``phone`` (E.164 digits, no
"+"). It carries the inbox summary (last message, when the contact last wrote,
``unread_count``), ``search_key`` (the folded name and the phone, for the
inbox search) and who answers it: ``mode`` is ``assistant`` (automatic
replies) unless a person took it over from the web (``human``).

Messages: the exchange itself, keyed by ``phone`` + ``date`` (ISO-8601 UTC with
milliseconds, so two messages in the same second do not overwrite each other).
Besides what the contact and we send, ``direction: internal`` items are notices
of the inbox itself (``type: event``, e.g. a person took the conversation):
never sent to WhatsApp and never part of the inbox summary.
"""
import os
import re
import unicodedata
from datetime import datetime, timedelta, timezone
from decimal import Decimal

import boto3
from boto3.dynamodb.conditions import Key
from botocore.exceptions import ClientError

CONVERSATIONS_TABLE_NAME = os.environ.get("WHATSAPP_CONVERSATIONS_TABLE_NAME", "")
MESSAGES_TABLE_NAME = os.environ.get("WHATSAPP_MESSAGES_TABLE_NAME", "")

INBOUND = "inbound"
OUTBOUND = "outbound"
INTERNAL = "internal"
ASSISTANT_MODE = "assistant"
HUMAN_MODE = "human"

# The ``type`` of an internal notice and its ``payload.kind`` values.
EVENT_TYPE = "event"
HUMAN_TAKEOVER = "human_takeover"
ASSISTANT_RESUMED = "assistant_resumed"

SEARCH_RESULTS_LIMIT = 50
SEARCH_MIN_LENGTH = 2
# A scan reads the whole table page by page; this caps one search's cost.
SEARCH_MAX_PAGES = 20

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


def fold(text: str) -> str:
    """Lowercase without accents: ``"José Peña"`` -> ``"jose pena"``."""
    decomposed = unicodedata.normalize("NFD", str(text or ""))
    return "".join(char for char in decomposed if not unicodedata.combining(char)).lower().strip()


def search_key(name: str, phone: str) -> str:
    return f"{fold(name)} {phone}".strip()


def search_term(raw: str) -> str:
    """What a search looks for in ``search_key``: the phone digits when it is
    only a number (``"+56 9 1234"`` -> ``"5691234"``), else the folded text."""
    text = str(raw or "").strip()
    if re.fullmatch(r"[\d\s+\-().]+", text):
        return re.sub(r"\D", "", text)
    return fold(text)


def search_conversations(raw: str, limit: int = SEARCH_RESULTS_LIMIT) -> list[dict]:
    """Conversations whose name or phone contains the search, most recent first.

    A scan with a filter on ``search_key``: fine for an inbox of thousands of
    contacts; searching inside the messages needs a search engine instead.
    """
    table = _require(conversations_table, "WHATSAPP_CONVERSATIONS_TABLE_NAME")
    term = search_term(raw)
    if len(term) < SEARCH_MIN_LENGTH:
        return []
    items: list[dict] = []
    kwargs: dict = {
        "FilterExpression": "contains(#search_key, :term)",
        "ExpressionAttributeNames": {"#search_key": "search_key"},
        "ExpressionAttributeValues": {":term": term},
    }
    for _ in range(SEARCH_MAX_PAGES):
        response = table.scan(**kwargs)
        items.extend(response.get("Items", []))
        if len(items) >= limit or "LastEvaluatedKey" not in response:
            break
        kwargs["ExclusiveStartKey"] = response["LastEvaluatedKey"]
    items.sort(key=lambda item: str(item.get("last_message_at", "")), reverse=True)
    return items[:limit]


# Bookkeeping of the inbox and the AI agent the web does not need.
INTERNAL_KEYS = (
    "search_key",
    "inbox",
    "agent_turn_hour",
    "agent_turns",
    "agent_rate_notice_hour",
    "agent_blocked_since",
    "agent_blocked_count",
)


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


def mark_read(phone: str) -> dict | None:
    """Resets the unread counter; None when there is no such conversation."""
    table = _require(conversations_table, "WHATSAPP_CONVERSATIONS_TABLE_NAME")
    try:
        response = table.update_item(
            Key={"phone": phone},
            UpdateExpression="SET #unread = :zero",
            ConditionExpression="attribute_exists(phone)",
            ExpressionAttributeNames={"#unread": "unread_count"},
            ExpressionAttributeValues={":zero": 0},
            ReturnValues="ALL_NEW",
        )
    except ClientError as error:
        if (getattr(error, "response", None) or {}).get("Error", {}).get("Code") == "ConditionalCheckFailedException":
            return None
        raise
    return response.get("Attributes", {})


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


def to_dynamo(value):
    """``value`` with every float as a Decimal: the DynamoDB resource rejects floats."""
    if isinstance(value, bool):
        return value
    if isinstance(value, float):
        return Decimal(str(value))
    if isinstance(value, dict):
        return {key: to_dynamo(item) for key, item in value.items()}
    if isinstance(value, list):
        return [to_dynamo(item) for item in value]
    return value


def mark_message(message_id: str, **fields) -> dict | None:
    """Sets ``fields`` on the stored message with this WhatsApp id; None when it is unknown."""
    key = find_message_key(message_id)
    if key is None or not fields:
        return None
    table = _require(messages_table, "WHATSAPP_MESSAGES_TABLE_NAME")
    names = {f"#{name}": name for name in fields}
    values = {f":{name}": to_dynamo(value) for name, value in fields.items()}
    expression = "SET " + ", ".join(f"#{name} = :{name}" for name in fields)
    return table.update_item(
        Key=key,
        UpdateExpression=expression,
        ExpressionAttributeNames=names,
        ExpressionAttributeValues=values,
        ReturnValues="ALL_NEW",
    ).get("Attributes")


def set_reaction(message_id: str, emoji: str) -> dict | None:
    """The contact's reaction on one of the stored messages; an empty emoji removes it.

    A contact has one reaction per message, so a new one replaces the last.
    """
    key = find_message_key(message_id)
    if key is None:
        return None
    table = _require(messages_table, "WHATSAPP_MESSAGES_TABLE_NAME")
    if emoji:
        kwargs = {
            "UpdateExpression": "SET #reaction = :reaction",
            "ExpressionAttributeValues": {":reaction": {"emoji": emoji, "date": now_iso()}},
        }
    else:
        kwargs = {"UpdateExpression": "REMOVE #reaction"}
    return table.update_item(
        Key=key,
        ExpressionAttributeNames={"#reaction": "reaction"},
        ReturnValues="ALL_NEW",
        **kwargs,
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
    item.update({key: to_dynamo(value) for key, value in extra.items() if value not in (None, "")})
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


def save_notice(phone: str, kind: str, by: str, text: str) -> dict:
    """Stores an internal notice of the inbox (``type: event``) and returns it.

    It does not touch the conversation: a notice is neither the last message
    nor unread, and it never reopens the 24 hour window.
    """
    return save_message(phone, INTERNAL, EVENT_TYPE, text, payload={"kind": kind, "by": by})


def touch_conversation(message: dict, name: str = "", opens_window: bool = True, counts_unread: bool = False) -> dict:
    """Updates the inbox summary with ``message`` and returns the conversation.

    New contacts start answered by the assistant. The name is the WhatsApp
    profile name, only known from what the contact sends. An inbound message
    that is not the contact writing (a system notice) passes ``opens_window``
    False, so it does not reopen the 24 hour window. ``counts_unread`` adds one
    to ``unread_count`` atomically (customer content only); the web resets it
    when someone opens the conversation.
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
    if message["direction"] == INBOUND and opens_window:
        names["#last_inbound_at"] = "last_inbound_at"
        values[":last_inbound_at"] = message["date"]
        expression += ", #last_inbound_at = :last_inbound_at"
        if message.get("message_id"):
            names["#last_inbound_message_id"] = "last_inbound_message_id"
            values[":last_inbound_message_id"] = message["message_id"]
            expression += ", #last_inbound_message_id = :last_inbound_message_id"
    names["#search_key"] = "search_key"
    if name:
        names["#name"] = "name"
        values[":name"] = name
        values[":search_key"] = search_key(name, message["phone"])
        expression += ", #name = :name, #search_key = :search_key"
    else:
        # Keep the key a known name already wrote; a new contact gets its phone.
        values[":search_key"] = search_key("", message["phone"])
        expression += ", #search_key = if_not_exists(#search_key, :search_key)"
    if counts_unread:
        names["#unread"] = "unread_count"
        values[":one"] = 1
        expression += " ADD #unread :one"
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
