from traceback import format_exc

from botocore.exceptions import ClientError

from common import create_error_response, create_success_response, get_logger, with_cors
from common.whatsapp import config, http, media, messaging, realtime, store

logger = get_logger(__name__)

MAX_PARAMETER_LENGTH = 1024
MAX_HEADER_TEXT_LENGTH = 60
MAX_URL_SUFFIX_LENGTH = 2000
MAX_FILENAME_LENGTH = 240

MEDIA_HEADER_PLACEHOLDER = {"IMAGE": "[Imagen]", "VIDEO": "[Video]", "DOCUMENT": "[Documento]"}


def render_message(template: dict, header_text: dict | None, has_media_header: bool, parameters: list[str]) -> str:
    """The template as the contact reads it: its header line, then its body with
    each variable replaced by the value that was actually sent."""
    header_format = template["headerFormat"]
    if header_format == "TEXT" and template.get("header"):
        header_name = template["headerVariableNames"][0] if template["headerVariableNames"] else None
        header_value = header_text["text"] if header_text else None
        header_line = messaging.fill_template(
            template["header"], {header_name: header_value} if header_name and header_value else {}
        )
    elif header_format in MEDIA_HEADER_PLACEHOLDER and has_media_header:
        header_line = MEDIA_HEADER_PLACEHOLDER[header_format]
    else:
        header_line = None
    body_values = dict(zip(template["variableNames"], parameters))
    body = messaging.fill_template(template["body"], body_values)
    return f"{header_line}\n{body}" if header_line else body


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


def get_header(body: dict) -> dict:
    header = body.get("header") or {}
    if not isinstance(header, dict):
        raise http.BadRequest("header must be an object")
    return header


def get_buttons(body: dict) -> dict[int, str]:
    """``{index: url suffix}`` from ``buttons: [{index, text}]``."""
    buttons = body.get("buttons") or []
    if not isinstance(buttons, list):
        raise http.BadRequest("buttons must be a list of {index, text}")
    suffixes: dict[int, str] = {}
    for button in buttons:
        if not isinstance(button, dict):
            raise http.BadRequest("buttons must be a list of {index, text}")
        index = button.get("index")
        if not isinstance(index, int) or isinstance(index, bool) or index < 0:
            raise http.BadRequest("Every button needs its index")
        suffixes[index] = http.require_text(button, "text", MAX_URL_SUFFIX_LENGTH)
    return suffixes


def header_text(template: dict, header: dict) -> dict | None:
    """The text header variable, checked against what the template needs."""
    names = template.get("headerVariableNames") or []
    needed = template.get("headerFormat") == "TEXT" and bool(names)
    given = header.get("text") not in (None, "")
    if needed and not given:
        raise http.BadRequest(f"Template {template['name']} needs header.text")
    if not needed:
        if given:
            raise http.BadRequest(f"Template {template['name']} has no header variable")
        return None
    text = http.require_text(header, "text", MAX_HEADER_TEXT_LENGTH)
    return {"text": text, "name": names[0] if template.get("parameterFormat") == messaging.NAMED else None}


def header_media(template: dict, header: dict) -> dict | None:
    """The uploaded header file, checked against the template's header format."""
    header_format = template.get("headerFormat")
    needed = header_format in ("IMAGE", "VIDEO", "DOCUMENT")
    raw = header.get("media")
    if needed and raw is None:
        raise http.BadRequest(f"Template {template['name']} needs header.media (a {header_format.lower()})")
    if not needed:
        if raw is not None:
            raise http.BadRequest(f"Template {template['name']} has no media header")
        return None
    if not isinstance(raw, dict):
        raise http.BadRequest("header.media must be an object")
    key = http.require_text(raw, "key", 255)
    declared = media.base_mime(http.require_text(raw, "mimeType", 255))
    uploaded = media.uploaded_object(key)
    if uploaded["mimeType"] != declared:
        raise media.MediaRejected("The uploaded file does not have the declared mimeType")
    message_type = media.validate_outbound(declared, uploaded["size"])
    if message_type != header_format.lower():
        raise media.MediaRejected(f"Template {template['name']} needs a {header_format.lower()} header")
    filename = str(raw.get("filename") or "").strip()[:MAX_FILENAME_LENGTH]
    return {"key": key, "media_type": message_type, "filename": filename}


def url_buttons(template: dict, suffixes: dict[int, str]) -> list[dict]:
    """One suffix per URL button that ends with a variable, and no others."""
    needed = messaging.dynamic_url_buttons(template)
    missing = [index for index in needed if index not in suffixes]
    extra = [index for index in suffixes if index not in needed]
    if missing:
        raise http.BadRequest(f"Template {template['name']} needs the URL of button(s) {missing}")
    if extra:
        raise http.BadRequest(f"Button(s) {extra} of template {template['name']} take no value")
    return [{"index": index, "text": suffixes[index]} for index in needed]


@with_cors()
def handler(event, context):
    """POST /whatsapp/templates/send

    ``{phone, template_name, language, parameters?, header?: {text?, media?:
    {key, mimeType, filename?}}, buttons?: [{index, text}]}``

    The only way to start a conversation, or to write after the 24 hour
    window. Every part the template needs must have its value, and only those:
    the body variables (``parameters``, in order), the header variable
    (``header.text``), the header file uploaded through POST
    /whatsapp/media/upload-url (``header.media``), and the suffix of each URL
    button that ends with a variable (``buttons``).
    """
    if not http.is_allowed(event, "templates.send"):
        return create_error_response("Your profile cannot use WhatsApp", 403, "FORBIDDEN")
    try:
        body = http.get_body(event)
        phone = messaging.normalize_phone(http.require_text(body, "phone", 32))
        name = http.require_text(body, "template_name", 512)
        language = http.require_text(body, "language", 16)
        parameters = get_parameters(body)
        header = get_header(body)
        suffixes = get_buttons(body)
    except (http.BadRequest, ValueError) as error:
        return create_error_response(str(error), 422, "VALIDATION_ERROR")

    caller = http.get_caller(event)
    try:
        template = messaging.find_template(name, language)
        if template["status"] != messaging.APPROVED:
            return create_error_response(
                f"Template {name} ({language}) is {template['status']}: only APPROVED templates can be sent",
                409,
                "TEMPLATE_NOT_APPROVED",
            )
        if len(parameters) != template["variables"]:
            return create_error_response(
                f"Template {name} expects {template['variables']} parameter(s), got {len(parameters)}",
                422,
                "VALIDATION_ERROR",
            )
        try:
            text = header_text(template, header)
            file = header_media(template, header)
            buttons = url_buttons(template, suffixes)
        except media.MediaRejected as error:
            return create_error_response(str(error), 422, "MEDIA_REJECTED")
        except http.BadRequest as error:
            return create_error_response(str(error), 422, "VALIDATION_ERROR")
        sent_header = text
        if file:
            sent_header = {
                "media_type": file["media_type"],
                "media_id": media.post_to_whatsapp(file["key"]),
                "filename": file["filename"],
            }
        parameter_names = template["variableNames"] if template["parameterFormat"] == messaging.NAMED else None
        message_id = messaging.send_template(
            phone, name, language, parameters, parameter_names, header=sent_header, buttons=buttons
        )
    except messaging.TemplateNotFound as error:
        return create_error_response(str(error), 404, "TEMPLATE_NOT_FOUND")
    except config.ConfigurationError as error:
        return create_error_response(str(error), 409, "NOT_CONFIGURED")
    except ClientError as error:
        logger.error(format_exc())
        status, code, message = messaging.client_error(error)
        return create_error_response(message, status if status != 404 else 502, code)

    message_text = render_message(template, text, file is not None, parameters)
    try:
        sent = store.save_message(
            phone,
            store.OUTBOUND,
            "template",
            message_text,
            message_id=message_id,
            template=name,
            language=language,
            sent_by="human",
            status="sent",
            sent_by_name=caller["email"] or caller["username"],
        )
        realtime.announce_message(realtime.TEMPLATE_SENT, sent, store.touch_conversation(sent))
    except Exception:  # noqa: BLE001
        logger.error(format_exc())
        return create_success_response(data={"message_id": message_id, "stored": False})
    return create_success_response(data=sent)
