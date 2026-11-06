from traceback import format_exc

from botocore.exceptions import ClientError

from common import create_error_response, create_success_response, get_logger, with_cors
from common.whatsapp import config, http, messaging

logger = get_logger(__name__)


@with_cors()
def handler(event, context):
    """GET /whatsapp/templates: every template of the WABA, with its status and components."""
    if not http.is_allowed(event, "templates.send"):
        return create_error_response("Your profile cannot use WhatsApp", 403, "FORBIDDEN")
    try:
        templates = messaging.list_templates()
    except config.ConfigurationError as error:
        return create_error_response(str(error), 409, "NOT_CONFIGURED")
    except ClientError:
        logger.error(format_exc())
        return create_error_response("Failed to list the WhatsApp templates", 502, "SOCIAL_MESSAGING_ERROR")
    return create_success_response(data=templates, metadata={"count": len(templates)})
