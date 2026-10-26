from traceback import format_exc

from botocore.exceptions import ClientError

from common import create_error_response, create_success_response, get_logger, with_cors
from common.whatsapp import config, http, messaging, realtime, store

logger = get_logger(__name__)

# Meta's limit for a text body.
MAX_MESSAGE_LENGTH = 4096


@with_cors()
def handler(event, context):
    """POST /whatsapp/messages {phone, message}: a person replies from the web.

    Free-form text only reaches the contact within 24 hours of their last
    message (409 WINDOW_CLOSED otherwise): outside it, send a template.
    """
    try:
        body = http.get_body(event)
        phone = messaging.normalize_phone(http.require_text(body, "phone", 32))
        text = http.require_text(body, "message", MAX_MESSAGE_LENGTH)
    except (http.BadRequest, ValueError) as error:
        return create_error_response(str(error), 422, "VALIDATION_ERROR")

    caller = http.get_caller(event)
    try:
        conversation = store.get_conversation(phone)
        if not store.window_open(conversation):
            return create_error_response(
                "The contact has not written in the last 24 hours: send a template instead",
                409,
                "WINDOW_CLOSED",
            )
        message_id = messaging.send_text(phone, text)
    except config.ConfigurationError as error:
        return create_error_response(str(error), 409, "NOT_CONFIGURED")
    except ClientError as error:
        logger.error(format_exc())
        return create_error_response(
            f"WhatsApp rejected the message: {error.response['Error'].get('Message', '')}",
            502,
            "SOCIAL_MESSAGING_ERROR",
        )

    try:
        sent = store.save_message(
            phone,
            store.OUTBOUND,
            "text",
            text,
            message_id=message_id,
            sent_by="human",
            sent_by_name=caller["email"] or caller["username"],
        )
        realtime.announce_message(realtime.MESSAGE_SENT, sent, store.touch_conversation(sent))
    except Exception:  # noqa: BLE001
        # Already delivered: a failed write must not make the caller resend it.
        logger.error(format_exc())
        return create_success_response(data={"message_id": message_id, "stored": False})
    return create_success_response(data=sent)
