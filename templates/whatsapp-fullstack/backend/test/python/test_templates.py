"""Unit tests of the template listing and sending, with AWS stubbed out.

Run from the backend root: python -m unittest discover -s test/python -v
"""
import importlib.util
import json
import unittest
from unittest import mock

import test_ws_handler as support

config = support.config
messaging = support.messaging
realtime = support.realtime
store = support.store


def load(folder: str):
    spec = importlib.util.spec_from_file_location(
        folder.replace("-", "_"), support.ROOT / "src" / "lambda" / "whatsapp" / folder / "index.py"
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


get_templates = load("get-templates")
send_template = load("send-template")


def var(name: str) -> str:
    """A WhatsApp variable, built at runtime so the template engine leaves this file alone."""
    return "{" * 2 + name + "}" * 2


def summary(name: str, status: str = "APPROVED", language: str = "es_PE", meta_id: str | None = None) -> dict:
    return {
        "templateName": name,
        "templateLanguage": language,
        "templateCategory": "UTILITY",
        "templateStatus": status,
        "templateQualityScore": "UNKNOWN",
        "metaTemplateId": meta_id or f"meta-{name}-{language}",
    }


class FakeSocialMessaging:
    """list/get of End User Messaging Social over an in-memory set of templates."""

    def __init__(self, summaries: list[dict], definitions: dict[str, dict], page_size: int = 100):
        self.summaries = summaries
        self.definitions = definitions
        self.page_size = page_size
        self.send_whatsapp_message = mock.MagicMock(return_value={"messageId": "wamid.out"})

    def list_whatsapp_message_templates(self, id, maxResults, nextToken=None):
        start = int(nextToken or 0)
        page = self.summaries[start : start + self.page_size]
        response = {"templates": page}
        if start + self.page_size < len(self.summaries):
            response["nextToken"] = str(start + self.page_size)
        return response

    def get_whatsapp_message_template(self, id, metaTemplateId):
        definition = self.definitions.get(metaTemplateId)
        if definition is None:
            raise messaging.ClientError("not found")
        return {"template": json.dumps(definition)}

    def sent_payload(self) -> dict:
        return json.loads(self.send_whatsapp_message.call_args.kwargs["message"].decode("utf-8"))


def body_only(text: str, parameter_format: str | None = None) -> dict:
    definition: dict = {"components": [{"type": "BODY", "text": text}]}
    if parameter_format:
        definition["parameter_format"] = parameter_format
    return definition


class TemplatesTestCase(unittest.TestCase):
    def use(self, summaries: list[dict], definitions: dict[str, dict], page_size: int = 100) -> FakeSocialMessaging:
        fake = FakeSocialMessaging(summaries, definitions, page_size)
        patches = [
            mock.patch.object(messaging, "social_messaging", fake),
            mock.patch.object(config, "waba_id", return_value="waba-1"),
            mock.patch.object(config, "origination_phone_number_id", return_value="arn:phone"),
            mock.patch.object(config, "meta_api_version", return_value="v20.0"),
            mock.patch.object(config, "default_phone_prefix", return_value="56"),
        ]
        for patch in patches:
            patch.start()
        self.addCleanup(mock.patch.stopall)
        return fake


class ListTemplatesTest(TemplatesTestCase):
    def test_returns_every_status_sorted_by_name_and_language(self):
        self.use(
            [
                summary("welcome", "REJECTED", "es_PE"),
                summary("welcome", "APPROVED", "en_US"),
                summary("appointment", "PENDING"),
                summary("old_promo", "PAUSED"),
            ],
            {
                "meta-welcome-es_PE": body_only("Hola"),
                "meta-welcome-en_US": body_only("Hi"),
                "meta-appointment-es_PE": body_only("Cita"),
                "meta-old_promo-es_PE": body_only("Promo"),
            },
            page_size=3,
        )
        templates = messaging.list_templates()
        self.assertEqual(
            [(item["name"], item["language"], item["status"]) for item in templates],
            [
                ("appointment", "es_PE", "PENDING"),
                ("old_promo", "es_PE", "PAUSED"),
                ("welcome", "en_US", "APPROVED"),
                ("welcome", "es_PE", "REJECTED"),
            ],
        )
        first = templates[0]
        self.assertEqual(first["category"], "UTILITY")
        self.assertEqual(first["qualityScore"], "UNKNOWN")
        self.assertEqual(first["metaTemplateId"], "meta-appointment-es_PE")

    def test_positional_variables_are_counted_once(self):
        text = f"Hola {var('1')}, tu cita es el {var('2')}. Te esperamos, {var('1')}."
        self.use([summary("reminder")], {"meta-reminder-es_PE": body_only(text)})
        [template] = messaging.list_templates()
        self.assertEqual(template["variables"], 2)
        self.assertEqual(template["variableNames"], ["1", "2"])
        self.assertEqual(template["parameterFormat"], "POSITIONAL")

    def test_named_variables_are_detected(self):
        text = f"Hola {var('first_name')}, tu pedido {var('order_id')} va en camino."
        self.use([summary("shipping")], {"meta-shipping-es_PE": body_only(text)})
        [template] = messaging.list_templates()
        self.assertEqual(template["variableNames"], ["first_name", "order_id"])
        self.assertEqual(template["parameterFormat"], "NAMED")

    def test_the_declared_parameter_format_wins(self):
        self.use([summary("plain")], {"meta-plain-es_PE": body_only("Sin variables", "named")})
        [template] = messaging.list_templates()
        self.assertEqual(template["parameterFormat"], "NAMED")
        self.assertEqual(template["variables"], 0)

    def test_parses_header_footer_and_buttons(self):
        definition = {
            "components": [
                {"type": "HEADER", "format": "TEXT", "text": "Recordatorio"},
                {"type": "BODY", "text": f"Tu cita es el {var('1')}"},
                {"type": "FOOTER", "text": "Responde STOP para salir"},
                {
                    "type": "BUTTONS",
                    "buttons": [
                        {"type": "QUICK_REPLY", "text": "Confirmar"},
                        {"type": "URL", "text": "Ver cita", "url": "https://example.com"},
                    ],
                },
            ]
        }
        self.use([summary("reminder")], {"meta-reminder-es_PE": definition})
        [template] = messaging.list_templates()
        self.assertEqual(template["header"], "Recordatorio")
        self.assertEqual(template["footer"], "Responde STOP para salir")
        self.assertEqual(
            template["buttons"],
            [{"type": "QUICK_REPLY", "text": "Confirmar"}, {"type": "URL", "text": "Ver cita"}],
        )

    def test_a_template_without_text_parts_gets_nulls(self):
        definition = {"components": [{"type": "HEADER", "format": "IMAGE"}, {"type": "BODY", "text": "Mira"}]}
        self.use([summary("photo")], {"meta-photo-es_PE": definition})
        [template] = messaging.list_templates()
        self.assertIsNone(template["header"])
        self.assertIsNone(template["footer"])
        self.assertEqual(template["buttons"], [])

    def test_an_unreadable_definition_does_not_hide_the_rest(self):
        self.use([summary("gone", "DELETED"), summary("ok")], {"meta-ok-es_PE": body_only("Hola")})
        templates = messaging.list_templates()
        self.assertEqual([item["name"] for item in templates], ["gone", "ok"])
        self.assertEqual(templates[0]["body"], "")

    def test_the_endpoint_returns_them_with_a_count(self):
        self.use([summary("a", "REJECTED"), summary("b")], {})
        response = get_templates.handler({"requestContext": {"authorizer": {"username": "ana"}}}, None)
        body = json.loads(response["body"])
        self.assertEqual(response["statusCode"], 200)
        self.assertEqual([item["status"] for item in body["data"]], ["REJECTED", "APPROVED"])
        self.assertEqual(body["metadata"]["count"], 2)


class SendTemplateTest(TemplatesTestCase):
    def setUp(self):
        self.saved = mock.MagicMock(side_effect=lambda phone, *args, **extra: {"phone": phone, **extra})
        patches = [
            mock.patch.object(store, "save_message", self.saved),
            mock.patch.object(store, "touch_conversation", return_value={}),
            mock.patch.object(realtime, "announce_message"),
        ]
        for patch in patches:
            patch.start()
        self.addCleanup(mock.patch.stopall)

    def send(self, name: str, parameters: list[str] | None = None, language: str = "es_PE") -> tuple[int, dict]:
        event = {
            "requestContext": {"authorizer": {"username": "ana"}},
            "body": json.dumps(
                {"phone": "+56911111111", "template_name": name, "language": language, "parameters": parameters or []}
            ),
        }
        response = send_template.handler(event, None)
        return response["statusCode"], json.loads(response["body"])

    def test_rejects_a_template_that_is_not_approved(self):
        fake = self.use([summary("promo", "PAUSED")], {"meta-promo-es_PE": body_only("Promo")})
        status, body = self.send("promo")
        self.assertEqual(status, 409)
        self.assertEqual(body["error"]["code"], "TEMPLATE_NOT_APPROVED")
        fake.send_whatsapp_message.assert_not_called()
        self.saved.assert_not_called()

    def test_rejects_an_unknown_template(self):
        fake = self.use([summary("promo")], {})
        status, body = self.send("promo", language="en_US")
        self.assertEqual(status, 404)
        self.assertEqual(body["error"]["code"], "TEMPLATE_NOT_FOUND")
        fake.send_whatsapp_message.assert_not_called()

    def test_rejects_a_wrong_number_of_parameters(self):
        self.use([summary("reminder")], {"meta-reminder-es_PE": body_only(f"Hola {var('1')}")})
        status, body = self.send("reminder", [])
        self.assertEqual(status, 422)
        self.assertEqual(body["error"]["code"], "VALIDATION_ERROR")

    def test_sends_positional_parameters(self):
        text = f"Hola {var('1')}, tu cita es el {var('2')}"
        fake = self.use([summary("reminder")], {"meta-reminder-es_PE": body_only(text)})
        status, _ = self.send("reminder", ["Camila", "lunes"])
        self.assertEqual(status, 200)
        template = fake.sent_payload()["template"]
        self.assertEqual(template["language"], {"code": "es_PE"})
        self.assertEqual(
            template["components"][0]["parameters"],
            [{"type": "text", "text": "Camila"}, {"type": "text", "text": "lunes"}],
        )

    def test_sends_named_parameters_tagged_with_their_names(self):
        text = f"Hola {var('first_name')}, tu pedido {var('order_id')}"
        fake = self.use([summary("shipping")], {"meta-shipping-es_PE": body_only(text, "NAMED")})
        status, _ = self.send("shipping", ["Camila", "A-12"])
        self.assertEqual(status, 200)
        self.assertEqual(
            fake.sent_payload()["template"]["components"][0]["parameters"],
            [
                {"type": "text", "parameter_name": "first_name", "text": "Camila"},
                {"type": "text", "parameter_name": "order_id", "text": "A-12"},
            ],
        )


if __name__ == "__main__":
    unittest.main()
