"""ws-handler: what WhatsApp contacts write, delivered by End User Messaging Social.

The WABA publishes every webhook notification to the ws-handler SNS topic
(WhatsAppFactory). For each message this function:

1. normalizes it (``normalize``): a ``type``, a readable ``message`` and a
   ``payload`` per type, plus ``reply_to`` and ``referral`` when present,
2. downloads its file, if it has one, into the media bucket,
3. stores it and updates the inbox summary (DynamoDB), counting it as unread
   when it is customer content (``AUTO_REPLY_TYPES``),
4. announces both on AppSync so the front shows them live,
5. marks it as read,
6. answers it, unless a person took the conversation over from the web or the
   message is not customer content (``AUTO_REPLY_TYPES``).

A reaction is not a message: it is attached to the message it reacts to (an
empty emoji removes it). Delivery statuses of what we sent are recorded on the
stored message and announced too. docs/WHATSAPP_EVENTS.md maps every event.

A message that could not be stored makes the invocation fail, so Lambda
retries it (and after the retries it lands in the dead-letter queue): it is
never silently lost. The retry is safe because a message already stored is
recognised by its WhatsApp id and skipped.

Seams for an agent:

* ``answer`` returns the configured automatic reply (or nothing); replace it
  with a call to your model or agent runtime.
* ``after_media_stored`` runs once a file is in the bucket; transcribe voice
  notes there (Amazon Transcribe over ``media["key"]``, as midoc does) if an
  agent must read them. Not included: it needs its own IAM, timeout and cost.
"""
import json
from traceback import format_exc

from common import get_logger
from common.whatsapp import config, media, messaging, realtime, store

logger = get_logger(__name__)

# The readable text stored for a type without one, so the inbox still shows it.
PLACEHOLDERS = {
    "image": "[Imagen]",
    "audio": "[Audio]",
    "video": "[Video]",
    "document": "[Documento]",
    "sticker": "[Sticker]",
    "location": "[Ubicación]",
    "contacts": "[Contacto]",
    "order": "[Pedido]",
    "nfm_reply": "[Formulario]",
    "request_welcome": "[Abrió el chat]",
    "system": "[Aviso del sistema]",
    "unsupported": "[Tipo de mensaje no soportado]",
}

# Customer content the automatic reply answers, and the messages that count as
# unread. Reactions, system notices, request_welcome and unsupported messages
# do neither.
AUTO_REPLY_TYPES = {
    "text",
    "image",
    "audio",
    "video",
    "document",
    "sticker",
    "location",
    "contacts",
    "button_reply",
    "list_reply",
    "nfm_reply",
    "button",
    "order",
}

# Inbound types that do not open WhatsApp's 24 hour window.
NO_WINDOW_TYPES = {"system"}

RAW_LIMIT = 4000
REFERRAL_FIELDS = ("source_url", "source_type", "source_id", "headline", "body", "media_type", "ctwa_clid")


def parse_entry(message_body: dict) -> dict:
    entry = message_body.get("whatsAppWebhookEntry", "{}")
    return json.loads(entry) if isinstance(entry, str) else (entry or {})


def _text(value) -> str:
    return str(value if value is not None else "").strip()


def _contact_card(contact: dict) -> dict:
    name = contact.get("name") or {}
    org = contact.get("org") or {}
    return {
        "name": _text(name.get("formatted_name"))
        or " ".join(part for part in (_text(name.get("first_name")), _text(name.get("last_name"))) if part),
        "phones": [
            {"phone": _text(phone.get("phone")), "wa_id": _text(phone.get("wa_id")), "type": _text(phone.get("type"))}
            for phone in contact.get("phones") or []
            if _text(phone.get("phone"))
        ],
        "emails": [_text(email.get("email")) for email in contact.get("emails") or [] if _text(email.get("email"))],
        "org": _text(org.get("company")),
    }


def _flow_response(raw) -> dict | str:
    """The submitted Flow fields; the raw text when it is not a JSON object."""
    if isinstance(raw, dict):
        return raw
    try:
        parsed = json.loads(raw or "{}")
    except (TypeError, ValueError):
        return _text(raw)[:RAW_LIMIT]
    return parsed if isinstance(parsed, dict) else _text(raw)[:RAW_LIMIT]


def _unsupported(message: dict, original_type: str) -> dict:
    errors = [
        {
            "code": error.get("code"),
            "title": _text(error.get("title")),
            "details": _text((error.get("error_data") or {}).get("details")),
        }
        for error in message.get("errors") or []
        if isinstance(error, dict)
    ]
    title = errors[0]["title"] if errors else ""
    return {
        "type": "unsupported",
        "text": f"{PLACEHOLDERS['unsupported']} {title}".strip(),
        "payload": {
            "original_type": original_type,
            "errors": errors,
            "raw": json.dumps(message, ensure_ascii=False)[:RAW_LIMIT],
        },
    }


def normalize(message: dict) -> dict:
    """``{type, text, payload?, media?}`` for one WhatsApp message, whatever its type.

    ``media`` is what the download needs (id, mime type, ...); ``payload`` is
    stored as is on the message.
    """
    message_type = _text(message.get("type")).lower()
    body = message.get(message_type) if isinstance(message.get(message_type), dict) else {}

    if message_type == "text":
        return {"type": "text", "text": _text(body.get("body"))}

    if message_type in media.MEDIA_TYPES:
        caption = _text(body.get("caption"))
        info = {
            "id": _text(body.get("id")),
            "mimeType": media.base_mime(body.get("mime_type", "")),
            "sha256": _text(body.get("sha256")),
            "filename": _text(body.get("filename")),
            "caption": caption,
        }
        if message_type == "audio" and body.get("voice") is True:
            info["voice"] = True
        if message_type == "sticker" and body.get("animated") is True:
            info["animated"] = True
        return {"type": message_type, "text": f"{PLACEHOLDERS[message_type]} {caption}".strip(), "media": info}

    if message_type == "location":
        payload = {
            "latitude": body.get("latitude"),
            "longitude": body.get("longitude"),
            "name": _text(body.get("name")),
            "address": _text(body.get("address")),
            "url": _text(body.get("url")),
        }
        label = payload["name"] or payload["address"]
        return {"type": "location", "text": f"{PLACEHOLDERS['location']} {label}".strip(), "payload": payload}

    if message_type == "contacts":
        cards = [_contact_card(contact) for contact in message.get("contacts") or [] if isinstance(contact, dict)]
        names = ", ".join(card["name"] for card in cards if card["name"])
        return {"type": "contacts", "text": f"{PLACEHOLDERS['contacts']} {names}".strip(), "payload": {"contacts": cards}}

    if message_type == "interactive":
        kind = _text(body.get("type")).lower()
        reply = body.get(kind) if isinstance(body.get(kind), dict) else {}
        if kind in ("button_reply", "list_reply"):
            payload = {"id": _text(reply.get("id")), "title": _text(reply.get("title"))}
            if kind == "list_reply" and _text(reply.get("description")):
                payload["description"] = _text(reply.get("description"))
            return {"type": kind, "text": payload["title"], "payload": payload}
        if kind == "nfm_reply":
            payload = {
                "name": _text(reply.get("name")),
                "body": _text(reply.get("body")),
                "response": _flow_response(reply.get("response_json")),
            }
            return {"type": "nfm_reply", "text": payload["body"] or PLACEHOLDERS["nfm_reply"], "payload": payload}
        return _unsupported(message, f"interactive/{kind or 'unknown'}")

    if message_type == "button":
        payload = {"text": _text(body.get("text")), "payload": _text(body.get("payload"))}
        return {"type": "button", "text": payload["text"], "payload": payload}

    if message_type == "reaction":
        return {
            "type": "reaction",
            "text": "",
            "payload": {"message_id": _text(body.get("message_id")), "emoji": _text(body.get("emoji"))},
        }

    if message_type == "order":
        items = [
            {
                "product_retailer_id": _text(item.get("product_retailer_id")),
                "quantity": item.get("quantity"),
                "item_price": item.get("item_price"),
                "currency": _text(item.get("currency")),
            }
            for item in body.get("product_items") or []
            if isinstance(item, dict)
        ]
        payload = {"catalog_id": _text(body.get("catalog_id")), "text": _text(body.get("text")), "items": items}
        return {"type": "order", "text": f"{PLACEHOLDERS['order']} {len(items)} producto(s)", "payload": payload}

    if message_type == "system":
        payload = {
            "body": _text(body.get("body")),
            "type": _text(body.get("type")),
            "wa_id": _text(body.get("wa_id")),
            "new_wa_id": _text(body.get("new_wa_id")),
        }
        return {"type": "system", "text": payload["body"] or PLACEHOLDERS["system"], "payload": payload}

    if message_type == "request_welcome":
        return {"type": "request_welcome", "text": PLACEHOLDERS["request_welcome"]}

    return _unsupported(message, message_type or "unknown")


def _referral(message: dict) -> dict | None:
    raw = message.get("referral")
    if not isinstance(raw, dict):
        return None
    referral = {field: _text(raw.get(field)) for field in REFERRAL_FIELDS if _text(raw.get(field))}
    return referral or None


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
            context = message.get("context") if isinstance(message.get("context"), dict) else {}
            normalized = normalize(message)
            messages.append(
                {
                    "phone": phone,
                    "name": names.get(phone, ""),
                    "message_id": str(message.get("id", "")),
                    "type": normalized["type"],
                    "text": normalized["text"],
                    "payload": normalized.get("payload"),
                    "media": normalized.get("media"),
                    "reply_to": _text(context.get("id")),
                    "forwarded": bool(context.get("forwarded") or context.get("frequently_forwarded")),
                    "referral": _referral(message),
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
    if status["status"] == "deleted":
        updated = store.mark_message(status["message_id"], deleted=True)
    elif status["status"] == "warning":
        logger.warning("Warning for %s: %s", status["message_id"], status["error"] or "no detail")
        updated = store.mark_message(status["message_id"], warning=status["error"] or "warning")
    else:
        updated = store.update_status(status["message_id"], status["status"], status["error"])
    if updated is None:
        # Unknown id (not sent through this backend) or older than the stored status.
        logger.info("Status %s for %s not applied", status["status"], status["message_id"])
        return
    realtime.publish(updated["phone"], realtime.MESSAGE_STATUS, payload=media.exposed(updated))


def handle_reaction(message: dict) -> None:
    """Attaches the emoji to the message it reacts to; an empty emoji removes it."""
    payload = message.get("payload") or {}
    target = payload.get("message_id", "")
    if not target:
        return
    updated = store.set_reaction(target, payload.get("emoji", ""))
    if updated is None:
        logger.info("Reaction to an unknown message %s ignored", target)
        return
    realtime.publish(updated["phone"], realtime.MESSAGE_UPDATED, payload=media.exposed(updated))


def store_media(info: dict | None, origination_phone_number_id: str) -> dict | None:
    """The ``media`` attribute of the message: where the file is, or why it is not.

    A failed download never loses the message: it is stored with ``error``.
    """
    if not info:
        return None
    stored = {
        "mimeType": info.get("mimeType", ""),
        "filename": info.get("filename", ""),
        "caption": info.get("caption", ""),
        "sha256": info.get("sha256", ""),
    }
    for flag in ("voice", "animated"):
        if info.get(flag):
            stored[flag] = True
    try:
        if not info.get("id"):
            raise ValueError("The message has no media id")
        downloaded = media.download_inbound(info["id"], origination_phone_number_id)
        stored.update(
            key=downloaded["key"],
            mimeType=downloaded["mimeType"] or stored["mimeType"],
            size=downloaded["size"],
        )
    except Exception:  # noqa: BLE001
        logger.error("Could not download media %s", info.get("id"))
        logger.error(format_exc())
        stored["error"] = "download_failed"
    return {key: value for key, value in stored.items() if value not in ("", None)}


def after_media_stored(item: dict) -> None:
    """Hook for work over a stored file, e.g. transcribing a voice note. No-op."""


def answer(conversation: dict, text: str) -> str:
    """The automatic reply to ``text``; empty means do not reply.

    Replace this with your agent (Bedrock, AgentCore, ...) when you add one.
    """
    return config.auto_reply_message()


def handle_message(message: dict, origination_phone_number_id: str) -> None:
    if message["type"] == "reaction":
        handle_reaction(message)
        return

    phone = message["phone"]
    # SNS delivers at least once and a failed invocation is retried: a message
    # already stored is recognised by its WhatsApp id and not stored twice.
    if message["message_id"] and store.find_message_key(message["message_id"]):
        logger.info("Duplicate delivery of %s ignored", message["message_id"])
        return

    stored_media = store_media(message.get("media"), origination_phone_number_id)
    saved = store.save_message(
        phone,
        store.INBOUND,
        message["type"],
        message["text"],
        message_id=message["message_id"],
        name=message["name"],
        payload=message.get("payload") or None,
        media=stored_media,
        reply_to=message.get("reply_to"),
        forwarded=True if message.get("forwarded") else None,
        referral=message.get("referral"),
    )
    conversation = store.touch_conversation(
        saved,
        name=message["name"],
        opens_window=message["type"] not in NO_WINDOW_TYPES,
        counts_unread=message["type"] in AUTO_REPLY_TYPES,
    )
    realtime.announce_message(realtime.MESSAGE_RECEIVED, media.exposed(saved), conversation)
    if stored_media and stored_media.get("key"):
        try:
            after_media_stored(saved)
        except Exception:  # noqa: BLE001
            logger.error(format_exc())

    if message["message_id"]:
        try:
            messaging.mark_as_read(message["message_id"], origination_phone_number_id)
        except Exception:  # noqa: BLE001
            logger.warning("Could not mark %s as read", message["message_id"])

    if message["type"] not in AUTO_REPLY_TYPES:
        return
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
