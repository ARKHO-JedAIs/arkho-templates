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
) -> str | None:
    """Sends an approved template, filling its body variables in order.

    A NAMED template needs each value tagged with its variable name, so pass
    ``parameter_names`` (same order as ``parameters``) for those.
    """
    template: dict = {"name": name, "language": {"code": language}}
    if parameters:
        names = parameter_names or []
        template["components"] = [
            {
                "type": "body",
                "parameters": [
                    {"type": "text", "parameter_name": names[index], "text": value}
                    if index < len(names)
                    else {"type": "text", "text": value}
                    for index, value in enumerate(parameters)
                ],
            }
        ]
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


def describe_template(summary: dict, definition: dict) -> dict:
    header = body = footer = None
    buttons: list[dict] = []
    for component in definition.get("components") or []:
        kind = str(component.get("type", "")).upper()
        if kind == "HEADER" and str(component.get("format", "TEXT")).upper() == "TEXT":
            header = component.get("text")
        elif kind == "BODY":
            body = component.get("text")
        elif kind == "FOOTER":
            footer = component.get("text")
        elif kind == "BUTTONS":
            buttons = [
                {"type": button.get("type"), "text": button.get("text")}
                for button in component.get("buttons") or []
            ]
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
        "body": body or "",
        "footer": footer,
        "buttons": buttons,
        "variables": len(names),
        "variableNames": names,
        "parameterFormat": parameter_format,
    }


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
