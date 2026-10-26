import json
import os

import boto3

# Name of the Parameter Store parameter holding the WhatsApp configuration
# (src/parameter/whatsapp-configuration.json). Injected by WhatsAppFactory.
CONFIGURATION_PARAMETER_NAME = os.environ.get("WHATSAPP_CONFIGURATION_PARAMETER_NAME", "")

ORIGINATION_PHONE_NUMBER_ID_KEY = "origination_phone_number_id"
WABA_ID_KEY = "whatsapp_business_account_id"
META_API_VERSION_KEY = "meta_api_version"
DEFAULT_PHONE_PREFIX_KEY = "default_phone_prefix"
AUTO_REPLY_MESSAGE_KEY = "auto_reply_message"

DEFAULT_META_API_VERSION = "v20.0"

ssm = boto3.client("ssm")

_cache: dict | None = None


class ConfigurationError(ValueError):
    """The WhatsApp configuration is missing a value the caller needs."""


def get_configuration() -> dict:
    """The WhatsApp configuration, read once per container.

    The parameter only changes with a deploy or a manual edit, and a cold start
    picks the new value up, so re-reading it on every message would be a
    Parameter Store call per message for nothing.
    """
    global _cache
    if _cache is None:
        if len(CONFIGURATION_PARAMETER_NAME) == 0:
            raise ConfigurationError("WHATSAPP_CONFIGURATION_PARAMETER_NAME is required")
        raw = ssm.get_parameter(Name=CONFIGURATION_PARAMETER_NAME)["Parameter"]["Value"]
        configuration = json.loads(raw)
        if not isinstance(configuration, dict):
            raise ConfigurationError(f"{CONFIGURATION_PARAMETER_NAME} is not a JSON object")
        _cache = configuration
    return _cache


def get_value(key: str, required: bool = True) -> str:
    value = str(get_configuration().get(key) or "").strip()
    if required and len(value) == 0:
        raise ConfigurationError(f"The WhatsApp configuration has no {key}")
    return value


def origination_phone_number_id() -> str:
    return get_value(ORIGINATION_PHONE_NUMBER_ID_KEY)


def waba_id() -> str:
    return get_value(WABA_ID_KEY)


def meta_api_version() -> str:
    return get_value(META_API_VERSION_KEY, required=False) or DEFAULT_META_API_VERSION


def default_phone_prefix() -> str:
    return get_value(DEFAULT_PHONE_PREFIX_KEY, required=False).lstrip("+")


def auto_reply_message() -> str:
    return get_value(AUTO_REPLY_MESSAGE_KEY, required=False)
