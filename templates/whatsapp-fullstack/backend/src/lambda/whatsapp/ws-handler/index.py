"""ws-handler: what WhatsApp contacts write, delivered by End User Messaging Social.

The WABA publishes every webhook notification to the ws-handler SNS topic
(WhatsAppFactory). For each message this function:

1. stores it and updates the inbox summary (DynamoDB),
2. announces both on AppSync so the front shows them live,
3. marks it as read,
4. answers it, unless a person took the conversation over from the web.

Delivery statuses (sent / delivered / read / failed) of what we sent are
recorded on the stored message and announced too.

A message that could not be stored makes the invocation fail, so Lambda
retries it (and after the retries it lands in the dead-letter queue): it is
never silently lost. The retry is safe because a message already stored is
recognised by its WhatsApp id and skipped.

``answer`` is the seam for an agent: today it returns the configured automatic
reply (or nothing); replace it with a call to your model or agent runtime.
"""
import json
from traceback import format_exc

from common import get_logger
from common.whatsapp import config, messaging, realtime, store

logger = get_logger(__name__)

# What a non-text message is stored as, so the conversation still shows it.
MEDIA_PLACEHOLDERS = {
    "image": "[Imagen]",
    "audio": "[Audio]",
    "video": "[Video]",
    "document": "[Documento]",
    "sticker": "[Sticker]",
    "location": "[Ubicacion]",
    "contacts": "[Contacto]",
}


def parse_entry(message_body: dict) -> dict:
    entry = message_body.get("whatsAppWebhookEntry", "{}")
    return json.loads(entry) if isinstance(entry, str) else (entry or {})


def message_text(message: dict) -> str:
    """The readable text of one WhatsApp message, whatever its type."""
    message_type = str(message.get("type", "")).lower()
    if message_type == "text":
        return str((message.get("text") or {}).get("body", ""))
    if message_type == "button":
        return str((message.get("button") or {}).get("text", ""))
    if message_type == "interactive":
        interactive = message.get("interactive") or {}
        reply = interactive.get("button_reply") or interactive.get("list_reply") or {}
        return str(reply.get("title", ""))
    caption = str((message.get(message_type) or {}).get("caption", "") if isinstance(message.get(message_type), dict) else "")
    placeholder = MEDIA_PLACEHOLDERS.get(message_type, f"[{message_type or 'mensaje'}]")
    return f"{placeholder} {caption}".strip()


def extract_messages(entry: dict) -> list[dict]:
    messages = []
    for change in entry.get("changes", []):
        value = change.get("value") or {}
        names = {
            str(contact.get("wa_id", "")): str((contact.get("profile") or {}).get("name", ""))
            for contact in value.get("contacts", [])
        }
        for message in value.get("messages", []):
            phone = str(message.get("from", ""))
            messages.append(
                {
                    "phone": phone,
                    "name": names.get(phone, ""),
                    "message_id": str(message.get("id", "")),
                    "type": str(message.get("type", "")).lower() or "unknown",
                    "text": message_text(message),
                }
            )
    return messages


def extract_statuses(entry: dict) -> list[dict]:
    statuses = []
    for change in entry.get("changes", []):
        for status in (change.get("value") or {}).get("statuses", []):
            errors = status.get("errors") or []
            statuses.append(
                {
                    "message_id": str(status.get("id", "")),
                    "status": str(status.get("status", "")).lower(),
                    "error": str((errors[0] or {}).get("title", "")) if errors else "",
                }
            )
    return statuses


def handle_status(status: dict) -> None:
    if not status["message_id"]:
        return
    updated = store.update_status(status["message_id"], status["status"], status["error"])
    if updated is None:
        # Unknown id (not sent through this backend) or older than the stored status.
        logger.info("Status %s for %s not applied", status["status"], status["message_id"])
        return
    realtime.publish(updated["phone"], realtime.MESSAGE_STATUS, payload=updated)


def answer(conversation: dict, text: str) -> str:
    """The automatic reply to ``text``; empty means do not reply.

    Replace this with your agent (Bedrock, AgentCore, ...) when you add one.
    """
    return config.auto_reply_message()


def handle_message(message: dict, origination_phone_number_id: str) -> None:
    phone = message["phone"]
    # SNS delivers at least once and a failed invocation is retried: a message
    # already stored is recognised by its WhatsApp id and not stored twice.
    if message["message_id"] and store.find_message_key(message["message_id"]):
        logger.info("Duplicate delivery of %s ignored", message["message_id"])
        return

    saved = store.save_message(
        phone,
        store.INBOUND,
        message["type"],
        message["text"],
        message_id=message["message_id"],
        name=message["name"],
    )
    conversation = store.touch_conversation(saved, name=message["name"])
    realtime.announce_message(realtime.MESSAGE_RECEIVED, saved, conversation)

    if message["message_id"]:
        try:
            messaging.mark_as_read(message["message_id"], origination_phone_number_id)
        except Exception:  # noqa: BLE001
            logger.warning("Could not mark %s as read", message["message_id"])

    if store.is_answered_by_person(conversation):
        logger.info("Conversation answered by a person: no automatic reply")
        return

    # The message is stored: from here on a failure must not fail the
    # invocation, or the retry would skip it as a duplicate and never answer.
    try:
        reply = answer(conversation, message["text"])
        if not reply:
            return
        message_id = messaging.send_text(phone, reply, origination_phone_number_id)
        sent = store.save_message(
            phone,
            store.OUTBOUND,
            "text",
            reply,
            message_id=message_id,
            sent_by="assistant",
            status="sent",
        )
        realtime.announce_message(realtime.MESSAGE_SENT, sent, store.touch_conversation(sent))
    except Exception:  # noqa: BLE001
        logger.error("Could not send the automatic reply to %s", phone[-4:])
        logger.error(format_exc())


class NotificationFailed(RuntimeError):
    """Raised at the end of an invocation when something could not be stored."""


def handler(event, context):
    failures = 0
    for record in event.get("Records", []):
        sns = record.get("Sns", {})
        try:
            body = json.loads(sns.get("Message", "{}"))
        except json.JSONDecodeError:
            # Malformed for good: retrying cannot fix it.
            logger.error("SNS record %s is not JSON", sns.get("MessageId"))
            continue
        phone_number_ids = (body.get("context") or {}).get("MetaPhoneNumberIds") or [{}]
        origination_phone_number_id = phone_number_ids[0].get("arn", "")
        entry = parse_entry(body)
        for message in extract_messages(entry):
            if not message["phone"]:
                continue
            try:
                handle_message(message, origination_phone_number_id)
            except Exception:  # noqa: BLE001
                failures += 1
                logger.error("Error storing a message from %s", message["phone"][-4:])
                logger.error(format_exc())
        for status in extract_statuses(entry):
            try:
                handle_status(status)
            except Exception:  # noqa: BLE001
                failures += 1
                logger.error("Error recording status %s", status["status"])
                logger.error(format_exc())
    if failures:
        # Lambda retries the whole notification; what was stored is skipped.
        raise NotificationFailed(f"{failures} item(s) could not be stored")
    return {"status": "processed"}
