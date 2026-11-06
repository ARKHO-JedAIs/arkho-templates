"""GET /me/permissions: what the signed-in user may see and do.

    {"roles": [...], "menu": [...], "actions": [...]}

The frontend builds its sidebar and its buttons from it; every API checks
the same permissions again on its own (common.access).
"""
from traceback import format_exc

from common import access, create_error_response, create_success_response, get_logger, with_cors

logger = get_logger(__name__)


@with_cors()
def handler(event, context):
    try:
        return create_success_response(data=access.permissions_for(access.caller_groups(event)))
    except Exception:  # noqa: BLE001
        logger.error(format_exc())
        return create_error_response("Failed to read the permissions", 500, "INTERNAL_ERROR")
