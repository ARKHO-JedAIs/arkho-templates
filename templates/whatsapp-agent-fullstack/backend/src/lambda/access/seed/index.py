"""seed-access: run on every deploy (CDK Trigger).

1. Writes the default roles and their permissions to the access-control
   table where they are missing, and refreshes permissions the seed itself
   wrote when the defaults change: what was edited from the web stays.
2. Puts the users listed in DEVELOPER_EMAILS in the developer group.
3. Gives `member` to every user that has no role group yet (for example a
   Microsoft sign-in from before the pre-token trigger existed).

Idempotent; a failed step is logged and the rest still runs.
"""
import os
from datetime import datetime, timezone
from traceback import format_exc

import boto3
from botocore.exceptions import ClientError

from common import get_logger
from common import access

logger = get_logger(__name__)

TABLE_NAME = os.environ.get("ACCESS_TABLE_NAME", "")
USER_POOL_ID = os.environ.get("USER_POOL_ID", "")
DEVELOPER_EMAILS = [e.strip().lower() for e in os.environ.get("DEVELOPER_EMAILS", "").split(",") if e.strip()]

cognito = boto3.client("cognito-idp")
dynamodb = boto3.resource("dynamodb")


def put_missing(table, item: dict) -> bool:
    try:
        table.put_item(Item=item, ConditionExpression="attribute_not_exists(PK)")
        return True
    except ClientError as error:
        if error.response.get("Error", {}).get("Code") == "ConditionalCheckFailedException":
            return False
        raise


def seed_roles() -> list[str]:
    table = dynamodb.Table(TABLE_NAME)
    now = datetime.now(timezone.utc).isoformat()
    written = []
    for role in access.SYSTEM_ROLES:
        name, description = access.ROLE_LABELS[role]
        meta = {
            "PK": f"ROLE#{role}",
            "SK": "META",
            "name": name,
            "description": description,
            "system": True,
            "hidden": role in access.HIDDEN_ROLES,
            "updatedAt": now,
            "updatedBy": "seed",
        }
        if put_missing(table, meta):
            written.append(f"{role}/META")
        if role == access.DEVELOPER:
            continue  # every permission, in code
        perms = {"PK": f"ROLE#{role}", "SK": "PERMS", **access.DEFAULT_PERMISSIONS[role], "updatedAt": now, "updatedBy": "seed"}
        if put_missing(table, perms):
            written.append(f"{role}/PERMS")
            continue
        stored = table.get_item(Key={"PK": f"ROLE#{role}", "SK": "PERMS"}).get("Item") or {}
        default = access.DEFAULT_PERMISSIONS[role]
        same = list(stored.get("menu") or []) == default["menu"] and list(stored.get("actions") or []) == default["actions"]
        if stored.get("updatedBy") == "seed" and not same:
            table.put_item(Item=perms)
            written.append(f"{role}/PERMS (new defaults)")
    return written


def all_users():
    token = None
    while True:
        kwargs = {"UserPoolId": USER_POOL_ID, "Limit": 60}
        if token:
            kwargs["PaginationToken"] = token
        page = cognito.list_users(**kwargs)
        yield from page.get("Users", [])
        token = page.get("PaginationToken")
        if not token:
            return


def email_of(user: dict) -> str:
    for attribute in user.get("Attributes") or []:
        if attribute["Name"] == "email":
            return attribute["Value"].lower()
    return ""


def groups_of(username: str) -> list[str]:
    groups = cognito.admin_list_groups_for_user(UserPoolId=USER_POOL_ID, Username=username)
    return [group["GroupName"] for group in groups.get("Groups", [])]


def assign_roles() -> dict:
    developers, members = [], []
    for user in all_users():
        username = user["Username"]
        groups = groups_of(username)
        roles = [group for group in groups if "_" not in group]
        if email_of(user) in DEVELOPER_EMAILS and access.DEVELOPER not in roles:
            cognito.admin_add_user_to_group(UserPoolId=USER_POOL_ID, Username=username, GroupName=access.DEVELOPER)
            developers.append(username)
        elif not roles and email_of(user) not in DEVELOPER_EMAILS:
            cognito.admin_add_user_to_group(UserPoolId=USER_POOL_ID, Username=username, GroupName=access.MEMBER)
            members.append(username)
    return {"developers": developers, "members": members}


def handler(event, context):
    result = {}
    for step, run in (("roles", seed_roles), ("users", assign_roles)):
        try:
            result[step] = run()
        except Exception:  # noqa: BLE001 - one failed step must not block the deploy
            logger.error(f"seed step {step} failed: {format_exc()}")
            result[step] = "failed"
    logger.info(f"seed-access: {result}")
    return result
