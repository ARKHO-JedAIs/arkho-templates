"""Sending through AWS End User Messaging Social.

The payloads are the WhatsApp Cloud API ones: End User Messaging Social
forwards them to Meta as they are, signed with the function's IAM role, so no
Meta access token is ever stored.
"""
import json
import re

import boto3

from . import config

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


def send_template(phone: str, name: str, language: str, parameters: list[str]) -> str | None:
    template: dict = {"name": name, "language": {"code": language}}
    if parameters:
        template["components"] = [
            {
                "type": "body",
                "parameters": [{"type": "text", "text": value} for value in parameters],
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


def list_templates() -> list[dict]:
    """The approved templates of the business account, with their body text.

    Only APPROVED ones are returned: Meta rejects sending any other.
    """
    waba_id = config.waba_id()
    summaries: list[dict] = []
    kwargs = {"id": waba_id, "maxResults": 100}
    while True:
        response = social_messaging.list_whatsapp_message_templates(**kwargs)
        summaries.extend(response.get("templates", []))
        if not response.get("nextToken"):
            break
        kwargs["nextToken"] = response["nextToken"]

    templates = []
    for summary in summaries:
        if summary.get("templateStatus") != "APPROVED":
            continue
        body = ""
        meta_template_id = summary.get("metaTemplateId")
        if meta_template_id:
            definition = json.loads(
                social_messaging.get_whatsapp_message_template(
                    id=waba_id, metaTemplateId=meta_template_id
                ).get("template")
                or "{}"
            )
            for component in definition.get("components") or []:
                if str(component.get("type", "")).upper() == "BODY":
                    body = component.get("text", "")
        templates.append(
            {
                "name": summary.get("templateName"),
                "language": summary.get("templateLanguage"),
                "category": summary.get("templateCategory"),
                "body": body,
                "variables": len(VARIABLE.findall(body)),
            }
        )
    return sorted(templates, key=lambda item: (str(item["name"]), str(item["language"])))
