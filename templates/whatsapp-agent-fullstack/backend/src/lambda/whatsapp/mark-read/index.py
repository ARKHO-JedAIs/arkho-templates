from traceback import format_exc

from common import create_error_response, create_success_response, get_logger, with_cors
from common.whatsapp import http, realtime, store

logger = get_logger(__name__)


@with_cors()
def handler(event, context):
    """PUT /whatsapp/conversations/{phone}/read: someone read the conversation.

    Resets its ``unreadCount`` to 0 and announces the summary on the inbox
    channel, so every open inbox drops the badge too.
    """
    if not http.is_allowed(event, "whatsapp"):
        return create_error_response("Your profile cannot use WhatsApp", 403, "FORBIDDEN")
    phone = str((event.get("pathParameters") or {}).get("phone") or "").strip()
    if not phone.isdigit() or not 8 <= len(phone) <= 15:
        return create_error_response("phone must be 8 to 15 digits", 422, "VALIDATION_ERROR")
    try:
        conversation = store.mark_read(phone)
    except Exception:  # noqa: BLE001
        logger.error(format_exc())
        return create_error_response("Failed to update the conversation", 500, "INTERNAL_ERROR")
    if conversation is None:
        return create_error_response("There is no conversation with that phone", 404, "NOT_FOUND")
    realtime.announce_conversation(conversation)
    return create_success_response(data=store.conversation_view(conversation))
