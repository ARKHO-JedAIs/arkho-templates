"""Environment variables and the admin-editable agent parameter.

``RuntimeConfig`` is what the deployment sets (env vars, read per request so
tests and local runs can change them). ``AgentSettings`` is what an admin
edits from the web: a JSON String parameter in SSM Parameter Store, cached
for ``SETTINGS_TTL_SECONDS`` so a change reaches every warm container within a
minute without a redeploy.
"""
import json
import logging
import os
import threading
import time
from dataclasses import dataclass, replace
from functools import lru_cache

import boto3

logger = logging.getLogger(__name__)

SETTINGS_TTL_SECONDS = 60

MEMORY_OFF = "off"
MEMORY_CONVERSATION = "conversation"
MEMORY_FACTS = "facts"
MEMORY_FACTS_SUMMARIES = "facts_summaries"
MEMORY_MODES = (MEMORY_OFF, MEMORY_CONVERSATION, MEMORY_FACTS, MEMORY_FACTS_SUMMARIES)

# Default long-term namespaces; they must match the strategies of the Memory
# resource. AgentCore resolves the placeholders per request.
DEFAULT_FACTS_NAMESPACE = "/facts/{actorId}"
DEFAULT_PREFERENCES_NAMESPACE = "/preferences/{actorId}"
DEFAULT_SUMMARIES_NAMESPACE = "/summaries/{actorId}/{sessionId}"

GENERIC_ERROR_MESSAGE = (
    "Lo siento, tuvimos un problema al procesar tu mensaje. Por favor, inténtalo de nuevo en unos minutos."
)
INPUT_TOO_LONG_MESSAGE = "Tu mensaje es muy largo. ¿Puedes resumirlo en un mensaje más corto?"
EMPTY_INPUT_MESSAGE = "No recibí ningún texto. ¿En qué te puedo ayudar?"


def _env_int(name: str, default: int, minimum: int = 1) -> int:
    raw = os.environ.get(name, "").strip()
    try:
        return max(int(raw), minimum) if raw else default
    except ValueError:
        logger.warning("%s is not an integer, using %s", name, default)
        return default


def _env_float(name: str, default: float) -> float:
    raw = os.environ.get(name, "").strip()
    try:
        return float(raw) if raw else default
    except ValueError:
        logger.warning("%s is not a number, using %s", name, default)
        return default


@dataclass(frozen=True)
class RuntimeConfig:
    model_id: str
    max_tokens: int
    temperature: float
    region: str
    prompt_parameter_name: str
    memory_id: str
    memory_mode: str
    facts_namespace: str
    preferences_namespace: str
    summaries_namespace: str
    conversations_table: str
    messages_table: str
    appsync_url: str
    admin_group: str
    business_api_url: str
    max_tool_iterations: int

    @property
    def memory_enabled(self) -> bool:
        return bool(self.memory_id) and self.memory_mode != MEMORY_OFF


def runtime_config() -> RuntimeConfig:
    memory_id = os.environ.get("AGENT_MEMORY_ID", "").strip()
    memory_mode = os.environ.get("AGENT_MEMORY_MODE", "").strip().lower() or (
        MEMORY_CONVERSATION if memory_id else MEMORY_OFF
    )
    if memory_mode not in MEMORY_MODES:
        logger.warning("AGENT_MEMORY_MODE %r is not one of %s, memory is off", memory_mode, MEMORY_MODES)
        memory_mode = MEMORY_OFF
    return RuntimeConfig(
        model_id=os.environ.get("MODEL_ID", "").strip() or "us.anthropic.claude-sonnet-4-6",
        max_tokens=_env_int("MODEL_MAX_TOKENS", 1000),
        temperature=_env_float("MODEL_TEMPERATURE", 0.2),
        region=os.environ.get("AWS_REGION", "").strip() or os.environ.get("AWS_DEFAULT_REGION", "").strip() or "us-east-1",
        prompt_parameter_name=os.environ.get("AGENT_PROMPT_PARAMETER_NAME", "").strip(),
        memory_id=memory_id,
        memory_mode=memory_mode,
        facts_namespace=os.environ.get("AGENT_MEMORY_FACTS_NAMESPACE", "").strip() or DEFAULT_FACTS_NAMESPACE,
        preferences_namespace=os.environ.get("AGENT_MEMORY_PREFERENCES_NAMESPACE", "").strip()
        or DEFAULT_PREFERENCES_NAMESPACE,
        summaries_namespace=os.environ.get("AGENT_MEMORY_SUMMARIES_NAMESPACE", "").strip()
        or DEFAULT_SUMMARIES_NAMESPACE,
        conversations_table=os.environ.get("WHATSAPP_CONVERSATIONS_TABLE_NAME", "").strip(),
        messages_table=os.environ.get("WHATSAPP_MESSAGES_TABLE_NAME", "").strip(),
        appsync_url=os.environ.get("APPSYNC_GRAPHQL_URL", "").strip(),
        admin_group=os.environ.get("WHATSAPP_ADMIN_GROUP", "").strip(),
        business_api_url=os.environ.get("AGENT_BUSINESS_API_URL", "").strip(),
        max_tool_iterations=_env_int("AGENT_MAX_TOOL_ITERATIONS", 6),
    )


@dataclass(frozen=True)
class AgentSettings:
    enabled: bool = True
    base_prompt: str = (
        "Eres el asistente virtual de atención al cliente. Responde con amabilidad, de forma breve y clara, "
        "y ayuda con consultas sobre los productos y servicios de la empresa."
    )
    business_name: str = "la empresa"
    greeting: str = "¡Hola! Soy el asistente virtual. ¿En qué te puedo ayudar?"
    refusal: str = "Lo siento, no puedo ayudarte con eso. ¿Hay algo más en lo que te pueda ayudar?"
    handoff_message: str = (
        "Te voy a comunicar con una persona del equipo. Te responderá por este mismo chat a la brevedad."
    )
    support_message: str = (
        "Siento mucho que estés pasando por esto. No estás solo ni sola: si estás en peligro, llama ahora al "
        "número de emergencias de tu país. Le pedí a una persona del equipo que te escriba por este mismo chat."
    )
    timezone: str = "UTC"


_PARAMETER_KEYS = {
    "enabled": "enabled",
    "basePrompt": "base_prompt",
    "businessName": "business_name",
    "greeting": "greeting",
    "refusal": "refusal",
    "handoffMessage": "handoff_message",
    "supportMessage": "support_message",
    "timezone": "timezone",
}

_cache_lock = threading.Lock()
_cache: dict = {"name": None, "settings": None, "expires": 0.0}


@lru_cache(maxsize=1)
def _ssm_client(region: str):
    return boto3.client("ssm", region_name=region)


def parse_settings(raw: str) -> AgentSettings:
    """The settings in the parameter JSON; anything missing or invalid keeps its default."""
    settings = AgentSettings()
    try:
        data = json.loads(raw)
    except (TypeError, ValueError):
        logger.warning("The agent parameter is not valid JSON, using the defaults")
        return settings
    if not isinstance(data, dict):
        return settings
    changes = {}
    for key, field_name in _PARAMETER_KEYS.items():
        value = data.get(key)
        if field_name == "enabled":
            if isinstance(value, bool):
                changes[field_name] = value
        elif isinstance(value, str) and value.strip():
            changes[field_name] = value.strip()
    return replace(settings, **changes)


def load_settings(config: RuntimeConfig, clock=time.monotonic) -> AgentSettings:
    """The admin settings, from a 60 s in-process cache or SSM; defaults when unavailable."""
    name = config.prompt_parameter_name
    if not name:
        return AgentSettings()
    now = clock()
    with _cache_lock:
        if _cache["name"] == name and _cache["settings"] is not None and now < _cache["expires"]:
            return _cache["settings"]
    try:
        raw = _ssm_client(config.region).get_parameter(Name=name)["Parameter"]["Value"]
        settings = parse_settings(raw)
    except Exception:  # noqa: BLE001
        logger.exception("Could not read the agent parameter %s, using the last known or default settings", name)
        with _cache_lock:
            if _cache["name"] == name and _cache["settings"] is not None:
                return _cache["settings"]
        settings = AgentSettings()
    with _cache_lock:
        _cache.update({"name": name, "settings": settings, "expires": now + SETTINGS_TTL_SECONDS})
    return settings


def clear_settings_cache() -> None:
    with _cache_lock:
        _cache.update({"name": None, "settings": None, "expires": 0.0})
