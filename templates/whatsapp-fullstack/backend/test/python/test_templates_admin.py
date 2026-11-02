"""Unit tests of creating, editing and deleting templates, with AWS stubbed out.

Run from the backend root: python -m unittest discover -s test/python -v
"""
import importlib.util
import json
import unittest
from unittest import mock

import test_ws_handler as support
from common.whatsapp import templates

config = support.config
http = support.http
media = support.media
messaging = support.messaging

spec = importlib.util.spec_from_file_location(
    "templates_admin", support.ROOT / "src" / "lambda" / "whatsapp" / "templates-admin" / "index.py"
)
templates_admin = importlib.util.module_from_spec(spec)
spec.loader.exec_module(templates_admin)


def var(name: str) -> str:
    """A WhatsApp variable, built at runtime so the template engine leaves this file alone."""
    return "{" * 2 + name + "}" * 2


def client_error(code: str, message: str = "reason") -> Exception:
    error = messaging.ClientError(code)
    error.response = {"Error": {"Code": code, "Message": message}}
    return error


def request(**overrides) -> dict:
    base = {
        "name": "confirmacion_pedido",
        "language": "es",
        "category": "UTILITY",
        "parameterFormat": "POSITIONAL",
        "header": {"format": "TEXT", "text": f"Pedido {var('1')}"},
        "body": f"Hola {var('1')}, tu pedido llega el {var('2')}. Gracias por comprar.",
        "footer": "Responde STOP para salir",
        "buttons": [
            {"type": "QUICK_REPLY", "text": "Ok"},
            {"type": "URL", "text": "Seguir", "url": f"https://example.com/p/{var('1')}"},
            {"type": "PHONE_NUMBER", "text": "Llamar", "phone": "+56911111111"},
        ],
        "examples": {"header:1": "A-1", "body:1": "Ana", "body:2": "lunes", "button:1": "A-1"},
    }
    return {**base, **overrides}


class ValidateTest(unittest.TestCase):
    def test_a_complete_request_passes(self):
        self.assertEqual(templates.validate(request()), [])

    def test_reports_the_failing_rule_ids(self):
        failed = templates.validate(
            request(
                name="Mi Plantilla",
                body=f"Hola {var('1')} y {var('3')}",
                footer=f"Pie {var('1')}",
                examples={},
            )
        )
        for rule in ("name-format", "body-positional-sequence", "footer-no-variables", "examples-complete"):
            self.assertIn(rule, failed)

    def test_limits_mirror_the_web(self):
        failed = templates.validate(
            request(
                header={"format": "TEXT", "text": "x" * 61},
                body="x" * 1025,
                buttons=[{"type": "URL", "text": "x" * 26, "url": "ftp://example.com"}] * 3,
            )
        )
        for rule in ("header-text-length", "body-length", "buttons-text", "buttons-url", "buttons-type-limits"):
            self.assertIn(rule, failed)

    def test_named_variables(self):
        body = f"Hola {var('nombre')}, tu pedido {var('pedido')} va en camino."
        ok = request(
            parameterFormat="NAMED",
            header=None,
            body=body,
            buttons=[],
            examples={"body:nombre": "Ana", "body:pedido": "A-1"},
        )
        self.assertEqual(templates.validate(ok), [])
        repeated = {**ok, "body": f"{body} {var('nombre')}"}
        self.assertIn("body-named-unique", templates.validate(repeated))

    def test_a_media_header_needs_its_handle(self):
        self.assertIn("header-media-handle", templates.validate(request(header={"format": "IMAGE"})))

    def test_quick_replies_go_together(self):
        buttons = [
            {"type": "QUICK_REPLY", "text": "a"},
            {"type": "PHONE_NUMBER", "text": "b", "phone": "+56911111111"},
            {"type": "QUICK_REPLY", "text": "c"},
        ]
        self.assertIn("buttons-grouping", templates.validate(request(buttons=buttons, examples={"header:1": "x", "body:1": "a", "body:2": "b"})))

    def test_an_edit_does_not_need_name_or_language(self):
        edit = request()
        del edit["name"], edit["language"], edit["category"]
        self.assertEqual(templates.validate(edit, require_identity=False), [])


class BuildTest(unittest.TestCase):
    def test_builds_the_meta_definition(self):
        definition = templates.build_definition(request())
        self.assertEqual(definition["name"], "confirmacion_pedido")
        self.assertEqual(definition["parameter_format"], "POSITIONAL")
        header, body, footer, buttons = definition["components"]
        self.assertEqual(header["example"], {"header_text": ["A-1"]})
        self.assertEqual(body["example"], {"body_text": [["Ana", "lunes"]]})
        self.assertEqual(footer, {"type": "FOOTER", "text": "Responde STOP para salir"})
        self.assertEqual(
            buttons["buttons"],
            [
                {"type": "QUICK_REPLY", "text": "Ok"},
                {"type": "URL", "text": "Seguir", "url": f"https://example.com/p/{var('1')}", "example": ["A-1"]},
                {"type": "PHONE_NUMBER", "text": "Llamar", "phone_number": "+56911111111"},
            ],
        )

    def test_named_examples_and_media_headers(self):
        components = templates.build_components(
            request(
                parameterFormat="NAMED",
                header={"format": "VIDEO", "handle": "4::dmlk"},
                body=f"Hola {var('nombre')}, gracias por tu compra de hoy.",
                buttons=[{"type": "COPY_CODE", "text": "Copiar", "code": "DESC10"}],
                examples={"body:nombre": "Ana"},
            )
        )
        self.assertEqual(components[0], {"type": "HEADER", "format": "VIDEO", "example": {"header_handle": ["4::dmlk"]}})
        self.assertEqual(components[1]["example"], {"body_text_named_params": [{"param_name": "nombre", "example": "Ana"}]})
        self.assertEqual(components[-1]["buttons"], [{"type": "COPY_CODE", "example": "DESC10"}])


class AdminTestCase(unittest.TestCase):
    def setUp(self):
        self.social = mock.MagicMock()
        self.social.create_whatsapp_message_template.return_value = {
            "metaTemplateId": "123",
            "templateStatus": "PENDING",
            "category": "UTILITY",
        }
        patches = [
            mock.patch.object(messaging, "social_messaging", self.social),
            mock.patch.object(media, "social_messaging", self.social),
            mock.patch.object(config, "waba_id", return_value="waba-1"),
        ]
        for patch in patches:
            patch.start()
        self.addCleanup(mock.patch.stopall)

    def call(self, method: str, resource: str, body: dict | None = None, query: dict | None = None, path: dict | None = None):
        event = {
            "requestContext": {"authorizer": {"username": "ana", "email": "ana@example.com"}},
            "httpMethod": method,
            "resource": resource,
            "body": json.dumps(body) if body is not None else None,
            "queryStringParameters": query,
            "pathParameters": path,
        }
        response = templates_admin.handler(event, None)
        return response["statusCode"], json.loads(response["body"] or "{}")


class CreateTest(AdminTestCase):
    def test_creates_the_template_with_its_meta_definition(self):
        status, body = self.call("POST", "/whatsapp/templates", request())
        self.assertEqual(status, 201, body)
        self.assertEqual(body["data"]["metaTemplateId"], "123")
        self.assertEqual(body["data"]["status"], "PENDING")
        call = self.social.create_whatsapp_message_template.call_args.kwargs
        self.assertEqual(call["id"], "waba-1")
        self.assertEqual(json.loads(call["templateDefinition"].decode("utf-8"))["name"], "confirmacion_pedido")

    def test_an_invalid_template_is_422_with_the_rule_ids(self):
        status, body = self.call("POST", "/whatsapp/templates", request(name="", body=""))
        self.assertEqual(status, 422)
        self.assertEqual(body["error"]["code"], "TEMPLATE_INVALID")
        self.assertIn("name-required", body["error"]["details"]["rules"])
        self.assertIn("body-required", body["error"]["details"]["rules"])
        self.social.create_whatsapp_message_template.assert_not_called()

    def test_maps_meta_errors_to_clear_4xx(self):
        cases = {
            "InvalidParametersException": (422, "META_REJECTED"),
            "AccessDeniedByMetaException": (403, "META_ACCESS_DENIED"),
            "ThrottledRequestException": (429, "THROTTLED"),
            "SomethingElse": (502, "SOCIAL_MESSAGING_ERROR"),
        }
        for code, (status_code, error_code) in cases.items():
            self.social.create_whatsapp_message_template.side_effect = client_error(code, "name already in use")
            status, body = self.call("POST", "/whatsapp/templates", request())
            self.assertEqual((status, body["error"]["code"]), (status_code, error_code), code)
        self.assertIn("name already in use", body["error"]["message"])

    def test_requires_the_admin_group(self):
        with mock.patch.object(http, "ADMIN_GROUP", "admin"):
            status, _ = self.call("POST", "/whatsapp/templates", request())
        self.assertEqual(status, 403)


class UpdateTest(AdminTestCase):
    def test_replaces_the_components(self):
        edit = request(category=None)
        status, body = self.call("PUT", "/whatsapp/templates/{metaTemplateId}", edit, path={"metaTemplateId": "123"})
        self.assertEqual(status, 200, body)
        call = self.social.update_whatsapp_message_template.call_args.kwargs
        self.assertEqual(call["metaTemplateId"], "123")
        self.assertEqual(call["parameterFormat"], "positional")
        self.assertNotIn("templateCategory", call)
        self.assertEqual(json.loads(call["templateComponents"].decode("utf-8"))[1]["type"], "BODY")

    def test_rejects_components_over_the_update_limit(self):
        self.assertEqual(templates.UPDATE_COMPONENTS_MAX_CHARS, 3000)
        with mock.patch.object(templates, "UPDATE_COMPONENTS_MAX_CHARS", 100):
            status, response = self.call(
                "PUT", "/whatsapp/templates/{metaTemplateId}", request(), path={"metaTemplateId": "123"}
            )
        self.assertEqual(status, 422)
        self.assertEqual(response["error"]["details"]["rules"], ["components-size"])
        self.social.update_whatsapp_message_template.assert_not_called()

    def test_rejects_an_id_that_is_not_meta_numeric(self):
        status, _ = self.call("PUT", "/whatsapp/templates/{metaTemplateId}", request(), path={"metaTemplateId": "abc"})
        self.assertEqual(status, 422)


class DeleteTest(AdminTestCase):
    def test_deletes_one_language_version_by_id(self):
        status, _ = self.call("DELETE", "/whatsapp/templates", query={"name": "promo", "metaTemplateId": "123"})
        self.assertEqual(status, 200)
        self.social.delete_whatsapp_message_template.assert_called_once_with(
            id="waba-1", templateName="promo", metaTemplateId="123"
        )

    def test_without_id_deletes_every_language(self):
        self.call("DELETE", "/whatsapp/templates", query={"name": "promo"})
        self.social.delete_whatsapp_message_template.assert_called_once_with(id="waba-1", templateName="promo")

    def test_requires_a_valid_name(self):
        status, _ = self.call("DELETE", "/whatsapp/templates", query={"name": "Promo!"})
        self.assertEqual(status, 422)
        self.social.delete_whatsapp_message_template.assert_not_called()

    def test_an_unknown_template_is_404(self):
        self.social.delete_whatsapp_message_template.side_effect = client_error("ResourceNotFoundException")
        status, _ = self.call("DELETE", "/whatsapp/templates", query={"name": "promo", "metaTemplateId": "1"})
        self.assertEqual(status, 404)


class HeaderMediaTest(AdminTestCase):
    key = "outbound/0123456789abcdef0123456789abcdef0123.png"

    def test_returns_the_meta_handle_of_an_uploaded_sample(self):
        self.social.create_whatsapp_message_template_media.return_value = {"metaHeaderHandle": "4::aW1n"}
        with mock.patch.object(media, "MEDIA_BUCKET_NAME", "bucket"), mock.patch.object(
            media, "uploaded_object", return_value={"mimeType": "image/png", "size": 1024}
        ):
            status, body = self.call("POST", "/whatsapp/templates/media", {"key": self.key, "mimeType": "image/png"})
        self.assertEqual(status, 200, body)
        self.assertEqual(body["data"], {"handle": "4::aW1n", "format": "IMAGE"})
        self.social.create_whatsapp_message_template_media.assert_called_once_with(
            id="waba-1", sourceS3File={"bucketName": "bucket", "key": self.key}
        )

    def test_rejects_a_type_meta_does_not_take_as_a_header(self):
        with mock.patch.object(media, "uploaded_object", return_value={"mimeType": "audio/mpeg", "size": 1024}):
            status, body = self.call("POST", "/whatsapp/templates/media", {"key": self.key, "mimeType": "audio/mpeg"})
        self.assertEqual(status, 422)
        self.assertEqual(body["error"]["code"], "MEDIA_REJECTED")

    def test_unknown_routes_are_404(self):
        status, _ = self.call("PATCH", "/whatsapp/templates")
        self.assertEqual(status, 404)


if __name__ == "__main__":
    unittest.main()
