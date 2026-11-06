"""pre-token: Cognito Pre Token Generation trigger.

A user with no role group (a first sign-in with Microsoft or Google) is put
in `member`, and `member` goes into this very token's `cognito:groups`, so
the first session already has its role. Users with a role pass unchanged.

Self-contained (no layer): it runs on every sign-in and token refresh.
"""
import logging
import os

import boto3

logger = logging.getLogger()
logger.setLevel(logging.INFO)

DEFAULT_ROLE = os.environ.get("DEFAULT_ROLE", "member")

cognito = boto3.client("cognito-idp")


def handler(event, context):
    request = event.get("request") or {}
    groups = list(((request.get("groupConfiguration") or {}).get("groupsToOverride")) or [])
    # `<pool-id>_<Provider>` groups are added by Cognito to federated users: not roles.
    if any("_" not in group for group in groups):
        return event
    try:
        cognito.admin_add_user_to_group(
            UserPoolId=event["userPoolId"], Username=event["userName"], GroupName=DEFAULT_ROLE
        )
        logger.info(f"pre-token: {event['userName']} had no role, added to {DEFAULT_ROLE}")
    except Exception as error:  # noqa: BLE001 - never block a sign-in; the API treats no role as member
        logger.warning(f"pre-token: could not add {event.get('userName')} to {DEFAULT_ROLE}: {error}")
    response = event.setdefault("response", {})
    response["claimsOverrideDetails"] = {
        "groupOverrideDetails": {"groupsToOverride": groups + [DEFAULT_ROLE]},
    }
    return event
