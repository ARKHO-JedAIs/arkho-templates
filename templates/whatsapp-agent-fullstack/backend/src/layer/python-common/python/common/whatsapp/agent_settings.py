"""The agent's live settings: how much it remembers and how often it answers.

They sit in one Parameter Store JSON edited from the web (Agente IA), so a
change reaches ws-handler within the cache time and needs no deploy:

    {"memory": {"mode": "window", "minutes": 60},
     "rateLimit": {"enabled": true, "perHour": 30}}

``memory.mode``:

* ``off``          - the agent keeps nothing: no history and nothing stored;
* ``each_message`` - every message starts a clean conversation (what AgentCore
                     Memory keeps for long-term facts still applies);
* ``window``       - the conversation continues until the customer is silent for
                     ``minutes``; the next message starts a clean one.

A parameter that is missing or unreadable gives the defaults, so an older
deployment keeps answering.
"""
import json
import logging
import os
import time

import boto3

logger = logging.getLogger(__name__)

SETTINGS_PARAMETER_NAME = os.environ.get("AGENT_SETTINGS_PARAMETER_NAME", "")
CACHE_SECONDS = 60

MEMORY_OFF = "off"
MEMORY_EACH_MESSAGE = "each_message"
MEMORY_WINDOW = "window"
MEMORY_MODES = (MEMORY_OFF, MEMORY_EACH_MESSAGE, MEMORY_WINDOW)

MIN_MINUTES, MAX_MINUTES = 1, 10080
MIN_PER_HOUR, MAX_PER_HOUR = 1, 9999
DEFAULT_MINUTES = 60
DEFAULT_PER_HOUR = 30

_cache: dict = {"until": 0.0, "value": None}
_ssm = None


class SettingsError(ValueError):
    """A setting the web sent that is not valid."""


def _default_limit() -> dict:
    # The deploy-time AGENT_RATE_LIMIT_PER_HOUR seeds the limit until the web changes it;
    # 0 is how the deploy says "no limit".
    try:
        value = int(os.environ.get("AGENT_RATE_LIMIT_PER_HOUR") or DEFAULT_PER_HOUR)
    except ValueError:
        value = DEFAULT_PER_HOUR
    if value == 0:
        return {"enabled": False, "perHour": DEFAULT_PER_HOUR}
    return {"enabled": True, "perHour": min(max(value, MIN_PER_HOUR), MAX_PER_HOUR)}


def defaults() -> dict:
    return {
        "memory": {"mode": MEMORY_WINDOW, "minutes": DEFAULT_MINUTES},
        "rateLimit": _default_limit(),
    }


def _whole(value, low: int, high: int, name: str) -> int:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or int(value) != value:
        raise SettingsError(f"{name} must be a whole number")
    if not low <= int(value) <= high:
        raise SettingsError(f"{name} must be between {low} and {high}")
    return int(value)


def merge(current: dict, changes: dict) -> dict:
    """``current`` with the validated ``changes`` applied; raises SettingsError."""
    if not isinstance(changes, dict):
        raise SettingsError("Expected a JSON object")
    result = {"memory": dict(current["memory"]), "rateLimit": dict(current["rateLimit"])}
    memory = changes.get("memory")
    if memory is not None:
        if not isinstance(memory, dict):
            raise SettingsError("memory must be an object")
        if "mode" in memory:
            if memory["mode"] not in MEMORY_MODES:
                raise SettingsError(f"memory.mode must be one of: {', '.join(MEMORY_MODES)}")
            result["memory"]["mode"] = memory["mode"]
        if "minutes" in memory:
            result["memory"]["minutes"] = _whole(memory["minutes"], MIN_MINUTES, MAX_MINUTES, "memory.minutes")
    limit = changes.get("rateLimit")
    if limit is not None:
        if not isinstance(limit, dict):
            raise SettingsError("rateLimit must be an object")
        if "enabled" in limit:
            if not isinstance(limit["enabled"], bool):
                raise SettingsError("rateLimit.enabled must be true or false")
            result["rateLimit"]["enabled"] = limit["enabled"]
        if "perHour" in limit:
            result["rateLimit"]["perHour"] = _whole(limit["perHour"], MIN_PER_HOUR, MAX_PER_HOUR, "rateLimit.perHour")
    return result


def _client():
    global _ssm
    if _ssm is None:
        _ssm = boto3.client("ssm")
    return _ssm


def _parse(raw: str) -> dict:
    """The stored JSON over the defaults; a bad field falls back to its default."""
    settings = defaults()
    try:
        stored = json.loads(raw)
    except (TypeError, ValueError):
        return settings
    if not isinstance(stored, dict):
        return settings
    for key in ("memory", "rateLimit"):
        for field, value in (stored.get(key) or {}).items() if isinstance(stored.get(key), dict) else []:
            try:
                settings = merge(settings, {key: {field: value}})
            except SettingsError:
                logger.warning("Ignoring the invalid agent setting %s.%s", key, field)
    return settings


def read(force: bool = False) -> dict:
    """The current settings, re-read at most once a minute."""
    if not force and time.monotonic() < _cache["until"] and _cache["value"] is not None:
        return _cache["value"]
    value = defaults()
    if SETTINGS_PARAMETER_NAME:
        try:
            value = _parse(_client().get_parameter(Name=SETTINGS_PARAMETER_NAME)["Parameter"]["Value"])
        except Exception as error:  # noqa: BLE001 - unreadable: the defaults keep the agent answering
            logger.error("Could not read %s: %s", SETTINGS_PARAMETER_NAME, error)
    _cache.update(until=time.monotonic() + CACHE_SECONDS, value=value)
    return value


def write(settings: dict) -> None:
    _client().put_parameter(
        Name=SETTINGS_PARAMETER_NAME,
        Value=json.dumps(settings, separators=(",", ":")),
        Type="String",
        Overwrite=True,
    )
    _cache.update(until=0.0, value=None)


def clear_cache() -> None:
    _cache.update(until=0.0, value=None)
