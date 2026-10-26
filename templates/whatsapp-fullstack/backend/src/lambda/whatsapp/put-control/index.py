from traceback import format_exc

from common import create_error_response, create_success_response, get_logger, with_cors
from common.whatsapp import http, realtime, store

logger = get_logger(__name__)

MODES = (store.ASSISTANT_MODE, store.HUMAN_MODE)


@with_cors()
def handler(event, context):
    """PUT /whatsapp/control {phone, mode}: a person takes the conversation (human)
    or hands it back to the automatic replies (assistant)."""
    try:
        body = http.get_body(event)
        phone = http.require_text(body, "phone", 32)
        mode = http.require_text(body, "mode", 16)
    except http.BadRequest as error:
        return create_error_response(str(error), 422, "VALIDATION_ERROR")
    if not phone.isdigit():
        return create_error_response("phone must be digits only", 422, "VALIDATION_ERROR")
    if mode not in MODES:
        return create_error_response(f"mode must be one of {', '.join(MODES)}", 422, "VALIDATION_ERROR")

    caller = http.get_caller(event)
    try:
        conversation = store.set_mode(phone, mode, caller["username"], caller["email"])
    except Exception:  # noqa: BLE001
        logger.error(format_exc())
        return create_error_response("Failed to update the conversation", 500, "INTERNAL_ERROR")
    realtime.publish(phone, realtime.CONTROL_CHANGED, payload=conversation)
    realtime.publish(realtime.INBOX_CHANNEL, realtime.CONVERSATION_UPDATED, payload=conversation)
    return create_success_response(data=conversation)
