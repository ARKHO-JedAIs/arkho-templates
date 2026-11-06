from traceback import format_exc

from common import create_error_response, create_success_response, get_logger, with_cors
from common.whatsapp import http, store

logger = get_logger(__name__)

MAX_SEARCH_LENGTH = 64


@with_cors()
def handler(event, context):
    """GET /whatsapp/conversations[?search=<text>]: the inbox, most recent first.

    With ``search`` (2+ characters) only the conversations whose contact name
    (case and accents ignored) or phone digits contain it, up to 50. The
    messages themselves are not searched.
    """
    if not http.is_allowed(event, "whatsapp"):
        return create_error_response("Your profile cannot use WhatsApp", 403, "FORBIDDEN")
    search = http.get_query(event, "search")
    if len(search) > MAX_SEARCH_LENGTH:
        return create_error_response(
            f"search must have at most {MAX_SEARCH_LENGTH} characters", 422, "VALIDATION_ERROR"
        )
    try:
        if len(store.search_term(search)) >= store.SEARCH_MIN_LENGTH:
            conversations = store.search_conversations(search)
        else:
            conversations = store.list_conversations()
    except Exception:  # noqa: BLE001
        logger.error(format_exc())
        return create_error_response("Failed to list the conversations", 500, "INTERNAL_ERROR")
    data = [store.conversation_view(item) for item in conversations]
    return create_success_response(data=data, metadata={"count": len(data)})
