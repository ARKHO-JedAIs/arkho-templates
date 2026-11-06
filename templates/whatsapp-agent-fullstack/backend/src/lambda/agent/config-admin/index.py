"""agent-config-admin: the prompt manager API (the web's "Agente IA" screen).

    GET    /admin/agent/config                     published version, draft, live and AWS console state
    PUT    /admin/agent/config/draft               save the draft {config, revision?}
    DELETE /admin/agent/config/draft               discard the draft
    POST   /admin/agent/config/publish             publish the draft {comment, revision?}
    GET    /admin/agent/config/versions            history, plus versions created in the AWS console
    GET    /admin/agent/config/versions/{version}  one version in full
    POST   /admin/agent/config/rollback            {version, comment}: use an older version again
    POST   /admin/agent/config/adopt               {bedrockVersion, comment}: use a version created in the console
    GET    /admin/agent/models                     the Claude models that can be chosen

Two services, each for what it does best:

- Amazon Bedrock Prompt Management (prompt AGENT_BEDROCK_PROMPT_NAME, created
  on first use) holds what AWS models: the instructions (system prompt), the
  model, its inference parameters and the {{variables}}. Saving a draft
  updates its DRAFT and publishing creates a Bedrock version, so the prompt can
  also be read, tested and edited in the AWS console.
- The agent-config table (PK config_id = "agent", SK version) holds what
  Bedrock does not: who published, when and why, the WhatsApp messages, the
  on/off switch, the variable values, the full history and which version is
  in use:
      draft      the draft, with a `revision` counter against concurrent edits
      v0001...   every published version (with its `bedrockVersion`), never changed
      published  pointer {current: "v0007"}
      bedrock    {promptId, promptArn}

Publishing also writes the agent's SSM parameter (AGENT_PROMPT_PARAMETER_NAME)
with the messages, the switch, the Bedrock prompt id and version, the variable
values and a copy of the instructions and model as a fallback. The agent reads
it with a 60 s cache and the Bedrock version (immutable) once. A version
created in the console is listed but only reaches the agent when someone
adopts it here, so every change has an author.

Permissions (common.access): reading and drafts need `agent.edit`; publishing,
rolling back, adopting and switching the agent on or off need `agent.publish`;
changing the model or its parameters needs `agent.model`.
"""
import json
import os
import re
from datetime import datetime, timezone
from traceback import format_exc

import boto3
from boto3.dynamodb.types import TypeSerializer
from botocore.exceptions import ClientError

from common import access, create_error_response, create_no_content_response, create_success_response, get_logger, with_cors

logger = get_logger(__name__)

TABLE_NAME = os.environ.get("AGENT_CONFIG_TABLE", "")
PARAMETER_NAME = os.environ.get("AGENT_PROMPT_PARAMETER_NAME", "")
PROMPT_NAME = os.environ.get("AGENT_BEDROCK_PROMPT_NAME", "")
DEFAULT_MODEL = {
    "id": os.environ.get("DEFAULT_MODEL_ID", "us.anthropic.claude-sonnet-4-6"),
    "temperature": float(os.environ.get("DEFAULT_MODEL_TEMPERATURE", "0.2")),
    "maxTokens": int(os.environ.get("DEFAULT_MODEL_MAX_TOKENS", "4096")),
    "topP": None,
}
CONFIG_ID = "agent"
DRAFT, PUBLISHED, BEDROCK = "draft", "published", "bedrock"
VARIANT = "default"
# The user turn of the Bedrock template: the console's test window fills it.
QUESTION_VARIABLE = "pregunta"
# SSM's Intelligent-Tiering parameters hold up to 8 KB (it carries a copy of the instructions).
MAX_PARAMETER_BYTES = 8000
MODEL_PREFIXES = ("us.anthropic.claude-", "global.anthropic.claude-")
VARIABLE = re.compile(r"\{\{\s*([A-Za-z][A-Za-z0-9_]{0,99})\s*\}\}")

# Web field -> SSM key the agent reads (agent_core.config).
FIELDS = {
    "enabled": "enabled",
    "businessName": "businessName",
    "instructions": "basePrompt",
    "greeting": "greeting",
    "refusal": "refusal",
    "handoffMessage": "handoffMessage",
}
TEXT_LIMITS = {
    "businessName": (2, 80),
    "instructions": (50, 7000),
    "greeting": (1, 1000),
    "refusal": (1, 1000),
    "handoffMessage": (1, 1000),
}
ALL_FIELDS = set(FIELDS) | {"model", "parameters"}

dynamodb = boto3.resource("dynamodb")
# The plain client for transactions: the resource's own client (table.meta.client)
# serializes values itself, and typed() values would be serialized twice.
dynamodb_client = boto3.client("dynamodb")
ssm = boto3.client("ssm")
bedrock_agent = boto3.client("bedrock-agent")
bedrock = boto3.client("bedrock")
bedrock_runtime = boto3.client("bedrock-runtime")
_serializer = TypeSerializer()


class ApiError(Exception):
    def __init__(self, status: int, code: str, message: str):
        super().__init__(message)
        self.status = status
        self.code = code


def typed(values: dict) -> dict:
    """Low-level client format, for transact_write_items."""
    return {key: _serializer.serialize(value) for key, value in values.items()}


def table():
    return dynamodb.Table(TABLE_NAME)


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def who(event: dict) -> str:
    authorizer = (event.get("requestContext") or {}).get("authorizer") or {}
    return str(authorizer.get("email") or authorizer.get("username") or "")


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


def require(event: dict, permission: str) -> None:
    if not access.allowed(event, permission):
        raise ApiError(403, "FORBIDDEN", "Your profile cannot do this")


def plain(value):
    """DynamoDB numbers come back as Decimal: back to int/float for JSON and comparisons."""
    from decimal import Decimal

    if isinstance(value, Decimal):
        return int(value) if value == value.to_integral_value() else float(value)
    if isinstance(value, dict):
        return {key: plain(item) for key, item in value.items()}
    if isinstance(value, list):
        return [plain(item) for item in value]
    return value


def for_dynamo(value):
    """Floats cannot go to DynamoDB through the resource: Decimal instead."""
    from decimal import Decimal

    if isinstance(value, float):
        return Decimal(str(value))
    if isinstance(value, dict):
        return {key: for_dynamo(item) for key, item in value.items()}
    if isinstance(value, list):
        return [for_dynamo(item) for item in value]
    return value


def variables_of(text: str) -> list[str]:
    names = []
    for name in VARIABLE.findall(text or ""):
        if name not in names and name != QUESTION_VARIABLE:
            names.append(name)
    return names


# --- configuration ------------------------------------------------------------


def complete(config: dict) -> dict:
    """A stored config with every field (versions from before the model and the variables existed)."""
    config = plain(dict(config or {}))
    model = {**DEFAULT_MODEL, **(config.get("model") or {})}
    return {**config, "model": model, "parameters": dict(config.get("parameters") or {})}


def validate(config) -> dict:
    if not isinstance(config, dict):
        raise ApiError(422, "VALIDATION_ERROR", "config must be an object")
    unknown = sorted(set(config) - ALL_FIELDS)
    if unknown:
        raise ApiError(422, "VALIDATION_ERROR", f"Unknown fields: {', '.join(unknown)}")
    clean = {}
    if not isinstance(config.get("enabled"), bool):
        raise ApiError(422, "VALIDATION_ERROR", "enabled must be true or false")
    clean["enabled"] = config["enabled"]
    for field, (low, high) in TEXT_LIMITS.items():
        value = config.get(field)
        if not isinstance(value, str) or not low <= len(value.strip()) <= high:
            raise ApiError(422, "VALIDATION_ERROR", f"{field} must have {low} to {high} characters")
        clean[field] = value.strip()

    model = {**DEFAULT_MODEL, **(config.get("model") or {})}
    if not isinstance(model.get("id"), str) or not model["id"].startswith(MODEL_PREFIXES):
        raise ApiError(422, "VALIDATION_ERROR", "model.id must be a Claude model (us.anthropic.claude-... or global.anthropic.claude-...)")
    try:
        temperature = float(model["temperature"])
        max_tokens = int(model["maxTokens"])
        top_p = None if model.get("topP") in (None, "") else float(model["topP"])
    except (TypeError, ValueError) as error:
        raise ApiError(422, "VALIDATION_ERROR", "model.temperature, maxTokens and topP must be numbers") from error
    if not 0 <= temperature <= 1 or not 256 <= max_tokens <= 8192 or (top_p is not None and not 0 < top_p <= 1):
        raise ApiError(422, "VALIDATION_ERROR", "temperature 0 to 1, maxTokens 256 to 8192, topP 0 to 1")
    clean["model"] = {"id": model["id"], "temperature": temperature, "maxTokens": max_tokens, "topP": top_p}

    parameters = config.get("parameters") or {}
    if not isinstance(parameters, dict):
        raise ApiError(422, "VALIDATION_ERROR", "parameters must be an object")
    clean["parameters"] = {}
    for name in variables_of(clean["instructions"]):
        value = str(parameters.get(name) or "").strip()
        if not value or len(value) > 200:
            raise ApiError(422, "MISSING_VARIABLE", f"Give {{{{{name}}}}} a value (1 to 200 characters) in Parámetros")
        clean["parameters"][name] = value

    size = len(json.dumps(to_live(clean, {"timezone": "America/Santiago"}, None), ensure_ascii=False, indent=2).encode("utf-8"))
    if size > MAX_PARAMETER_BYTES:
        raise ApiError(422, "TOO_LONG", f"The configuration takes {size} bytes; the limit is {MAX_PARAMETER_BYTES}. Shorten the instructions.")
    return clean


def model_changed(config: dict, other: dict) -> bool:
    return complete(config)["model"] != complete(other)["model"]


# --- the live parameter -------------------------------------------------------


def read_live() -> dict:
    raw = ssm.get_parameter(Name=PARAMETER_NAME)["Parameter"]["Value"]
    value = json.loads(raw)
    return value if isinstance(value, dict) else {}


def from_live(live: dict) -> dict:
    config = {field: live.get(key, True if field == "enabled" else "") for field, key in FIELDS.items()}
    return complete({**config, "model": live.get("model") or {}, "parameters": live.get("parameters") or {}})


def to_live(config: dict, live: dict, bedrock_version: str | None) -> dict:
    """The parameter value: the config over what else the live one has (timezone...)."""
    value = dict(live)
    for field, key in FIELDS.items():
        value[key] = config[field]
    value["model"] = config["model"]
    value["parameters"] = config["parameters"]
    meta = prompt_meta() if bedrock_version else None
    if meta:
        value["bedrockPrompt"] = {"id": meta["promptId"], "version": bedrock_version}
    else:
        value.pop("bedrockPrompt", None)
    return value


def write_live(config: dict, bedrock_version: str | None) -> None:
    value = json.dumps(to_live(config, read_live(), bedrock_version), ensure_ascii=False, indent=2)
    ssm.put_parameter(Name=PARAMETER_NAME, Value=value, Type="String", Overwrite=True, Tier="Intelligent-Tiering")


# --- Bedrock Prompt Management ------------------------------------------------


def prompt_meta() -> dict | None:
    item = get_item(BEDROCK)
    return plain(item) if item else None


def variant_of(config: dict) -> dict:
    model = config["model"]
    inference = {"temperature": model["temperature"], "maxTokens": model["maxTokens"]}
    if model.get("topP") is not None:
        inference["topP"] = model["topP"]
    names = variables_of(config["instructions"]) + [QUESTION_VARIABLE]
    return {
        "name": VARIANT,
        "templateType": "CHAT",
        "modelId": model["id"],
        "templateConfiguration": {
            "chat": {
                "system": [{"text": config["instructions"]}],
                "messages": [{"role": "user", "content": [{"text": "{{" + QUESTION_VARIABLE + "}}"}]}],
                "inputVariables": [{"name": name} for name in names],
            }
        },
        "inferenceConfiguration": {"text": inference},
    }


def from_variant(variant: dict) -> dict:
    """The instructions and model of a Bedrock prompt variant."""
    chat = (variant.get("templateConfiguration") or {}).get("chat") or {}
    text_config = (variant.get("templateConfiguration") or {}).get("text") or {}
    system = "".join(block.get("text", "") for block in chat.get("system") or []) or text_config.get("text", "")
    inference = (variant.get("inferenceConfiguration") or {}).get("text") or {}
    return {
        "instructions": system,
        "model": {
            "id": variant.get("modelId") or DEFAULT_MODEL["id"],
            "temperature": float(inference.get("temperature", DEFAULT_MODEL["temperature"])),
            "maxTokens": int(inference.get("maxTokens", DEFAULT_MODEL["maxTokens"])),
            "topP": float(inference["topP"]) if inference.get("topP") is not None else None,
        },
    }


def default_variant(prompt: dict) -> dict:
    variants = prompt.get("variants") or []
    name = prompt.get("defaultVariant") or VARIANT
    return next((v for v in variants if v.get("name") == name), variants[0] if variants else {})


def ensure_prompt(config: dict) -> dict:
    """The Bedrock prompt of this agent: found by name or created from `config`."""
    meta = prompt_meta()
    if meta:
        return meta
    found, token = None, None
    while not found:
        page = bedrock_agent.list_prompts(**({"nextToken": token} if token else {}))
        found = next((p for p in page.get("promptSummaries", []) if p.get("name") == PROMPT_NAME), None)
        token = page.get("nextToken")
        if not token:
            break
    if not found:
        found = bedrock_agent.create_prompt(
            name=PROMPT_NAME,
            description="WhatsApp agent instructions, managed from the web's Agente IA screen",
            variants=[variant_of(config)],
            defaultVariant=VARIANT,
        )
    meta = {"promptId": found["id"], "promptArn": found["arn"]}
    table().put_item(Item={"config_id": CONFIG_ID, "version": BEDROCK, **meta})
    return meta


def update_bedrock_draft(config: dict) -> None:
    meta = ensure_prompt(config)
    bedrock_agent.update_prompt(
        promptIdentifier=meta["promptId"],
        name=PROMPT_NAME,
        description="WhatsApp agent instructions, managed from the web's Agente IA screen",
        variants=[variant_of(config)],
        defaultVariant=VARIANT,
    )


def bedrock_draft() -> dict | None:
    meta = prompt_meta()
    if not meta:
        return None
    try:
        return from_variant(default_variant(bedrock_agent.get_prompt(promptIdentifier=meta["promptId"])))
    except ClientError:
        logger.warning(f"could not read the Bedrock draft: {format_exc()}")
        return None


def bedrock_versions() -> list[dict]:
    meta = prompt_meta()
    if not meta:
        return []
    versions, token = [], None
    while True:
        kwargs = {"promptIdentifier": meta["promptId"], **({"nextToken": token} if token else {})}
        page = bedrock_agent.list_prompts(**kwargs)
        versions += [p for p in page.get("promptSummaries", []) if str(p.get("version")) != "DRAFT"]
        token = page.get("nextToken")
        if not token:
            return versions


def check_model(model_id: str) -> None:
    """One-token call, so a model without access in the account is rejected here and not by the agent."""
    try:
        bedrock_runtime.converse(
            modelId=model_id,
            messages=[{"role": "user", "content": [{"text": "ok"}]}],
            inferenceConfig={"maxTokens": 1},
        )
    except ClientError as error:
        code = error.response.get("Error", {}).get("Code", "")
        raise ApiError(422, "MODEL_UNAVAILABLE", f"{model_id} cannot be used in this account ({code}). Enable it in Bedrock or choose another.") from error


def list_models() -> list[dict]:
    models, token = [], None
    while True:
        page = bedrock.list_inference_profiles(**({"nextToken": token} if token else {}))
        for profile in page.get("inferenceProfileSummaries", []):
            if profile.get("inferenceProfileId", "").startswith(MODEL_PREFIXES) and profile.get("status") == "ACTIVE":
                models.append({"id": profile["inferenceProfileId"], "name": profile.get("inferenceProfileName", "")})
        token = page.get("nextToken")
        if not token:
            break
    return sorted(models, key=lambda model: model["id"])


# --- table --------------------------------------------------------------------


def get_item(version: str) -> dict | None:
    return table().get_item(Key={"config_id": CONFIG_ID, "version": version}).get("Item")


def version_view(item: dict) -> dict:
    item = plain(item)
    return {
        "version": item["version"],
        "config": complete(item["config"]),
        "bedrockVersion": item.get("bedrockVersion"),
        "publishedAt": item.get("publishedAt"),
        "publishedBy": item.get("publishedBy"),
        "comment": item.get("comment", ""),
        "rollbackOf": item.get("rollbackOf"),
        "source": item.get("source", "web"),
    }


def published() -> dict:
    """The active version; "v0000" (the deployed parameter) before the first publish."""
    pointer = get_item(PUBLISHED)
    if pointer:
        item = get_item(pointer["current"])
        if item:
            return version_view(item)
    return {
        "version": "v0000",
        "config": from_live(read_live()),
        "bedrockVersion": None,
        "publishedAt": None,
        "publishedBy": "despliegue",
        "comment": "Configuración desplegada",
        "source": "deploy",
    }


def draft_view(item: dict | None) -> dict | None:
    if not item:
        return None
    item = plain(item)
    return {
        "config": complete(item["config"]),
        "revision": int(item.get("revision", 0)),
        "updatedAt": item.get("updatedAt"),
        "updatedBy": item.get("updatedBy"),
        "basedOn": item.get("basedOn"),
    }


def next_version(current: str) -> str:
    number = int(current[1:]) if current.startswith("v") and current[1:].isdigit() else 0
    return f"v{number + 1:04d}"


def save_draft(event: dict, body: dict) -> dict:
    config = validate(body.get("config"))
    current = get_item(DRAFT)
    revision = int(current.get("revision", 0)) if current else 0
    expected = body.get("revision")
    if current and expected is not None and int(expected) != revision:
        raise ApiError(409, "CONFLICT", "Someone else saved the draft meanwhile; reload to see their changes")
    active = published()
    if config["enabled"] != active["config"].get("enabled"):
        require(event, "agent.publish")
    if model_changed(config, active["config"]):
        require(event, "agent.model")
    update_bedrock_draft(config)
    item = {
        "config_id": CONFIG_ID,
        "version": DRAFT,
        "config": for_dynamo(config),
        "revision": revision + 1,
        "updatedAt": now(),
        "updatedBy": who(event),
        "basedOn": current.get("basedOn", active["version"]) if current else active["version"],
    }
    table().put_item(Item=item)
    return draft_view(item)


def publish(
    event: dict,
    config: dict,
    comment: str,
    *,
    bedrock_version: str | None = None,
    rollback_of: str | None = None,
    draft_revision: int | None = None,
    source: str = "web",
) -> dict:
    """Records `config` as the next version and makes it live. Without a
    `bedrock_version`, the Bedrock DRAFT is set to `config` and versioned."""
    active = published()
    if model_changed(config, active["config"]):
        require(event, "agent.model")
        check_model(config["model"]["id"])
    if bedrock_version is None:
        update_bedrock_draft(config)
        meta = prompt_meta()
        created = bedrock_agent.create_prompt_version(promptIdentifier=meta["promptId"], description=(comment or "Publicada desde la web")[:200])
        bedrock_version = str(created["version"])

    pointer = get_item(PUBLISHED)
    current = pointer["current"] if pointer else "v0000"
    version = next_version(current)
    item = {
        "config_id": CONFIG_ID,
        "version": version,
        "config": config,
        "bedrockVersion": bedrock_version,
        "publishedAt": now(),
        "publishedBy": who(event),
        "comment": comment,
        "source": source,
        **({"rollbackOf": rollback_of} if rollback_of else {}),
    }
    writes = [
        {"Put": {"TableName": TABLE_NAME, "Item": typed(for_dynamo(item)), "ConditionExpression": "attribute_not_exists(config_id)"}},
        {
            "Put": {
                "TableName": TABLE_NAME,
                "Item": typed({"config_id": CONFIG_ID, "version": PUBLISHED, "current": version, "updatedAt": item["publishedAt"]}),
                "ConditionExpression": "attribute_not_exists(config_id) OR #current = :current",
                "ExpressionAttributeNames": {"#current": "current"},
                "ExpressionAttributeValues": typed({":current": current}),
            }
        },
    ]
    if draft_revision is not None:
        writes.append({
            "Delete": {
                "TableName": TABLE_NAME,
                "Key": typed({"config_id": CONFIG_ID, "version": DRAFT}),
                "ConditionExpression": "revision = :revision",
                "ExpressionAttributeValues": typed({":revision": draft_revision}),
            }
        })
    try:
        dynamodb_client.transact_write_items(TransactItems=writes)
    except ClientError as error:
        if error.response.get("Error", {}).get("Code") == "TransactionCanceledException":
            reasons = [reason.get("Code") for reason in error.response.get("CancellationReasons", [])]
            if any(code not in ("None", "ConditionalCheckFailed", "TransactionConflict") for code in reasons):
                logger.error(f"publish transaction rejected: {error.response.get('CancellationReasons')}")
                raise
            raise ApiError(409, "CONFLICT", "The configuration changed meanwhile; reload and try again") from error
        raise
    try:
        write_live(config, bedrock_version)
    except Exception as error:  # noqa: BLE001
        logger.error(format_exc())
        raise ApiError(502, "NOT_APPLIED", f"{version} was saved but could not be applied to the agent; publish again") from error
    logger.info(json.dumps({"audit": "agent-config", "action": source if source != "web" else ("rollback" if rollback_of else "publish"), "version": version, "bedrockVersion": bedrock_version, "actor": who(event)}))
    return version_view(item)


def list_versions() -> dict:
    items, start = [], None
    while True:
        kwargs = {
            "KeyConditionExpression": "config_id = :id AND begins_with(version, :v)",
            "ExpressionAttributeValues": {":id": CONFIG_ID, ":v": "v"},
            "ScanIndexForward": False,
        }
        if start:
            kwargs["ExclusiveStartKey"] = start
        page = table().query(**kwargs)
        items += page.get("Items", [])
        start = page.get("LastEvaluatedKey")
        if not start:
            break
    versions = [{key: value for key, value in version_view(item).items() if key != "config"} for item in items]
    known = {str(item.get("bedrockVersion")) for item in versions if item.get("bedrockVersion")}
    console = []
    try:
        for summary in bedrock_versions():
            if str(summary.get("version")) not in known:
                created = summary.get("createdAt")
                console.append({
                    "bedrockVersion": str(summary["version"]),
                    "createdAt": created.isoformat() if hasattr(created, "isoformat") else created,
                    "description": summary.get("description", ""),
                })
    except ClientError:
        logger.warning(f"could not list the Bedrock versions: {format_exc()}")
    console.sort(key=lambda item: int(item["bedrockVersion"]) if item["bedrockVersion"].isdigit() else 0, reverse=True)
    return {"versions": versions, "consoleVersions": console}


# --- routes -------------------------------------------------------------------


def route(event: dict):
    method = str(event.get("httpMethod") or "").upper()
    resource = str(event.get("resource") or "")
    base = "/admin/agent/config"

    if resource == base and method == "GET":
        require(event, "agent.edit")
        active = published()
        draft = draft_view(get_item(DRAFT))
        shown = (draft or active)["config"]
        console = bedrock_draft()
        console_changed = bool(console) and (console["instructions"] != shown["instructions"] or console["model"] != shown["model"])
        meta = prompt_meta()
        return create_success_response(data={
            "published": active,
            "draft": draft,
            "liveMatches": from_live(read_live()) == active["config"],
            "consoleDraft": console if console_changed else None,
            "bedrockPrompt": {"id": meta["promptId"], "arn": meta["promptArn"], "name": PROMPT_NAME} if meta else None,
        })
    if resource == f"{base}/draft" and method == "PUT":
        require(event, "agent.edit")
        return create_success_response(data=save_draft(event, body_of(event)))
    if resource == f"{base}/draft" and method == "DELETE":
        require(event, "agent.edit")
        table().delete_item(Key={"config_id": CONFIG_ID, "version": DRAFT})
        return create_no_content_response()
    if resource == f"{base}/publish" and method == "POST":
        require(event, "agent.publish")
        body = body_of(event)
        draft = get_item(DRAFT)
        if not draft:
            raise ApiError(409, "NO_DRAFT", "There is no draft to publish")
        revision = int(draft.get("revision", 0))
        if body.get("revision") is not None and int(body["revision"]) != revision:
            raise ApiError(409, "CONFLICT", "The draft changed meanwhile; reload and review it")
        comment = str(body.get("comment") or "").strip()[:300]
        return create_success_response(data=publish(event, validate(complete(draft["config"])), comment, draft_revision=revision))
    if resource == f"{base}/versions" and method == "GET":
        require(event, "agent.edit")
        return create_success_response(data=list_versions())
    if resource == f"{base}/versions/{{version}}" and method == "GET":
        require(event, "agent.edit")
        version = str((event.get("pathParameters") or {}).get("version") or "")
        item = get_item(version) if version.startswith("v") else None
        if not item:
            raise ApiError(404, "NOT_FOUND", "Unknown version")
        return create_success_response(data=version_view(item))
    if resource == f"{base}/rollback" and method == "POST":
        require(event, "agent.publish")
        body = body_of(event)
        version = str(body.get("version") or "")
        item = get_item(version) if version.startswith("v") else None
        if not item:
            raise ApiError(404, "NOT_FOUND", "Unknown version")
        old = version_view(item)
        comment = str(body.get("comment") or "").strip()[:300] or f"Vuelve a {version}"
        return create_success_response(data=publish(
            event, validate(old["config"]), comment, bedrock_version=old.get("bedrockVersion"), rollback_of=version
        ))
    if resource == f"{base}/adopt" and method == "POST":
        require(event, "agent.publish")
        body = body_of(event)
        bedrock_version = str(body.get("bedrockVersion") or "")
        meta = prompt_meta()
        if not meta or not bedrock_version.isdigit():
            raise ApiError(404, "NOT_FOUND", "Unknown Bedrock version")
        try:
            prompt = bedrock_agent.get_prompt(promptIdentifier=meta["promptId"], promptVersion=bedrock_version)
        except ClientError as error:
            raise ApiError(404, "NOT_FOUND", "Unknown Bedrock version") from error
        config = validate({**published()["config"], **from_variant(default_variant(prompt))})
        comment = str(body.get("comment") or "").strip()[:300] or f"Versión {bedrock_version} creada en la consola de AWS"
        return create_success_response(data=publish(event, config, comment, bedrock_version=bedrock_version, source="console"))
    if resource == "/admin/agent/models" and method == "GET":
        require(event, "agent.edit")
        return create_success_response(data=list_models())
    raise ApiError(404, "NOT_FOUND", "Unknown route")


@with_cors()
def handler(event, context):
    try:
        return route(event)
    except ApiError as error:
        return create_error_response(str(error), error.status, error.code)
    except Exception:  # noqa: BLE001
        logger.error(format_exc())
        return create_error_response("Failed to manage the agent configuration", 500, "INTERNAL_ERROR")
