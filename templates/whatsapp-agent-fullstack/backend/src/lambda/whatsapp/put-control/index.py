from traceback import format_exc

from common import create_error_response, create_success_response, get_logger, with_cors
from common.whatsapp import http, realtime, store

logger = get_logger(__name__)

MODES = (store.ASSISTANT_MODE, store.HUMAN_MODE)


def notice_for(mode: str, by: str) -> tuple[str, str]:
    """The notice kind and its readable text for a change to ``mode``."""
    if mode == store.HUMAN_MODE:
        return store.HUMAN_TAKEOVER, f"{by or 'Una persona'} tomó la conversación"
    return store.ASSISTANT_RESUMED, "El Agente IA retomó la conversación"


@with_cors()
def handler(event, context):
    """PUT /whatsapp/control {phone, mode}: a person takes the conversation (human)
    or hands it back to the automatic replies (assistant).

    When the mode really changes, an internal notice (``type: event``) is
    stored in the conversation and announced, so everyone sees who took it.
    """
    if not http.is_allowed(event, "whatsapp.agent_toggle"):
        return create_error_response("Your profile cannot use WhatsApp", 403, "FORBIDDEN")
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
    by = caller["email"] or caller["username"]
    try:
        previous = store.get_conversation(phone).get("mode") or store.ASSISTANT_MODE
        conversation = store.set_mode(phone, mode, caller["username"], caller["email"])
    except Exception:  # noqa: BLE001
        logger.error(format_exc())
        return create_error_response("Failed to update the conversation", 500, "INTERNAL_ERROR")
    realtime.publish(phone, realtime.CONTROL_CHANGED, payload=store.conversation_view(conversation))
    realtime.announce_conversation(conversation)

    if previous != mode:
        kind, text = notice_for(mode, by)
        try:
            notice = store.save_notice(phone, kind, by, text)
            realtime.publish(phone, realtime.CONVERSATION_EVENT, payload=notice, message=text)
        except Exception:  # noqa: BLE001
            # The mode already changed; a missing notice must not report a failure.
            logger.error(format_exc())
    return create_success_response(data=store.conversation_view(conversation))
