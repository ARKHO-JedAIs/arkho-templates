"""AppSync Lambda authorizer of the realtime channel (the WhatsApp inbox).

The browser subscribes with its Cognito ID token. This function checks the
token (signature, expiry, issuer, audience) and that one of the user's roles
has the `whatsapp` page in the access-control table, so any role given the
inbox from the web gets live updates, with no group hard-coded in the schema.

AppSync caches the answer per token for TTL_SECONDS.
"""
import os

import jwt
from jwt import PyJWKClient

from common import access, get_logger

logger = get_logger(__name__)

USER_POOL_ID = os.environ.get("USER_POOL_ID", "")
APP_CLIENT_ID = os.environ.get("APP_CLIENT_ID", "")
REQUIRED_PERMISSION = os.environ.get("REQUIRED_PERMISSION", "whatsapp")
TTL_SECONDS = int(os.environ.get("TTL_SECONDS", "300"))
ISSUER = f"https://cognito-idp.{os.environ.get('AWS_REGION', 'us-east-1')}.amazonaws.com/{USER_POOL_ID}"

_jwks = None


def verify(token: str) -> dict:
    global _jwks
    if _jwks is None:
        _jwks = PyJWKClient(f"{ISSUER}/.well-known/jwks.json")
    key = _jwks.get_signing_key_from_jwt(token).key
    claims = jwt.decode(token, key, algorithms=["RS256"], issuer=ISSUER, options={"verify_aud": False})
    if claims.get("token_use") == "id":
        if claims.get("aud") != APP_CLIENT_ID:
            raise ValueError("wrong audience")
    elif claims.get("token_use") == "access":
        if claims.get("client_id") != APP_CLIENT_ID:
            raise ValueError("wrong client")
    else:
        raise ValueError("not a Cognito token")
    return claims


def denied() -> dict:
    return {"isAuthorized": False, "ttlOverride": 0}


def handler(event, context):
    token = str(event.get("authorizationToken") or "")
    if token.lower().startswith("bearer "):
        token = token[7:]
    if not token:
        return denied()
    try:
        claims = verify(token)
    except Exception as error:  # noqa: BLE001
        logger.info(f"realtime: invalid token ({type(error).__name__})")
        return denied()
    groups = claims.get("cognito:groups") or []
    if not access.has(groups, REQUIRED_PERMISSION):
        logger.info(f"realtime: {claims.get('sub')} lacks {REQUIRED_PERMISSION}")
        return denied()
    return {
        "isAuthorized": True,
        "resolverContext": {"sub": str(claims.get("sub", "")), "groups": ",".join(groups)},
        "ttlOverride": TTL_SECONDS,
    }
