"""roles-admin: create roles and choose what each one sees and does.

    GET    /admin/access                 the roles with their permissions, and the catalogs
    POST   /admin/access/roles           create a role {id, name, description?, menu?, actions?}
    PUT    /admin/access/roles/{role}    change a role {name?, description?, menu?, actions?}
    DELETE /admin/access/roles/{role}    delete a role made from the web (nobody may hold it)

Everything needs `access.manage`. The rules the API applies, whatever the screen does:

- `developer` holds every permission in code: it is shown to developers, never edited;
- the system roles (admin, member) change permissions but are never deleted;
- nobody grants a permission they do not hold themselves, so a role cannot be
  used to climb above its editor;
- nobody removes `access` or `access.manage` from a role they belong to, which
  would lock them out of this screen;
- a role made from the web is a Cognito group named like its id.

Permissions live in the access-control table; the other APIs read them with a
60 s cache, so a change reaches everyone within a minute and needs no deploy.
"""
import json
import os
from datetime import datetime, timezone
from traceback import format_exc

import boto3
from botocore.exceptions import ClientError

from common import (
    access,
    create_error_response,
    create_no_content_response,
    create_success_response,
    get_logger,
    with_cors,
)

logger = get_logger(__name__)

TABLE_NAME = os.environ.get("ACCESS_TABLE_NAME", "")
USER_POOL_ID = os.environ.get("USER_POOL_ID", "")
NEEDED = "access.manage"
# Whoever edits roles keeps this screen: it cannot be taken from their own role.
SELF_KEEP = ("access", "access.manage")

cognito = boto3.client("cognito-idp")
dynamodb = boto3.resource("dynamodb")


class ApiError(Exception):
    def __init__(self, status: int, code: str, message: str):
        super().__init__(message)
        self.status = status
        self.code = code


def table():
    return dynamodb.Table(TABLE_NAME)


def caller(event: dict) -> dict:
    authorizer = (event.get("requestContext") or {}).get("authorizer") or {}
    return {
        "username": str(authorizer.get("username") or ""),
        "groups": [group for group in str(authorizer.get("groups") or "").split(",") if group],
    }


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


def audit(event: dict, action: str, target: str, **details) -> None:
    """One JSON line per successful change, for CloudWatch Logs Insights."""
    entry = {"audit": "roles-admin", "action": action, "actor": caller(event)["username"], "target": target}
    entry.update({key: value for key, value in details.items() if value is not None})
    logger.info(json.dumps(entry, sort_keys=True))


def text_of(body: dict, key: str, limit: int, required: bool = False) -> str | None:
    if key not in body:
        if required:
            raise ApiError(422, "VALIDATION_ERROR", f"{key} is required")
        return None
    value = str(body.get(key) or "").strip()
    if required and not value:
        raise ApiError(422, "VALIDATION_ERROR", f"{key} is required")
    if len(value) > limit:
        raise ApiError(422, "VALIDATION_ERROR", f"{key} is at most {limit} characters")
    return value


def ids_of(body: dict, key: str, catalog: dict) -> list[str] | None:
    """A list of catalog ids, in the catalog's order, or None when the body does not carry it."""
    if key not in body:
        return None
    values = body.get(key)
    if not isinstance(values, list) or any(value not in catalog for value in values):
        raise ApiError(422, "VALIDATION_ERROR", f"{key} must be a list of: {', '.join(catalog)}")
    return [item for item in catalog if item in values]


def held_by_caller(event: dict) -> tuple[set, set]:
    permissions = access.permissions_for(caller(event)["groups"])
    return set(permissions["menu"]), set(permissions["actions"])


def stored_permissions(role: str) -> dict:
    item = table().get_item(Key={"PK": f"ROLE#{role}", "SK": "PERMS"}).get("Item")
    if item:
        return {"menu": list(item.get("menu") or []), "actions": list(item.get("actions") or [])}
    return access.role_permissions(role)


def describe(role: str) -> dict:
    name, description = access.role_label(role)
    developer = role == access.DEVELOPER
    permissions = access.role_permissions(role) if developer else stored_permissions(role)
    return {
        "id": role,
        "name": name,
        "description": description,
        "system": role in access.SYSTEM_ROLES,
        "locked": developer,
        "permissions": {
            "menu": [item for item in permissions["menu"] if item in access.MENUS],
            "actions": [item for item in permissions["actions"] if item in access.ACTIONS],
        },
    }


def check_grants(event: dict, role: str, menu: list[str] | None, actions: list[str] | None) -> None:
    """Nobody gives more than they have, and nobody locks themselves out of this screen."""
    if access.is_developer(caller(event)["groups"]):
        return
    held_menu, held_actions = held_by_caller(event)
    before = stored_permissions(role)
    # A permission the role already had stays even if the editor lacks it: only new grants are checked.
    for item in (menu or []):
        if item not in held_menu and item not in before["menu"]:
            raise ApiError(403, "PERMISSION_NOT_HELD", f"You cannot grant a page you do not have: {item}")
    for item in (actions or []):
        if item not in held_actions and item not in before["actions"]:
            raise ApiError(403, "PERMISSION_NOT_HELD", f"You cannot grant an action you do not have: {item}")
    if role in caller(event)["groups"]:
        kept = set(menu if menu is not None else before["menu"]) | set(actions if actions is not None else before["actions"])
        if any(item not in kept for item in SELF_KEEP):
            raise ApiError(409, "SELF_LOCKOUT", "You cannot remove access to this screen from your own role")


def write_permissions(event: dict, role: str, menu: list[str], actions: list[str]) -> None:
    table().put_item(
        Item={
            "PK": f"ROLE#{role}",
            "SK": "PERMS",
            "menu": menu,
            "actions": actions,
            "updatedAt": datetime.now(timezone.utc).isoformat(),
            "updatedBy": caller(event)["username"] or "web",
        }
    )


def visible_roles(event: dict) -> list[str]:
    roles = access.all_roles()
    if access.is_developer(caller(event)["groups"]):
        return roles
    return [role for role in roles if role not in access.HIDDEN_ROLES]


def editable_role(event: dict, role: str) -> str:
    if role == access.DEVELOPER:
        raise ApiError(409, "ROLE_LOCKED", "The developer role holds every permission and cannot be edited")
    if role not in visible_roles(event):
        raise ApiError(404, "NOT_FOUND", "Unknown role")
    return role


def list_access(event: dict) -> dict:
    return {
        "roles": [describe(role) for role in visible_roles(event)],
        "menu": [{"id": key, "label": label} for key, label in access.MENUS.items()],
        "actions": [{"id": key, "label": label} for key, label in access.ACTIONS.items()],
    }


def create_role(event: dict, body: dict) -> dict:
    role = str(body.get("id") or "").strip().lower()
    if not access.ROLE_ID_PATTERN.match(role):
        raise ApiError(422, "VALIDATION_ERROR", "id: 2 to 30 characters, lowercase letters, digits and hyphens, starting with a letter")
    if role in access.all_roles():
        raise ApiError(409, "ROLE_EXISTS", "A role with that id already exists")
    name = text_of(body, "name", 60, required=True)
    description = text_of(body, "description", 200) or ""
    menu = ids_of(body, "menu", access.MENUS) or []
    actions = ids_of(body, "actions", access.ACTIONS) or []
    check_grants(event, role, menu, actions)
    try:
        cognito.create_group(UserPoolId=USER_POOL_ID, GroupName=role, Description=f"Role: {name}")
    except cognito.exceptions.GroupExistsException as error:
        raise ApiError(409, "ROLE_EXISTS", "A group with that id already exists") from error
    now = datetime.now(timezone.utc).isoformat()
    table().put_item(
        Item={
            "PK": f"ROLE#{role}",
            "SK": "META",
            "name": name,
            "description": description,
            "system": False,
            "hidden": False,
            "updatedAt": now,
            "updatedBy": caller(event)["username"] or "web",
        }
    )
    write_permissions(event, role, menu, actions)
    access.clear_cache()
    return describe(role)


def update_role(event: dict, role: str, body: dict) -> dict:
    editable_role(event, role)
    menu = ids_of(body, "menu", access.MENUS)
    actions = ids_of(body, "actions", access.ACTIONS)
    name = text_of(body, "name", 60, required="name" in body)
    description = text_of(body, "description", 200)
    check_grants(event, role, menu, actions)
    if menu is not None or actions is not None:
        before = stored_permissions(role)
        write_permissions(
            event,
            role,
            menu if menu is not None else [item for item in before["menu"] if item in access.MENUS],
            actions if actions is not None else [item for item in before["actions"] if item in access.ACTIONS],
        )
    if (name is not None or description is not None) and role not in access.SYSTEM_ROLES:
        values, names = {":by": caller(event)["username"] or "web", ":at": datetime.now(timezone.utc).isoformat()}, {}
        sets = ["updatedBy = :by", "updatedAt = :at"]
        if name is not None:
            sets.append("#n = :name")
            names["#n"] = "name"
            values[":name"] = name
        if description is not None:
            sets.append("description = :description")
            values[":description"] = description
        kwargs = {"ExpressionAttributeNames": names} if names else {}
        table().update_item(
            Key={"PK": f"ROLE#{role}", "SK": "META"},
            UpdateExpression="SET " + ", ".join(sets),
            ExpressionAttributeValues=values,
            **kwargs,
        )
    access.clear_cache()
    return describe(role)


def delete_role(event: dict, role: str) -> None:
    editable_role(event, role)
    if role in access.SYSTEM_ROLES:
        raise ApiError(409, "ROLE_SYSTEM", "The roles that come with the project cannot be deleted")
    if role in caller(event)["groups"]:
        raise ApiError(409, "SELF_CHANGE", "You cannot delete a role you hold")
    members = cognito.list_users_in_group(UserPoolId=USER_POOL_ID, GroupName=role, Limit=1)
    if members.get("Users"):
        raise ApiError(409, "ROLE_IN_USE", "Move its users to another role before deleting it")
    try:
        cognito.delete_group(UserPoolId=USER_POOL_ID, GroupName=role)
    except cognito.exceptions.ResourceNotFoundException:
        pass  # the group is already gone; the table items below still go
    table().delete_item(Key={"PK": f"ROLE#{role}", "SK": "PERMS"})
    table().delete_item(Key={"PK": f"ROLE#{role}", "SK": "META"})
    access.clear_cache()


def route(event: dict):
    method = str(event.get("httpMethod") or "").upper()
    resource = str(event.get("resource") or "")
    role = str((event.get("pathParameters") or {}).get("role") or "")

    if resource == "/admin/access" and method == "GET":
        return create_success_response(data=list_access(event))
    if resource == "/admin/access/roles" and method == "POST":
        created = create_role(event, body_of(event))
        audit(event, "create", created["id"], menu=created["permissions"]["menu"], actions=created["permissions"]["actions"])
        return create_success_response(data=created, status_code=201)
    if resource == "/admin/access/roles/{role}" and role:
        if method == "PUT":
            updated = update_role(event, role, body_of(event))
            audit(event, "update", role, menu=updated["permissions"]["menu"], actions=updated["permissions"]["actions"])
            return create_success_response(data=updated)
        if method == "DELETE":
            delete_role(event, role)
            audit(event, "delete", role)
            return create_no_content_response()
    raise ApiError(404, "NOT_FOUND", "Unknown route")


@with_cors()
def handler(event, context):
    if not access.has(caller(event)["groups"], NEEDED):
        return create_error_response("Only people who manage roles can do this", 403, "FORBIDDEN")
    try:
        return route(event)
    except ApiError as error:
        return create_error_response(str(error), error.status, error.code)
    except ClientError as error:
        logger.error(format_exc())
        return create_error_response(error.response["Error"].get("Message", "Cognito error"), 400, "COGNITO_ERROR")
    except Exception:  # noqa: BLE001
        logger.error(format_exc())
        return create_error_response("Failed to manage roles", 500, "INTERNAL_ERROR")
