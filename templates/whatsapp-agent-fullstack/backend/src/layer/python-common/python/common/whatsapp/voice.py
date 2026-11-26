"""Voice settings: whether the agent uses voice at all, the Polly voice that
reads answers aloud, when it does, and the language Amazon Transcribe hears
received voice notes in.

They live in one Parameter Store parameter (VOICE_SETTINGS_PARAMETER_NAME, a
JSON object) that the web's "Voz" page writes, so a change applies without a
deploy: readers cache it for ``CACHE_SECONDS``. Without the parameter, or when
it cannot be read, the defaults below apply (the same values the CDK seeds).

``provider`` is ``polly`` or ``none``: with ``none`` voice notes reach the agent
as plain "[Audio]" and answers are text only. ``replyWithAudio`` says when an
answer is also sent as audio: ``off``, ``voice_notes`` (to a customer who wrote
by voice) or ``always``.
"""
import json
import os
import time

import boto3

PARAMETER_NAME = os.environ.get("VOICE_SETTINGS_PARAMETER_NAME", "")
CACHE_SECONDS = 60

PROVIDER_KEY = "provider"
REPLY_KEY = "replyWithAudio"
VOICE_ID_KEY = "voiceId"
ENGINE_KEY = "engine"
TRANSCRIBE_LANGUAGE_KEY = "transcribeLanguage"
UPDATED_BY_KEY = "updatedBy"
UPDATED_AT_KEY = "updatedAt"

PROVIDERS = ("none", "polly")
REPLY_MODES = ("off", "voice_notes", "always")

# Polly has no Chilean Spanish; es-US Lupe (neural) is the closest neutral voice.
DEFAULTS = {
    # Without the parameter this deployment has no voice (VOICE_PROVIDER=none): no provider.
    PROVIDER_KEY: "polly" if PARAMETER_NAME else "none",
    REPLY_KEY: "voice_notes",
    VOICE_ID_KEY: os.environ.get("POLLY_VOICE_ID", "Lupe"),
    ENGINE_KEY: os.environ.get("POLLY_ENGINE", "neural"),
    TRANSCRIBE_LANGUAGE_KEY: os.environ.get("TRANSCRIBE_LANGUAGE_CODE", "es-US"),
}

# The Spanish variants Amazon Transcribe hears in a batch job.
TRANSCRIBE_LANGUAGES = {
    "es-US": "Español latino (es-US)",
    "es-ES": "Español de España (es-ES)",
}

_ssm = None
_cache: tuple[float, dict] | None = None


def _client():
    global _ssm
    if _ssm is None:
        _ssm = boto3.client("ssm")
    return _ssm


def _merge(stored: dict) -> dict:
    merged = dict(DEFAULTS)
    for key in (
        PROVIDER_KEY,
        REPLY_KEY,
        VOICE_ID_KEY,
        ENGINE_KEY,
        TRANSCRIBE_LANGUAGE_KEY,
        UPDATED_BY_KEY,
        UPDATED_AT_KEY,
    ):
        value = str(stored.get(key) or "").strip()
        if value:
            merged[key] = value
    if merged[TRANSCRIBE_LANGUAGE_KEY] not in TRANSCRIBE_LANGUAGES:
        merged[TRANSCRIBE_LANGUAGE_KEY] = DEFAULTS[TRANSCRIBE_LANGUAGE_KEY]
    if merged[PROVIDER_KEY] not in PROVIDERS:
        merged[PROVIDER_KEY] = DEFAULTS[PROVIDER_KEY]
    if merged[REPLY_KEY] not in REPLY_MODES:
        merged[REPLY_KEY] = DEFAULTS[REPLY_KEY]
    return merged


def read(fresh: bool = False) -> dict:
    """``{provider, replyWithAudio, voiceId, engine, transcribeLanguage, updatedBy?, updatedAt?}``, cached 60 s.

    ``fresh`` skips the cache (the settings page reads what it just wrote).
    """
    global _cache
    if not fresh and _cache and time.monotonic() - _cache[0] < CACHE_SECONDS:
        return _cache[1]
    stored: dict = {}
    if PARAMETER_NAME:
        try:
            raw = _client().get_parameter(Name=PARAMETER_NAME)["Parameter"]["Value"]
            value = json.loads(raw)
            stored = value if isinstance(value, dict) else {}
        except Exception:  # noqa: BLE001 - an unreadable parameter falls back to the defaults
            stored = {}
    settings = _merge(stored)
    _cache = (time.monotonic(), settings)
    return settings


def enabled() -> bool:
    """Whether the agent uses voice: Polly is the chosen provider."""
    return read()[PROVIDER_KEY] == "polly"


def write(settings: dict) -> dict:
    """Stores the settings (already validated) and returns them as read back."""
    global _cache
    if not PARAMETER_NAME:
        raise RuntimeError("VOICE_SETTINGS_PARAMETER_NAME is not configured")
    value = _merge(settings)
    _client().put_parameter(
        Name=PARAMETER_NAME,
        Value=json.dumps(value, ensure_ascii=False),
        Type="String",
        Overwrite=True,
    )
    _cache = (time.monotonic(), value)
    return value
