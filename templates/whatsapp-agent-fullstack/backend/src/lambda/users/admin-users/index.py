"""admin-users: the user-management API the frontend's Usuarios screen calls.

One function for every route under /admin/users (UsersFactory):

    GET    /admin/users                       list
    POST   /admin/users                       create {email, name?, roles?}
    PATCH  /admin/users/{username}            update {name?, email?, roles?}
    PATCH  /admin/users/{username}/status     enable / disable {enabled}
    POST   /admin/users/{username}/password   new temporary password
    DELETE /admin/users/{username}            delete
    GET    /admin/roles                       the roles the caller may assign

Roles are Cognito groups: `developer` (hidden), `admin` and `member`.

With the access-control table (ACCESS_TABLE_NAME, common.access):
- the routes need `users.manage` (GET /admin/roles needs `users.assign_roles`);
- a caller only assigns the roles common.access.assignable_roles gives them:
  a developer every role, an admin admin and member;
- only a developer sees, edits, disables, resets or deletes a developer;
- a user whose roles change is signed out everywhere, so their next sign-in
  carries the new roles.
Without it, only members of ADMIN_GROUP may call it (any signed-in user when
it is empty) and the roles are admin and member.

Nobody may disable, delete or change the roles of their own account, so an
admin can never lock themselves out.
"""
import json
import os
import secrets
import string
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

USER_POOL_ID = os.environ.get("USER_POOL_ID", "")
ADMIN_GROUP = os.environ.get("ADMIN_GROUP", "")
MEMBER_GROUP = os.environ.get("MEMBER_GROUP", "member")
DEVELOPER_GROUP = os.environ.get("DEVELOPER_GROUP", "developer")
ROLE_GROUPS = {"developer": DEVELOPER_GROUP, "admin": ADMIN_GROUP or "admin", "member": MEMBER_GROUP}
GROUP_ROLES = {group: role for role, group in ROLE_GROUPS.items()}

cognito = boto3.client("cognito-idp")


class ApiError(Exception):
    def __init__(self, status: int, code: str, message: str):
        super().__init__(message)
        self.status = status
        self.code = code


def caller(event: dict) -> dict:
    authorizer = (event.get("requestContext") or {}).get("authorizer") or {}
    return {
        "username": str(authorizer.get("username") or ""),
        "sub": str(authorizer.get("userId") or ""),
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


def access_enabled() -> bool:
    return bool(os.environ.get("ACCESS_TABLE_NAME"))


def assignable(event: dict) -> list[str]:
    """The roles the caller may give or take away."""
    if access_enabled():
        return [role for role in access.assignable_roles(caller(event)["groups"]) if role in ROLE_GROUPS]
    return ["admin", "member"]


def caller_is_developer(event: dict) -> bool:
    return access_enabled() and access.is_developer(caller(event)["groups"])


def roles_of(event: dict, body: dict) -> list[str] | None:
    roles = body.get("roles")
    if roles is None:
        return None
    if not isinstance(roles, list) or any(role not in ROLE_GROUPS for role in roles):
        raise ApiError(422, "VALIDATION_ERROR", f"roles must be a list of {', '.join(ROLE_GROUPS)}")
    allowed = assignable(event)
    if any(role not in allowed for role in roles):
        raise ApiError(403, "ROLE_NOT_ALLOWED", f"You can only assign {', '.join(allowed) or 'no roles'}")
    return sorted(set(roles), key=list(ROLE_GROUPS).index)


def protect(event: dict, username: str) -> None:
    """Only a developer may touch a developer's account."""
    if access_enabled() and not caller_is_developer(event) and "developer" in user_roles(username):
        raise ApiError(403, "FORBIDDEN", "Only a developer can manage this account")


def attributes(user: dict) -> dict:
    return {item["Name"]: item["Value"] for item in user.get("Attributes") or user.get("UserAttributes") or []}


def user_roles(username: str) -> list[str]:
    groups = cognito.admin_list_groups_for_user(UserPoolId=USER_POOL_ID, Username=username)
    roles = {GROUP_ROLES[g["GroupName"]] for g in groups.get("Groups", []) if g["GroupName"] in GROUP_ROLES}
    return [role for role in ROLE_GROUPS if role in roles]


def to_user(user: dict) -> dict:
    attrs = attributes(user)
    created = user.get("UserCreateDate")
    username = user["Username"]
    return {
        "username": username,
        "sub": attrs.get("sub"),
        "email": attrs.get("email"),
        "name": attrs.get("name"),
        "roles": user_roles(username),
        "enabled": bool(user.get("Enabled", True)),
        "status": user.get("UserStatus"),
        "createdAt": created.isoformat() if hasattr(created, "isoformat") else created,
    }


def set_roles(username: str, roles: list[str], allowed: list[str]) -> bool:
    """Leaves the roles the caller may not assign as they are. True when something changed."""
    current = set(user_roles(username))
    changed = False
    for role in allowed:
        group = ROLE_GROUPS[role]
        if role in roles and role not in current:
            cognito.admin_add_user_to_group(UserPoolId=USER_POOL_ID, Username=username, GroupName=group)
            changed = True
        elif role not in roles and role in current:
            cognito.admin_remove_user_from_group(UserPoolId=USER_POOL_ID, Username=username, GroupName=group)
            changed = True
    return changed


def sign_out(username: str) -> None:
    """Ends every session of the user, so their next sign-in brings the new roles."""
    try:
        cognito.admin_user_global_sign_out(UserPoolId=USER_POOL_ID, Username=username)
    except Exception:  # noqa: BLE001 - the roles already changed; the token expires within the hour anyway
        logger.warning(f"could not sign out {username}: {format_exc()}")


def audit(event: dict, action: str, target: str, **details) -> None:
    """One JSON line per successful change, for CloudWatch Logs Insights. Never
    pass a password here: the temporary one only travels in the response."""
    entry = {"audit": "admin-users", "action": action, "actor": caller(event)["username"], "target": target}
    entry.update({key: value for key, value in details.items() if value is not None})
    logger.info(json.dumps(entry, sort_keys=True))


def not_self(event: dict, username: str, action: str) -> None:
    if username == caller(event)["username"]:
        raise ApiError(409, "SELF_CHANGE", f"You cannot {action} your own account")


def temporary_password() -> str:
    # Meets the pool policy: 8+ chars with upper, lower and digits.
    alphabet = string.ascii_letters + string.digits
    while True:
        password = "".join(secrets.choice(alphabet) for _ in range(14))
        if any(c.islower() for c in password) and any(c.isupper() for c in password) and any(c.isdigit() for c in password):
            return password


def list_users(event: dict) -> list[dict]:
    users, token = [], None
    while True:
        kwargs = {"UserPoolId": USER_POOL_ID, "Limit": 60}
        if token:
            kwargs["PaginationToken"] = token
        page = cognito.list_users(**kwargs)
        users.extend(to_user(user) for user in page.get("Users", []))
        token = page.get("PaginationToken")
        if not token:
            break
    if access_enabled() and not caller_is_developer(event):
        users = [user for user in users if "developer" not in user["roles"]]
    return sorted(users, key=lambda user: str(user["createdAt"] or ""), reverse=True)


def create_user(event: dict, body: dict) -> dict:
    email = str(body.get("email") or "").strip().lower()
    if "@" not in email:
        raise ApiError(422, "VALIDATION_ERROR", "email is required")
    attrs = [{"Name": "email", "Value": email}, {"Name": "email_verified", "Value": "true"}]
    name = str(body.get("name") or "").strip()
    if name:
        attrs.append({"Name": "name", "Value": name})
    try:
        # Cognito emails the temporary password; the user sets their own at first sign-in.
        created = cognito.admin_create_user(
            UserPoolId=USER_POOL_ID,
            Username=email,
            UserAttributes=attrs,
            DesiredDeliveryMediums=["EMAIL"],
        )["User"]
    except cognito.exceptions.UsernameExistsException as error:
        raise ApiError(409, "USER_EXISTS", "A user with that email already exists") from error
    roles = roles_of(event, body) or ["member"]
    set_roles(created["Username"], roles, assignable(event) or ["member"])
    return to_user(created)


def update_user(event: dict, username: str, body: dict) -> dict:
    attrs = []
    if "name" in body:
        attrs.append({"Name": "name", "Value": str(body.get("name") or "").strip()})
    if "email" in body:
        email = str(body.get("email") or "").strip().lower()
        if "@" not in email:
            raise ApiError(422, "VALIDATION_ERROR", "email must be an email address")
        attrs += [{"Name": "email", "Value": email}, {"Name": "email_verified", "Value": "true"}]
    if attrs:
        cognito.admin_update_user_attributes(UserPoolId=USER_POOL_ID, Username=username, UserAttributes=attrs)
    roles = roles_of(event, body)
    if roles is not None:
        not_self(event, username, "change the roles of")
        if set_roles(username, roles, assignable(event)) and access_enabled():
            sign_out(username)
    return {"fields": sorted(key for key in ("name", "email") if key in body), "roles": roles}


def route(event: dict):
    method = str(event.get("httpMethod") or "").upper()
    resource = str(event.get("resource") or "")
    username = str((event.get("pathParameters") or {}).get("username") or "")

    if resource == "/admin/roles" and method == "GET":
        return create_success_response(data=[
            {"id": role, "name": access.ROLE_LABELS[role][0], "description": access.ROLE_LABELS[role][1]}
            for role in assignable(event)
        ])
    if resource == "/admin/users" and method == "GET":
        return create_success_response(data=list_users(event))
    if resource == "/admin/users" and method == "POST":
        created = create_user(event, body_of(event))
        audit(event, "create", created["username"], roles=created["roles"])
        return create_success_response(data=created, status_code=201)
    if not username:
        raise ApiError(404, "NOT_FOUND", "Unknown route")
    protect(event, username)

    if resource == "/admin/users/{username}" and method == "PATCH":
        changes = update_user(event, username, body_of(event))
        audit(event, "update", username, **changes)
        return create_no_content_response()
    if resource == "/admin/users/{username}" and method == "DELETE":
        not_self(event, username, "delete")
        cognito.admin_delete_user(UserPoolId=USER_POOL_ID, Username=username)
        audit(event, "delete", username)
        return create_no_content_response()
    if resource == "/admin/users/{username}/status" and method == "PATCH":
        enabled = body_of(event).get("enabled")
        if not isinstance(enabled, bool):
            raise ApiError(422, "VALIDATION_ERROR", "enabled must be true or false")
        not_self(event, username, "disable")
        action = cognito.admin_enable_user if enabled else cognito.admin_disable_user
        action(UserPoolId=USER_POOL_ID, Username=username)
        audit(event, "enable" if enabled else "disable", username)
        return create_no_content_response()
    if resource == "/admin/users/{username}/password" and method == "POST":
        password = temporary_password()
        cognito.admin_set_user_password(
            UserPoolId=USER_POOL_ID, Username=username, Password=password, Permanent=False
        )
        audit(event, "reset_password", username)
        return create_success_response(data={"username": username, "temporaryPassword": password})
    raise ApiError(404, "NOT_FOUND", "Unknown route")


@with_cors()
def handler(event, context):
    if access_enabled():
        needed = "users.assign_roles" if event.get("resource") == "/admin/roles" else "users.manage"
        if not access.has(caller(event)["groups"], needed):
            return create_error_response("Only administrators can manage users", 403, "FORBIDDEN")
    elif ADMIN_GROUP and ADMIN_GROUP not in caller(event)["groups"]:
        return create_error_response("Only administrators can manage users", 403, "FORBIDDEN")
    try:
        return route(event)
    except ApiError as error:
        return create_error_response(str(error), error.status, error.code)
    except cognito.exceptions.UserNotFoundException:
        return create_error_response("User not found", 404, "NOT_FOUND")
    except ClientError as error:
        logger.error(format_exc())
        return create_error_response(error.response["Error"].get("Message", "Cognito error"), 400, "COGNITO_ERROR")
    except Exception:  # noqa: BLE001
        logger.error(format_exc())
        return create_error_response("Failed to manage users", 500, "INTERNAL_ERROR")
