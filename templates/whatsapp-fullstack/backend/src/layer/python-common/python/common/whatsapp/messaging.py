"""Sending through AWS End User Messaging Social.

The payloads are the WhatsApp Cloud API ones: End User Messaging Social
forwards them to Meta as they are, signed with the function's IAM role, so no
Meta access token is ever stored.
"""
import json
import logging
import re

import boto3
from botocore.exceptions import ClientError

from . import config

logger = logging.getLogger(__name__)

PHONE_PATTERN = re.compile(r"^\d{8,15}$")

social_messaging = boto3.client("socialmessaging")


def normalize_phone(raw: str, prefix: str | None = None) -> str:
    """E.164 digits without "+", completing a local number with the default prefix.

    ``"+56 9 1234 5678"`` and ``"912345678"`` (prefix ``56``) both give
    ``"56912345678"``. Raises ValueError when the result is not dialable.
    """
    value = str(raw or "").strip()
    has_plus = value.startswith("+")
    digits = re.sub(r"[\s\-().+]", "", value)
    if not digits.isdigit():
        raise ValueError("Expected a phone number")
    prefix = (config.default_phone_prefix() if prefix is None else prefix).lstrip("+")
    if not has_plus and prefix and not digits.startswith(prefix):
        digits = f"{prefix}{digits}"
    if PHONE_PATTERN.fullmatch(digits) is None:
        raise ValueError("Expected 8 to 15 digits, country prefix included")
    return digits


def _send(payload: dict, origination_phone_number_id: str | None = None) -> str | None:
    response = social_messaging.send_whatsapp_message(
        originationPhoneNumberId=origination_phone_number_id or config.origination_phone_number_id(),
        metaApiVersion=config.meta_api_version(),
        message=json.dumps(payload).encode("utf-8"),
    )
    return response.get("messageId")


def send_text(phone: str, text: str, origination_phone_number_id: str | None = None) -> str | None:
    return _send(
        {
            "messaging_product": "whatsapp",
            "recipient_type": "individual",
            "to": f"+{phone}",
            "type": "text",
            "text": {"body": text},
        },
        origination_phone_number_id,
    )


def send_media(
    phone: str,
    message_type: str,
    media_id: str,
    caption: str = "",
    filename: str = "",
    origination_phone_number_id: str | None = None,
) -> str | None:
    """Sends a file already handed to WhatsApp (``PostWhatsAppMessageMedia``).

    Audio takes no caption, and only documents carry a file name.
    """
    body: dict = {"id": media_id}
    if caption and message_type in ("image", "video", "document"):
        body["caption"] = caption
    if filename and message_type == "document":
        body["filename"] = filename
    return _send(
        {
            "messaging_product": "whatsapp",
            "recipient_type": "individual",
            "to": f"+{phone}",
            "type": message_type,
            message_type: body,
        },
        origination_phone_number_id,
    )


def send_template(
    phone: str,
    name: str,
    language: str,
    parameters: list[str],
    parameter_names: list[str] | None = None,
    header: dict | None = None,
    buttons: list[dict] | None = None,
) -> str | None:
    """Sends an approved template, filling its variables.

    ``parameters`` fill the body in order; a NAMED template needs each value
    tagged with its variable name, so pass ``parameter_names`` (same order) for
    those. ``header`` is ``{"text", "name"?}`` for a text header variable, or
    ``{"media_type", "media_id", "filename"?}`` for an image, video or
    document header (the id ``PostWhatsAppMessageMedia`` returned).
    ``buttons`` are ``{"index", "text"}``: the URL suffix of each URL button
    whose address ends with a variable.
    """
    template: dict = {"name": name, "language": {"code": language}}
    components: list[dict] = []
    if header and header.get("media_id"):
        kind = header["media_type"]
        media: dict = {"id": header["media_id"]}
        if kind == "document" and header.get("filename"):
            media["filename"] = header["filename"]
        components.append({"type": "header", "parameters": [{"type": kind, kind: media}]})
    elif header and header.get("text"):
        parameter: dict = {"type": "text", "text": header["text"]}
        if header.get("name"):
            parameter["parameter_name"] = header["name"]
        components.append({"type": "header", "parameters": [parameter]})
    if parameters:
        names = parameter_names or []
        components.append(
            {
                "type": "body",
                "parameters": [
                    {"type": "text", "parameter_name": names[index], "text": value}
                    if index < len(names)
                    else {"type": "text", "text": value}
                    for index, value in enumerate(parameters)
                ],
            }
        )
    for button in buttons or []:
        components.append(
            {
                "type": "button",
                "sub_type": "url",
                "index": str(button["index"]),
                "parameters": [{"type": "text", "text": button["text"]}],
            }
        )
    if components:
        template["components"] = components
    return _send(
        {
            "messaging_product": "whatsapp",
            "recipient_type": "individual",
            "to": f"+{phone}",
            "type": "template",
            "template": template,
        }
    )


def mark_as_read(message_id: str, origination_phone_number_id: str | None = None) -> None:
    """The contact sees the blue ticks: the message reached the business."""
    _send(
        {"messaging_product": "whatsapp", "status": "read", "message_id": message_id},
        origination_phone_number_id,
    )


VARIABLE = re.compile(r"\{\{\s*([^{}]+?)\s*\}\}")

APPROVED = "APPROVED"
POSITIONAL = "POSITIONAL"
NAMED = "NAMED"


class TemplateNotFound(LookupError):
    """No template of the business account has that name and language."""


def variable_names(text: str) -> list[str]:
    """Distinct variable names of a template text, in order of first use."""
    names: list[str] = []
    for name in VARIABLE.findall(text or ""):
        if name not in names:
            names.append(name)
    return names


def _template_summaries(waba_id: str) -> list[dict]:
    summaries: list[dict] = []
    kwargs = {"id": waba_id, "maxResults": 100}
    while True:
        response = social_messaging.list_whatsapp_message_templates(**kwargs)
        summaries.extend(response.get("templates", []))
        if not response.get("nextToken"):
            break
        kwargs["nextToken"] = response["nextToken"]
    return summaries


def _template_definition(waba_id: str, meta_template_id: str | None) -> dict:
    """The Meta definition of a template; empty when it cannot be read.

    A rejected or deleted template may no longer be readable, and one such
    template must not hide the rest of the list.
    """
    if not meta_template_id:
        return {}
    try:
        raw = social_messaging.get_whatsapp_message_template(
            id=waba_id, metaTemplateId=meta_template_id
        ).get("template")
        definition = json.loads(raw or "{}")
    except (ClientError, ValueError):
        logger.warning("Could not read the definition of template %s", meta_template_id)
        return {}
    return definition if isinstance(definition, dict) else {}


def _examples(definition: dict) -> dict:
    """The sample values of a definition, keyed as the web's creator keys them
    (``header:<variable>``, ``body:<variable>``, ``button:<index>``)."""
    examples: dict = {}
    for component in definition.get("components") or []:
        kind = str(component.get("type", "")).upper()
        example = component.get("example") if isinstance(component.get("example"), dict) else {}
        if kind == "HEADER":
            names = variable_names(component.get("text") or "")
            for param in example.get("header_text_named_params") or []:
                examples[f"header:{param.get('param_name')}"] = str(param.get("example", ""))
            values = example.get("header_text") or []
            if names and values:
                examples[f"header:{names[0]}"] = str(values[0])
        elif kind == "BODY":
            for param in example.get("body_text_named_params") or []:
                examples[f"body:{param.get('param_name')}"] = str(param.get("example", ""))
            rows = example.get("body_text") or []
            if rows and isinstance(rows[0], list):
                for index, value in enumerate(rows[0]):
                    examples[f"body:{index + 1}"] = str(value)
        elif kind == "BUTTONS":
            for index, button in enumerate(component.get("buttons") or []):
                sample = button.get("example")
                if str(button.get("type", "")).upper() == "URL" and isinstance(sample, list) and sample:
                    examples[f"button:{index}"] = str(sample[0])
    return examples


def _button(button: dict) -> dict:
    described = {"type": button.get("type"), "text": button.get("text")}
    if button.get("url"):
        described["url"] = button["url"]
    if button.get("phone_number"):
        described["phoneNumber"] = button["phone_number"]
    if str(button.get("type", "")).upper() == "COPY_CODE" and isinstance(button.get("example"), str):
        described["example"] = button["example"]
    return described


def describe_template(summary: dict, definition: dict) -> dict:
    header = body = footer = header_format = header_handle = None
    buttons: list[dict] = []
    for component in definition.get("components") or []:
        kind = str(component.get("type", "")).upper()
        if kind == "HEADER":
            header_format = str(component.get("format") or "TEXT").upper()
            if header_format == "TEXT":
                header = component.get("text")
            else:
                handles = (component.get("example") or {}).get("header_handle") or []
                header_handle = handles[0] if handles else None
        elif kind == "BODY":
            body = component.get("text")
        elif kind == "FOOTER":
            footer = component.get("text")
        elif kind == "BUTTONS":
            buttons = [_button(button) for button in component.get("buttons") or []]
    names = variable_names(body or "")
    declared = str(definition.get("parameter_format") or "").upper()
    if declared in (POSITIONAL, NAMED):
        parameter_format = declared
    else:
        parameter_format = NAMED if any(not name.isdigit() for name in names) else POSITIONAL
    return {
        "name": summary.get("templateName"),
        "language": summary.get("templateLanguage"),
        "category": summary.get("templateCategory"),
        "status": summary.get("templateStatus"),
        "qualityScore": summary.get("templateQualityScore"),
        "metaTemplateId": summary.get("metaTemplateId"),
        "header": header,
        "headerFormat": header_format,
        "headerVariableNames": variable_names(header or ""),
        "headerHandle": header_handle,
        "body": body or "",
        "footer": footer,
        "buttons": buttons,
        "variables": len(names),
        "variableNames": names,
        "parameterFormat": parameter_format,
        "examples": _examples(definition),
    }


def dynamic_url_buttons(template: dict) -> list[int]:
    """Indexes of the URL buttons whose address ends with a variable: each
    needs its suffix when the template is sent."""
    return [
        index
        for index, button in enumerate(template.get("buttons") or [])
        if str(button.get("type", "")).upper() == "URL" and VARIABLE.search(str(button.get("url") or ""))
    ]


def list_templates() -> list[dict]:
    """Every template of the business account, whatever its status."""
    waba_id = config.waba_id()
    templates = [
        describe_template(summary, _template_definition(waba_id, summary.get("metaTemplateId")))
        for summary in _template_summaries(waba_id)
    ]
    return sorted(templates, key=lambda item: (str(item["name"]), str(item["language"])))


def find_template(name: str, language: str) -> dict:
    """One template by name and language, described as ``list_templates`` does."""
    waba_id = config.waba_id()
    for summary in _template_summaries(waba_id):
        if summary.get("templateName") == name and summary.get("templateLanguage") == language:
            return describe_template(summary, _template_definition(waba_id, summary.get("metaTemplateId")))
    raise TemplateNotFound(f"There is no template {name} in {language}")


def create_template(definition: dict) -> dict:
    """Submits a new template to Meta's review: ``{metaTemplateId, status, category}``."""
    response = social_messaging.create_whatsapp_message_template(
        id=config.waba_id(),
        templateDefinition=json.dumps(definition, ensure_ascii=False).encode("utf-8"),
    )
    return {
        "metaTemplateId": response.get("metaTemplateId"),
        "status": response.get("templateStatus"),
        "category": response.get("category"),
    }


def update_template(
    meta_template_id: str,
    components: list[dict],
    parameter_format: str | None = None,
    category: str | None = None,
) -> None:
    """Replaces every component of a template; Meta reviews it again."""
    kwargs: dict = {
        "id": config.waba_id(),
        "metaTemplateId": meta_template_id,
        "templateComponents": json.dumps(components, ensure_ascii=False).encode("utf-8"),
    }
    if parameter_format:
        kwargs["parameterFormat"] = parameter_format.lower()
    if category:
        kwargs["templateCategory"] = category
    social_messaging.update_whatsapp_message_template(**kwargs)


def delete_template(name: str, meta_template_id: str | None = None) -> None:
    """Deletes one language version (with its id) or, by name alone, every language."""
    kwargs: dict = {"id": config.waba_id(), "templateName": name}
    if meta_template_id:
        kwargs["metaTemplateId"] = meta_template_id
    social_messaging.delete_whatsapp_message_template(**kwargs)


# What each End User Messaging Social error means for the web.
CLIENT_ERRORS = {
    "InvalidParametersException": (422, "META_REJECTED", "WhatsApp rejected the request"),
    "ValidationException": (422, "VALIDATION_ERROR", "The request is not valid"),
    "AccessDeniedByMetaException": (
        403,
        "META_ACCESS_DENIED",
        "Meta denied the request: check the WhatsApp Business Account permissions",
    ),
    "AccessDeniedException": (403, "ACCESS_DENIED", "The backend is not allowed to do this in AWS"),
    "ThrottledRequestException": (429, "THROTTLED", "Too many requests to WhatsApp: try again in a moment"),
    "ResourceNotFoundException": (404, "NOT_FOUND", "WhatsApp could not find it"),
}


def client_error(error: Exception) -> tuple[int, str, str]:
    """``(HTTP status, error code, message)`` for an End User Messaging Social error."""
    details = (getattr(error, "response", None) or {}).get("Error", {})
    status, code, message = CLIENT_ERRORS.get(
        details.get("Code", ""), (502, "SOCIAL_MESSAGING_ERROR", "WhatsApp rejected the request")
    )
    reason = str(details.get("Message") or "").strip()
    return status, code, f"{message}: {reason}" if reason else message
