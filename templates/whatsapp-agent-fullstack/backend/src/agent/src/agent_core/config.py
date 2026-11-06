"""Environment variables and the admin-editable agent parameter.

``RuntimeConfig`` is what the deployment sets (env vars, read per request so
tests and local runs can change them). ``AgentSettings`` is what an admin
edits from the web: a JSON String parameter in SSM Parameter Store, cached
for ``SETTINGS_TTL_SECONDS`` so a change reaches every warm container within a
minute without a redeploy.

When the parameter names a Bedrock Prompt Management version
(``bedrockPrompt: {id, version}``, written by the web's prompt manager), the
instructions, the model and its inference parameters come from that version
(immutable, so it is read once per container). The parameter's own copy is
the fallback when Bedrock cannot be read. ``{{variables}}`` in the
instructions are filled with the parameter's ``parameters``.
"""
import json
import logging
import os
import re
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
    # Model overrides from the prompt manager; empty/None = the deployment's (RuntimeConfig).
    model_id: str = ""
    temperature: float | None = None
    max_tokens: int | None = None
    top_p: float | None = None
    # Where the instructions came from: "bedrock:<id>:<version>", "parameter" or "default".
    prompt_source: str = "default"


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


@lru_cache(maxsize=1)
def _bedrock_agent_client(region: str):
    return boto3.client("bedrock-agent", region_name=region)


_VARIABLE = re.compile(r"\{\{\s*([A-Za-z][A-Za-z0-9_]{0,99})\s*\}\}")
# Published Bedrock prompt versions never change: one read per container.
_prompt_versions: dict = {}


def fill_variables(text: str, values: dict) -> str:
    """Replaces {{name}} with its value; a variable without one is left as written."""
    return _VARIABLE.sub(lambda match: str(values.get(match.group(1), match.group(0))), text)


def _number(value, kind):
    try:
        return kind(value) if value is not None and value != "" else None
    except (TypeError, ValueError):
        return None


def _model_changes(model) -> dict:
    if not isinstance(model, dict):
        return {}
    changes = {}
    if isinstance(model.get("id"), str) and model["id"].strip():
        changes["model_id"] = model["id"].strip()
    for key, field_name, kind in (("temperature", "temperature", float), ("maxTokens", "max_tokens", int), ("topP", "top_p", float)):
        number = _number(model.get(key), kind)
        if number is not None:
            changes[field_name] = number
    return changes


def bedrock_prompt(region: str, prompt_id: str, version: str) -> dict:
    """{instructions, model} of one Bedrock prompt version (cached: versions are immutable)."""
    key = (prompt_id, version)
    if key not in _prompt_versions:
        prompt = _bedrock_agent_client(region).get_prompt(promptIdentifier=prompt_id, promptVersion=version)
        variants = prompt.get("variants") or []
        variant = next((v for v in variants if v.get("name") == prompt.get("defaultVariant")), variants[0] if variants else {})
        chat = (variant.get("templateConfiguration") or {}).get("chat") or {}
        text = (variant.get("templateConfiguration") or {}).get("text") or {}
        inference = (variant.get("inferenceConfiguration") or {}).get("text") or {}
        _prompt_versions[key] = {
            "instructions": "".join(block.get("text", "") for block in chat.get("system") or []) or text.get("text", ""),
            "model": {
                "id": variant.get("modelId") or "",
                "temperature": inference.get("temperature"),
                "maxTokens": inference.get("maxTokens"),
                "topP": inference.get("topP"),
            },
        }
    return _prompt_versions[key]


def resolve_prompt(settings: "AgentSettings", raw: str, region: str) -> "AgentSettings":
    """Instructions and model from the Bedrock version the parameter names, else from the parameter."""
    try:
        data = json.loads(raw)
    except (TypeError, ValueError):
        return settings
    if not isinstance(data, dict):
        return settings
    values = data.get("parameters") if isinstance(data.get("parameters"), dict) else {}
    changes = {**_model_changes(data.get("model")), "prompt_source": "parameter"}
    base_prompt = settings.base_prompt
    reference = data.get("bedrockPrompt")
    if isinstance(reference, dict) and reference.get("id") and reference.get("version"):
        try:
            version = bedrock_prompt(region, str(reference["id"]), str(reference["version"]))
            if version["instructions"].strip():
                base_prompt = version["instructions"].strip()
                changes.update(_model_changes(version["model"]))
                changes["prompt_source"] = f"bedrock:{reference['id']}:{reference['version']}"
        except Exception:  # noqa: BLE001 - the parameter's copy keeps the agent answering
            logger.exception("Could not read Bedrock prompt %s version %s, using the parameter's copy", reference.get("id"), reference.get("version"))
    return replace(settings, base_prompt=fill_variables(base_prompt, values), **changes)


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
        settings = resolve_prompt(parse_settings(raw), raw, config.region)
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
    _prompt_versions.clear()


def with_model(config: RuntimeConfig, settings: AgentSettings) -> RuntimeConfig:
    """The deployment's config with the prompt manager's model choices on top."""
    changes = {}
    if settings.model_id:
        changes["model_id"] = settings.model_id
    if settings.temperature is not None:
        changes["temperature"] = settings.temperature
    if settings.max_tokens is not None:
        changes["max_tokens"] = settings.max_tokens
    return replace(config, **changes) if changes else config
