"""Request helpers shared by the WhatsApp API handlers."""
import json


class BadRequest(ValueError):
    """The request body or query is invalid; the message is safe to return."""


def get_body(event: dict) -> dict:
    raw = event.get("body")
    if raw is None or len(str(raw).strip()) == 0:
        return {}
    try:
        body = json.loads(raw)
    except json.JSONDecodeError as error:
        raise BadRequest("The body is not valid JSON") from error
    if not isinstance(body, dict):
        raise BadRequest("Expected a JSON object")
    return body


def get_query(event: dict, name: str) -> str:
    return str((event.get("queryStringParameters") or {}).get(name) or "").strip()


def get_caller(event: dict) -> dict:
    """Who is calling, from the Lambda authorizer context (src/lambda/core/authorizer)."""
    authorizer = (event.get("requestContext") or {}).get("authorizer") or {}
    return {
        "username": str(authorizer.get("username") or authorizer.get("userId") or ""),
        "email": str(authorizer.get("email") or ""),
    }


def require_text(body: dict, name: str, max_length: int) -> str:
    value = str(body.get(name) or "").strip()
    if len(value) == 0:
        raise BadRequest(f"{name} is required")
    if len(value) > max_length:
        raise BadRequest(f"{name} must have at most {max_length} characters")
    return value
