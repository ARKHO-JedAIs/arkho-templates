from traceback import format_exc

from common import create_error_response, create_success_response, get_logger, with_cors
from common.whatsapp import store

logger = get_logger(__name__)


@with_cors()
def handler(event, context):
    """GET /whatsapp/conversations: the inbox, most recent first."""
    try:
        conversations = store.list_conversations()
    except Exception:  # noqa: BLE001
        logger.error(format_exc())
        return create_error_response("Failed to list the conversations", 500, "INTERNAL_ERROR")
    return create_success_response(data=conversations, metadata={"count": len(conversations)})
