"""voice-config: the web's "Voz" page.

    GET  /whatsapp/voice          the settings, the Spanish Polly voices and the Transcribe languages
    PUT  /whatsapp/voice          {provider, replyWithAudio, voiceId, engine, transcribeLanguage}: saved at once
    POST /whatsapp/voice/preview  {voiceId, engine, text?}: an MP3 sample (base64) to listen to

The settings live in the voice-settings parameter (common.whatsapp.voice); the
agent worker reads it with a 60 s cache, so a change applies without a deploy.
The voices are read from Polly (DescribeVoices), so the list is always the one
the account can use. Every call needs the `voice` page permission.
"""
import base64
from datetime import datetime, timezone
from traceback import format_exc

import boto3

from common import create_error_response, create_success_response, get_logger, with_cors
from common.whatsapp import http, speech, voice

logger = get_logger(__name__)

PERMISSION = "voice"
LANGUAGE_PREFIX = "es-"
LANGUAGE_LABELS = {
    "es-US": "Español (EE.UU.)",
    "es-MX": "Español (México)",
    "es-ES": "Español (España)",
}
ENGINE_ORDER = ("neural", "generative", "standard", "long-form")
SAMPLE_TEXT = "Hola, soy el asistente virtual. Así suena mi voz cuando te respondo por audio."
MAX_SAMPLE_CHARS = 300

polly = boto3.client("polly")


def spanish_voices() -> list[dict]:
    """Every Spanish Polly voice: ``{id, name, gender, languageCode, languageName, engines}``."""
    voices: list[dict] = []
    token = None
    while True:
        response = polly.describe_voices(**({"NextToken": token} if token else {}))
        for item in response.get("Voices", []):
            code = str(item.get("LanguageCode") or "")
            if not code.startswith(LANGUAGE_PREFIX):
                continue
            engines = [e for e in ENGINE_ORDER if e in (item.get("SupportedEngines") or [])]
            voices.append(
                {
                    "id": item.get("Id"),
                    "name": item.get("Name") or item.get("Id"),
                    "gender": item.get("Gender") or "",
                    "languageCode": code,
                    "languageName": LANGUAGE_LABELS.get(code, item.get("LanguageName") or code),
                    "engines": engines,
                }
            )
        token = response.get("NextToken")
        if not token:
            break
    return sorted(voices, key=lambda v: (v["languageCode"] != "es-US", v["languageCode"], v["name"]))


def validated(body: dict, voices: list[dict], require_language: bool = True) -> dict:
    voice_id = http.require_text(body, "voiceId", 40)
    engine = http.require_text(body, "engine", 20)
    match = next((v for v in voices if v["id"] == voice_id), None)
    if match is None:
        raise http.BadRequest(f"{voice_id} is not a Spanish Polly voice")
    if engine not in match["engines"]:
        raise http.BadRequest(f"{voice_id} does not support the {engine} engine")
    settings = {voice.VOICE_ID_KEY: voice_id, voice.ENGINE_KEY: engine}
    if require_language:
        provider = http.require_text(body, "provider", 10)
        if provider not in voice.PROVIDERS:
            raise http.BadRequest(f"provider must be one of {', '.join(voice.PROVIDERS)}")
        reply = http.require_text(body, "replyWithAudio", 20)
        if reply not in voice.REPLY_MODES:
            raise http.BadRequest(f"replyWithAudio must be one of {', '.join(voice.REPLY_MODES)}")
        settings[voice.PROVIDER_KEY] = provider
        settings[voice.REPLY_KEY] = reply
        language = http.require_text(body, "transcribeLanguage", 10)
        if language not in voice.TRANSCRIBE_LANGUAGES:
            raise http.BadRequest(f"transcribeLanguage must be one of {', '.join(voice.TRANSCRIBE_LANGUAGES)}")
        settings[voice.TRANSCRIBE_LANGUAGE_KEY] = language
    return settings


def state(voices: list[dict]) -> dict:
    return {
        "settings": voice.read(fresh=True),
        "voices": voices,
        "languages": [{"code": code, "label": label} for code, label in voice.TRANSCRIBE_LANGUAGES.items()],
        "providers": list(voice.PROVIDERS),
        "replyModes": list(voice.REPLY_MODES),
    }


def get_settings() -> dict:
    return create_success_response(data=state(spanish_voices()))


def put_settings(event: dict) -> dict:
    voices = spanish_voices()
    try:
        settings = validated(http.get_body(event), voices)
    except http.BadRequest as error:
        return create_error_response(str(error), 422, "VALIDATION_ERROR")
    caller = http.get_caller(event)
    settings[voice.UPDATED_BY_KEY] = caller["email"] or caller["username"]
    settings[voice.UPDATED_AT_KEY] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    voice.write(settings)
    logger.info("Voice settings changed: %s", {k: v for k, v in settings.items() if k != voice.UPDATED_BY_KEY})
    return create_success_response(data=state(voices))


def preview(event: dict) -> dict:
    try:
        body = http.get_body(event)
        settings = validated(body, spanish_voices(), require_language=False)
        text = str(body.get("text") or "").strip() or SAMPLE_TEXT
        if len(text) > MAX_SAMPLE_CHARS:
            raise http.BadRequest(f"text must have at most {MAX_SAMPLE_CHARS} characters")
    except http.BadRequest as error:
        return create_error_response(str(error), 422, "VALIDATION_ERROR")
    audio = speech.synthesize(text, settings[voice.VOICE_ID_KEY], settings[voice.ENGINE_KEY])
    return create_success_response(
        data={"audio": base64.b64encode(audio).decode("ascii"), "mimeType": speech.MIME_TYPE}
    )


@with_cors()
def handler(event, context):
    if not http.is_allowed(event, PERMISSION):
        return create_error_response("Your profile cannot change the voice", 403, "FORBIDDEN")
    method = str(event.get("httpMethod") or "").upper()
    path = str(event.get("resource") or event.get("path") or "")
    try:
        if path.endswith("/preview") and method == "POST":
            return preview(event)
        if method == "GET":
            return get_settings()
        if method == "PUT":
            return put_settings(event)
    except Exception:  # noqa: BLE001
        logger.error(format_exc())
        return create_error_response("The voice settings could not be processed", 500, "INTERNAL_ERROR")
    return create_error_response("Not found", 404, "NOT_FOUND")
