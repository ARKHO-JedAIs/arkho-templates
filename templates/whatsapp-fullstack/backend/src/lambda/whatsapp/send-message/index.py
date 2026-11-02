from traceback import format_exc

from botocore.exceptions import ClientError

from common import create_error_response, create_success_response, get_logger, with_cors
from common.whatsapp import config, http, media, messaging, realtime, store

logger = get_logger(__name__)

# Meta's limits for a text body and a media caption.
MAX_MESSAGE_LENGTH = 4096
MAX_CAPTION_LENGTH = 1024
MAX_FILENAME_LENGTH = 240

PLACEHOLDERS = {"image": "[Imagen]", "audio": "[Audio]", "video": "[Video]", "document": "[Documento]"}


def optional_text(value, name: str, max_length: int) -> str:
    text = str(value or "").strip()
    if len(text) > max_length:
        raise http.BadRequest(f"{name} must have at most {max_length} characters")
    return text


def get_media(body: dict) -> dict | None:
    """The ``media`` of the body, validated against the uploaded object; None for a text."""
    raw = body.get("media")
    if raw is None:
        return None
    if not isinstance(raw, dict):
        raise http.BadRequest("media must be an object")
    key = http.require_text(raw, "key", 255)
    declared = media.base_mime(http.require_text(raw, "mimeType", 255))
    uploaded = media.uploaded_object(key)
    if uploaded["mimeType"] != declared:
        raise media.MediaRejected("The uploaded file does not have the declared mimeType")
    message_type = media.validate_outbound(declared, uploaded["size"])
    return {
        "type": message_type,
        "key": key,
        "mimeType": declared,
        "size": uploaded["size"],
        "filename": optional_text(raw.get("filename"), "media.filename", MAX_FILENAME_LENGTH),
        "caption": optional_text(raw.get("caption"), "media.caption", MAX_CAPTION_LENGTH),
    }


@with_cors()
def handler(event, context):
    """POST /whatsapp/messages: a person replies from the web.

    ``{phone, message}`` sends a text. ``{phone, media: {key, mimeType,
    filename?, caption?}}`` sends a file uploaded first through POST
    /whatsapp/media/upload-url: it is handed to WhatsApp
    (PostWhatsAppMessageMedia) and sent as an image, audio, video or document.

    Free-form messages only reach the contact within 24 hours of their last
    message (409 WINDOW_CLOSED otherwise): outside it, send a template.
    """
    if not http.is_allowed(event):
        return create_error_response("Your profile cannot use WhatsApp", 403, "FORBIDDEN")
    try:
        body = http.get_body(event)
        phone = messaging.normalize_phone(http.require_text(body, "phone", 32))
        if body.get("media") is None:
            text = http.require_text(body, "message", MAX_MESSAGE_LENGTH)
            file = None
        else:
            text = ""
            file = get_media(body)
    except media.MediaRejected as error:
        return create_error_response(str(error), 422, "MEDIA_REJECTED")
    except (http.BadRequest, ValueError) as error:
        return create_error_response(str(error), 422, "VALIDATION_ERROR")
    except config.ConfigurationError as error:
        return create_error_response(str(error), 409, "NOT_CONFIGURED")

    caller = http.get_caller(event)
    try:
        conversation = store.get_conversation(phone)
        if not store.window_open(conversation):
            return create_error_response(
                "The contact has not written in the last 24 hours: send a template instead",
                409,
                "WINDOW_CLOSED",
            )
        if file is None:
            message_id = messaging.send_text(phone, text)
        else:
            media_id = media.post_to_whatsapp(file["key"])
            message_id = messaging.send_media(phone, file["type"], media_id, file["caption"], file["filename"])
    except config.ConfigurationError as error:
        return create_error_response(str(error), 409, "NOT_CONFIGURED")
    except ClientError as error:
        logger.error(format_exc())
        return create_error_response(
            f"WhatsApp rejected the message: {error.response['Error'].get('Message', '')}",
            502,
            "SOCIAL_MESSAGING_ERROR",
        )

    if file is None:
        message_type, stored_media = "text", None
    else:
        message_type = file["type"]
        text = f"{PLACEHOLDERS[message_type]} {file['caption']}".strip()
        stored_media = {
            key: file[key] for key in ("key", "mimeType", "size", "filename", "caption") if file[key] not in ("", None)
        }
    try:
        sent = store.save_message(
            phone,
            store.OUTBOUND,
            message_type,
            text,
            message_id=message_id,
            sent_by="human",
            status="sent",
            sent_by_name=caller["email"] or caller["username"],
            media=stored_media,
        )
        exposed = media.exposed(sent)
        realtime.announce_message(realtime.MESSAGE_SENT, exposed, store.touch_conversation(sent))
    except Exception:  # noqa: BLE001
        # Already delivered: a failed write must not make the caller resend it.
        logger.error(format_exc())
        return create_success_response(data={"message_id": message_id, "stored": False})
    return create_success_response(data=exposed)
