"""templates-admin: creating, editing and deleting WhatsApp message templates.

One function behind four routes, so the template-writing permissions live on
one role:

* ``POST   /whatsapp/templates`` - a new template (TemplateRequest of
  ``common.whatsapp.templates``) -> ``{metaTemplateId, status, category}``
* ``PUT    /whatsapp/templates/{metaTemplateId}`` - replaces its components
  (and the category, when sent); Meta reviews it again
* ``DELETE /whatsapp/templates?name=<name>[&metaTemplateId=<id>]`` - one
  language version with the id, every language of the name without it
* ``POST   /whatsapp/templates/media`` ``{key, mimeType}`` - hands a sample
  file uploaded through POST /whatsapp/media/upload-url to Meta and returns
  the ``handle`` a media header's example uses

A template that breaks Meta's rules is refused with 422 TEMPLATE_INVALID and
the failing rule ids in ``error.details.rules`` (the same ids the web's
creator shows). AWS / Meta errors map to 4xx through ``messaging.client_error``.
"""
import json
import re
from traceback import format_exc

from botocore.exceptions import ClientError

from common import create_error_response, create_success_response, get_logger, with_cors
from common.whatsapp import config, http, media, messaging, templates

logger = get_logger(__name__)

META_TEMPLATE_ID = re.compile(r"^\d{1,100}$")


class ApiError(Exception):
    def __init__(self, status: int, code: str, message: str, details: dict | None = None):
        super().__init__(message)
        self.status = status
        self.code = code
        self.details = details


def check(request: dict, require_identity: bool) -> None:
    failed = templates.validate(request, require_identity=require_identity)
    if failed:
        raise ApiError(422, "TEMPLATE_INVALID", str(templates.TemplateInvalid(failed)), {"rules": failed})


def audit(event: dict, action: str, **fields) -> None:
    caller = http.get_caller(event)
    logger.info(
        json.dumps({"audit": "whatsapp-templates", "by": caller["email"] or caller["username"], "action": action, **fields})
    )


def create(event: dict) -> dict:
    request = http.get_body(event)
    check(request, require_identity=True)
    definition = templates.build_definition(request)
    if len(templates.encoded(definition)) > templates.CREATE_DEFINITION_MAX_BYTES:
        raise ApiError(
            422,
            "TEMPLATE_INVALID",
            f"The template definition exceeds {templates.CREATE_DEFINITION_MAX_BYTES} bytes",
            {"rules": ["definition-size"]},
        )
    created = messaging.create_template(definition)
    audit(event, "create", name=definition["name"], language=definition["language"], **created)
    return create_success_response(data={**created, "name": definition["name"], "language": definition["language"]}, status_code=201)


def update(event: dict, meta_template_id: str) -> dict:
    request = http.get_body(event)
    check(request, require_identity=False)
    components = templates.build_components(request)
    if len(json.dumps(components, ensure_ascii=False)) > templates.UPDATE_COMPONENTS_MAX_CHARS:
        raise ApiError(
            422,
            "TEMPLATE_INVALID",
            f"The edited components exceed {templates.UPDATE_COMPONENTS_MAX_CHARS} characters",
            {"rules": ["components-size"]},
        )
    messaging.update_template(
        meta_template_id,
        components,
        parameter_format=request.get("parameterFormat"),
        category=request.get("category"),
    )
    audit(event, "update", metaTemplateId=meta_template_id)
    return create_success_response(data={"metaTemplateId": meta_template_id, "status": "PENDING"})


def delete(event: dict) -> dict:
    name = http.get_query(event, "name")
    meta_template_id = http.get_query(event, "metaTemplateId")
    if not templates.TEMPLATE_NAME.match(name) or len(name) > templates.LIMITS["name_max"]:
        raise ApiError(422, "VALIDATION_ERROR", "name must be the template name")
    if meta_template_id and not META_TEMPLATE_ID.match(meta_template_id):
        raise ApiError(422, "VALIDATION_ERROR", "metaTemplateId must be Meta's numeric id")
    messaging.delete_template(name, meta_template_id or None)
    audit(event, "delete", name=name, metaTemplateId=meta_template_id or "*")
    return create_success_response(data={"name": name, "metaTemplateId": meta_template_id or None})


def header_media(event: dict) -> dict:
    body = http.get_body(event)
    key = http.require_text(body, "key", 255)
    declared = media.base_mime(http.require_text(body, "mimeType", 255))
    uploaded = media.uploaded_object(key)
    if uploaded["mimeType"] != declared:
        raise media.MediaRejected("The uploaded file does not have the declared mimeType")
    header_format = media.template_header_format(declared)
    media.validate_outbound(declared, uploaded["size"])
    handle = media.template_header_handle(key)
    return create_success_response(data={"handle": handle, "format": header_format})


def route(event: dict) -> dict:
    resource = event.get("resource") or ""
    method = str(event.get("httpMethod") or "").upper()
    meta_template_id = str((event.get("pathParameters") or {}).get("metaTemplateId") or "")
    if resource == "/whatsapp/templates" and method == "POST":
        return create(event)
    if resource == "/whatsapp/templates" and method == "DELETE":
        return delete(event)
    if resource == "/whatsapp/templates/media" and method == "POST":
        return header_media(event)
    if resource == "/whatsapp/templates/{metaTemplateId}" and method == "PUT":
        if not META_TEMPLATE_ID.match(meta_template_id):
            raise ApiError(422, "VALIDATION_ERROR", "metaTemplateId must be Meta's numeric id")
        return update(event, meta_template_id)
    raise ApiError(404, "NOT_FOUND", "Unknown route")


@with_cors()
def handler(event, context):
    if not http.is_allowed(event, "templates.manage"):
        return create_error_response("Your profile cannot use WhatsApp", 403, "FORBIDDEN")
    try:
        return route(event)
    except ApiError as error:
        return create_error_response(str(error), error.status, error.code, error.details)
    except media.MediaRejected as error:
        return create_error_response(str(error), 422, "MEDIA_REJECTED")
    except http.BadRequest as error:
        return create_error_response(str(error), 422, "VALIDATION_ERROR")
    except config.ConfigurationError as error:
        return create_error_response(str(error), 409, "NOT_CONFIGURED")
    except ClientError as error:
        logger.error(format_exc())
        status, code, message = messaging.client_error(error)
        return create_error_response(message, status, code)
    except Exception:  # noqa: BLE001
        logger.error(format_exc())
        return create_error_response("Failed to manage the template", 500, "INTERNAL_ERROR")
