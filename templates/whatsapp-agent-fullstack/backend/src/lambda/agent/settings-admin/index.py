"""settings-admin: the agent's memory and answer limit, edited from the web.

    GET /admin/agent/settings    the current settings
    PUT /admin/agent/settings    change some of them {memory?, rateLimit?}

Reading needs the `agent` page; changing needs `agent.settings`. The settings
are one Parameter Store JSON (common.whatsapp.agent_settings) that ws-handler
re-reads every minute, so a change takes effect without a deploy and is not a
published version: there is no draft to publish.
"""
import json
import os
from traceback import format_exc

from common import (
    access,
    create_error_response,
    create_success_response,
    get_logger,
    with_cors,
)
from common.whatsapp import agent_settings

logger = get_logger(__name__)

# What AgentCore Memory keeps beyond a conversation, fixed at deploy time.
LONG_TERM_MODE = os.environ.get("AGENT_MEMORY_MODE", "off")


class ApiError(Exception):
    def __init__(self, status: int, code: str, message: str):
        super().__init__(message)
        self.status = status
        self.code = code


def actor(event: dict) -> str:
    authorizer = (event.get("requestContext") or {}).get("authorizer") or {}
    return str(authorizer.get("username") or "")


def body_of(event: dict) -> dict:
    raw = event.get("body")
    if not raw:
        return {}
    try:
        body = json.loads(raw)
    except json.JSONDecodeError as error:
        raise ApiError(422, "VALIDATION_ERROR", "The body is not valid JSON") from error
    if not isinstance(body, dict):
        raise ApiError(422, "VALIDATION_ERROR", "Expected a JSON object")
    return body


def view(settings: dict) -> dict:
    return {**settings, "longTermMemory": LONG_TERM_MODE}


def route(event: dict):
    method = str(event.get("httpMethod") or "").upper()
    if method == "GET":
        if not access.allowed(event, "agent"):
            raise ApiError(403, "FORBIDDEN", "You cannot see the agent settings")
        return create_success_response(data=view(agent_settings.read(force=True)))
    if method == "PUT":
        if not access.allowed(event, "agent.settings"):
            raise ApiError(403, "FORBIDDEN", "You cannot change the agent settings")
        try:
            updated = agent_settings.merge(agent_settings.read(force=True), body_of(event))
        except agent_settings.SettingsError as error:
            raise ApiError(422, "VALIDATION_ERROR", str(error)) from error
        agent_settings.write(updated)
        logger.info(json.dumps({"audit": "agent-settings", "actor": actor(event), "settings": updated}, sort_keys=True))
        return create_success_response(data=view(updated))
    raise ApiError(404, "NOT_FOUND", "Unknown route")


@with_cors()
def handler(event, context):
    try:
        return route(event)
    except ApiError as error:
        return create_error_response(str(error), error.status, error.code)
    except Exception:  # noqa: BLE001
        logger.error(format_exc())
        return create_error_response("Failed to manage the agent settings", 500, "INTERNAL_ERROR")
