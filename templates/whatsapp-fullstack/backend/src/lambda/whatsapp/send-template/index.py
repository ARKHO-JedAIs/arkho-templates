from traceback import format_exc

from botocore.exceptions import ClientError

from common import create_error_response, create_success_response, get_logger, with_cors
from common.whatsapp import config, http, messaging, realtime, store

logger = get_logger(__name__)

MAX_PARAMETER_LENGTH = 1024


def get_parameters(body: dict) -> list[str]:
    parameters = body.get("parameters") or []
    if not isinstance(parameters, list):
        raise http.BadRequest("parameters must be a list of strings")
    values = []
    for value in parameters:
        if not isinstance(value, str) or not value.strip():
            raise http.BadRequest("Every parameter must be a non-empty string")
        if len(value) > MAX_PARAMETER_LENGTH:
            raise http.BadRequest(f"Every parameter must have at most {MAX_PARAMETER_LENGTH} characters")
        values.append(value.strip())
    return values


@with_cors()
def handler(event, context):
    """POST /whatsapp/templates/send {phone, template_name, language, parameters?}

    The only way to start a conversation, or to write after the 24 hour window.
    """
    if not http.is_allowed(event):
        return create_error_response("Your profile cannot use WhatsApp", 403, "FORBIDDEN")
    try:
        body = http.get_body(event)
        phone = messaging.normalize_phone(http.require_text(body, "phone", 32))
        name = http.require_text(body, "template_name", 512)
        language = http.require_text(body, "language", 16)
        parameters = get_parameters(body)
    except (http.BadRequest, ValueError) as error:
        return create_error_response(str(error), 422, "VALIDATION_ERROR")

    caller = http.get_caller(event)
    try:
        message_id = messaging.send_template(phone, name, language, parameters)
    except config.ConfigurationError as error:
        return create_error_response(str(error), 409, "NOT_CONFIGURED")
    except ClientError as error:
        logger.error(format_exc())
        return create_error_response(
            f"WhatsApp rejected the template: {error.response['Error'].get('Message', '')}",
            502,
            "SOCIAL_MESSAGING_ERROR",
        )

    try:
        sent = store.save_message(
            phone,
            store.OUTBOUND,
            "template",
            f"{name} ({language})" + (f": {', '.join(parameters)}" if parameters else ""),
            message_id=message_id,
            template=name,
            sent_by="human",
            status="sent",
            sent_by_name=caller["email"] or caller["username"],
        )
        realtime.announce_message(realtime.TEMPLATE_SENT, sent, store.touch_conversation(sent))
    except Exception:  # noqa: BLE001
        logger.error(format_exc())
        return create_success_response(data={"message_id": message_id, "stored": False})
    return create_success_response(data=sent)
