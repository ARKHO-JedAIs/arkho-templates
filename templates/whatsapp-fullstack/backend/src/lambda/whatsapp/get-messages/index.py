from traceback import format_exc

from common import create_error_response, create_success_response, get_logger, with_cors
from common.whatsapp import http, store

logger = get_logger(__name__)


@with_cors()
def handler(event, context):
    """GET /whatsapp/messages?phone=<digits>[&before=<iso date>]

    The last page of one conversation, oldest first; ``before`` (the oldest
    date already shown) pages backwards.
    """
    if not http.is_allowed(event):
        return create_error_response("Your profile cannot use WhatsApp", 403, "FORBIDDEN")
    phone = http.get_query(event, "phone")
    if not phone.isdigit():
        return create_error_response("phone is required (digits only)", 422, "VALIDATION_ERROR")
    try:
        messages = store.list_messages(phone, http.get_query(event, "before") or None)
        conversation = store.get_conversation(phone)
    except Exception:  # noqa: BLE001
        logger.error(format_exc())
        return create_error_response("Failed to read the conversation", 500, "INTERNAL_ERROR")
    return create_success_response(
        data={
            "conversation": conversation,
            "messages": messages,
            "window_open": store.window_open(conversation),
        }
    )
