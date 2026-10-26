from typing import Any, Dict

from common import get_logger, log_error, log_request_metadata

logger = get_logger(__name__)


def handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    log_request_metadata(logger, context)

    try:
        user_id = event.get("userName")

        if user_id:
            logger.info(f"Confirmed Cognito user: {user_id}")
        else:
            logger.warning("Cognito post-confirmation event did not include userName")

        return event
    except Exception as e:
        log_error(logger, e, "Post-confirmation signup processing")
        return event
