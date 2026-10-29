from traceback import format_exc

from common import create_error_response, create_success_response, get_logger, with_cors
from common.whatsapp import config, http, media, messaging

logger = get_logger(__name__)

MAX_FILENAME_LENGTH = 240


@with_cors()
def handler(event, context):
    """POST /whatsapp/media/upload-url {phone?, filename, mimeType, size}

    A presigned PUT for one file to send: the browser uploads it straight to
    the media bucket (``outbound/<uuid>.<ext>``, with exactly that
    Content-Type) and then sends ``{phone, media: {key, mimeType, ...}}`` to
    POST /whatsapp/messages, the key as a template header to POST
    /whatsapp/templates/send, or a template header sample to POST
    /whatsapp/templates/media (no ``phone`` then). Type and size follow
    WhatsApp's limits (422 MEDIA_REJECTED otherwise); whoever uses the key
    checks the uploaded object again.
    """
    if not http.is_allowed(event):
        return create_error_response("Your profile cannot use WhatsApp", 403, "FORBIDDEN")
    try:
        body = http.get_body(event)
        if body.get("phone") not in (None, ""):
            messaging.normalize_phone(http.require_text(body, "phone", 32))
        http.require_text(body, "filename", MAX_FILENAME_LENGTH)
        mime_type = media.base_mime(http.require_text(body, "mimeType", 255))
        size = body.get("size")
        if not isinstance(size, int) or isinstance(size, bool):
            raise http.BadRequest("size must be the file size in bytes")
    except (http.BadRequest, ValueError) as error:
        return create_error_response(str(error), 422, "VALIDATION_ERROR")
    try:
        message_type = media.validate_outbound(mime_type, size)
    except media.MediaRejected as error:
        return create_error_response(str(error), 422, "MEDIA_REJECTED")

    key = media.new_outbound_key(mime_type)
    try:
        url = media.presign_upload(key, mime_type)
    except config.ConfigurationError as error:
        return create_error_response(str(error), 409, "NOT_CONFIGURED")
    except Exception:  # noqa: BLE001
        logger.error(format_exc())
        return create_error_response("Could not prepare the upload", 500, "INTERNAL_ERROR")
    return create_success_response(
        data={
            "upload_url": url,
            "key": key,
            "type": message_type,
            "headers": {"Content-Type": mime_type},
            "expires_in": media.UPLOAD_URL_TTL_SECONDS,
        }
    )
