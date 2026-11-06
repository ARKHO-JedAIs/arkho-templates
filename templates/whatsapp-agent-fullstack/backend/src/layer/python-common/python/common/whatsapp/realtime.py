"""Publishing realtime events to the AppSync API the front subscribes to.

The call is signed with the function's IAM role (SigV4), so no API key is
deployed, and it goes out with urllib so no extra layer is needed. Nothing is
stored by AppSync: an event only reaches whoever is subscribed at that moment,
which is why every event announces something already written to DynamoDB.

Channels (the subscription's ``id``):

* the contact's phone - MESSAGE_RECEIVED, MESSAGE_SENT, TEMPLATE_SENT,
  MESSAGE_STATUS (sent / delivered / read / failed / deleted / warning),
  MESSAGE_UPDATED (a reaction added or removed), CONTROL_CHANGED and
  CONVERSATION_EVENT (an internal notice, e.g. a person took the
  conversation), with the stored item as payload (``media.key`` swapped for a
  presigned URL)
* ``inbox`` - CONVERSATION_UPDATED with the conversation summary (including
  ``unreadCount``), so the list of conversations reorders itself without polling
"""
import json
import logging
import os
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

import boto3
from botocore.auth import SigV4Auth
from botocore.awsrequest import AWSRequest

from . import store

logger = logging.getLogger(__name__)

APPSYNC_GRAPHQL_URL = os.environ.get("APPSYNC_GRAPHQL_URL", "")
TIMEOUT_SECONDS = 5

INBOX_CHANNEL = "inbox"
MESSAGE_RECEIVED = "MESSAGE_RECEIVED"
MESSAGE_SENT = "MESSAGE_SENT"
TEMPLATE_SENT = "TEMPLATE_SENT"
CONTROL_CHANGED = "CONTROL_CHANGED"
MESSAGE_STATUS = "MESSAGE_STATUS"
MESSAGE_UPDATED = "MESSAGE_UPDATED"
CONVERSATION_EVENT = "CONVERSATION_EVENT"
CONVERSATION_UPDATED = "CONVERSATION_UPDATED"

# AppSync sends subscribers only the fields this mutation selects: a field
# left out here (payload, message) reaches the web as null, and the web
# drops an event without its payload - live updates silently stop.
PUBLISH_EVENT = """
mutation PublishEvent($id: ID!, $type: String!, $message: String, $payload: AWSJSON) {
  publishEvent(id: $id, type: $type, message: $message, payload: $payload) {
    id
    type
    message
    payload
    timestamp
  }
}
"""

_session = boto3.Session()


def publish(channel: str, event_type: str, payload: dict | None = None, message: str | None = None) -> bool:
    """Publishes one event. Never raises: the exchange it announces already happened.

    Returns False when it could not be published (logged), so a caller that
    wants to can report it.
    """
    if not APPSYNC_GRAPHQL_URL:
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
        signed = AWSRequest(
            method="POST",
            url=APPSYNC_GRAPHQL_URL,
            data=body,
            headers={"Content-Type": "application/json"},
        )
        SigV4Auth(_session.get_credentials().get_frozen_credentials(), "appsync", _session.region_name).add_auth(signed)
        request = Request(APPSYNC_GRAPHQL_URL, data=body, headers=dict(signed.headers), method="POST")
        with urlopen(request, timeout=TIMEOUT_SECONDS) as response:
            result = json.loads(response.read().decode("utf-8"))
        if result.get("errors"):
            logger.error("AppSync rejected %s: %s", event_type, json.dumps(result["errors"]))
            return False
    except (HTTPError, URLError, OSError, ValueError, AttributeError) as error:
        logger.error("Could not publish %s on %s: %s", event_type, channel, error)
        return False
    return True


def announce_message(event_type: str, item: dict, conversation: dict | None = None) -> None:
    """A stored message on its contact's channel, and the new summary on the inbox."""
    publish(item["phone"], event_type, payload=item, message=item.get("message"))
    if conversation:
        announce_conversation(conversation)


def announce_conversation(conversation: dict) -> None:
    """The conversation summary on the inbox channel, as the web reads it."""
    publish(INBOX_CHANNEL, CONVERSATION_UPDATED, payload=store.conversation_view(conversation))
