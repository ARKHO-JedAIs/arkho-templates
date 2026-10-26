from traceback import format_exc

from botocore.exceptions import ClientError

from common import create_error_response, create_success_response, get_logger, with_cors
from common.whatsapp import config, messaging

logger = get_logger(__name__)


@with_cors()
def handler(event, context):
    """GET /whatsapp/templates: the approved templates, with their body text."""
    try:
        templates = messaging.list_templates()
    except config.ConfigurationError as error:
        return create_error_response(str(error), 409, "NOT_CONFIGURED")
    except ClientError:
        logger.error(format_exc())
        return create_error_response("Failed to list the WhatsApp templates", 502, "SOCIAL_MESSAGING_ERROR")
    return create_success_response(data=templates, metadata={"count": len(templates)})
