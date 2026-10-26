"""Unit tests of the ws-handler Lambda, with AWS stubbed out.

Run from the backend root, no AWS credentials or packages needed:

    python -m unittest discover -s test/python -v
"""
import importlib.util
import json
import sys
import types
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[2]


def install_aws_stubs() -> None:
    """Fake boto3/botocore so the layer imports without the real SDK."""
    boto3 = types.ModuleType("boto3")
    boto3.client = mock.MagicMock()
    boto3.resource = mock.MagicMock()
    boto3.Session = mock.MagicMock()
    dynamodb = types.ModuleType("boto3.dynamodb")
    conditions = types.ModuleType("boto3.dynamodb.conditions")
    conditions.Key = mock.MagicMock()
    botocore = types.ModuleType("botocore")
    auth = types.ModuleType("botocore.auth")
    auth.SigV4Auth = mock.MagicMock()
    awsrequest = types.ModuleType("botocore.awsrequest")
    awsrequest.AWSRequest = mock.MagicMock()
    exceptions = types.ModuleType("botocore.exceptions")
    exceptions.ClientError = type("ClientError", (Exception,), {})
    sys.modules.update(
        {
            "boto3": boto3,
            "boto3.dynamodb": dynamodb,
            "boto3.dynamodb.conditions": conditions,
            "botocore": botocore,
            "botocore.auth": auth,
            "botocore.awsrequest": awsrequest,
            "botocore.exceptions": exceptions,
        }
    )


install_aws_stubs()
sys.path.insert(0, str(ROOT / "src" / "layer" / "python-common" / "python"))

from common.whatsapp import config, messaging, realtime, store  # noqa: E402

spec = importlib.util.spec_from_file_location(
    "ws_handler", ROOT / "src" / "lambda" / "whatsapp" / "ws-handler" / "index.py"
)
ws_handler = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ws_handler)


def sns_event(*messages: dict, contacts: list | None = None) -> dict:
    entry = {"changes": [{"value": {"messages": list(messages), "contacts": contacts or []}}]}
    body = {
        "context": {"MetaPhoneNumberIds": [{"arn": "arn:phone"}]},
        "whatsAppWebhookEntry": json.dumps(entry),
    }
    return {"Records": [{"Sns": {"MessageId": "sns-1", "Message": json.dumps(body)}}]}


def text_message(body: str = "Hola", message_id: str = "wamid.1") -> dict:
    return {"from": "56911111111", "id": message_id, "type": "text", "text": {"body": body}}


class WsHandlerTest(unittest.TestCase):
    def setUp(self):
        self.saved = []

        def save_message(phone, direction, message_type, text="", **extra):
            item = {"phone": phone, "date": f"2026-10-01T10:00:0{len(self.saved)}Z", "direction": direction, "type": message_type, "message": text, **extra}
            self.saved.append(item)
            return item

        self.conversation = {"phone": "56911111111", "mode": "assistant"}
        patches = [
            mock.patch.object(store, "get_conversation", return_value={}),
            mock.patch.object(store, "save_message", side_effect=save_message),
            mock.patch.object(store, "touch_conversation", side_effect=lambda *a, **k: self.conversation),
            mock.patch.object(realtime, "announce_message"),
            mock.patch.object(messaging, "mark_as_read"),
            mock.patch.object(messaging, "send_text", return_value="wamid.reply"),
            mock.patch.object(config, "auto_reply_message", return_value=""),
        ]
        self.mocks = {p.attribute: p.start() for p in patches}
        self.addCleanup(mock.patch.stopall)

    def test_stores_and_announces_an_inbound_text(self):
        ws_handler.handler(
            sns_event(text_message(), contacts=[{"wa_id": "56911111111", "profile": {"name": "Camila"}}]),
            None,
        )
        self.assertEqual(len(self.saved), 1)
        self.assertEqual(self.saved[0]["direction"], store.INBOUND)
        self.assertEqual(self.saved[0]["message"], "Hola")
        self.assertEqual(self.saved[0]["name"], "Camila")
        self.mocks["announce_message"].assert_called_once()
        self.mocks["mark_as_read"].assert_called_once_with("wamid.1", "arn:phone")
        self.mocks["send_text"].assert_not_called()

    def test_sends_the_auto_reply_when_configured(self):
        self.mocks["auto_reply_message"].return_value = "Gracias"
        ws_handler.handler(sns_event(text_message()), None)
        self.mocks["send_text"].assert_called_once_with("56911111111", "Gracias", "arn:phone")
        self.assertEqual([item["direction"] for item in self.saved], [store.INBOUND, store.OUTBOUND])

    def test_does_not_reply_when_a_person_has_the_conversation(self):
        self.mocks["auto_reply_message"].return_value = "Gracias"
        self.conversation = {"phone": "56911111111", "mode": "human"}
        ws_handler.handler(sns_event(text_message()), None)
        self.mocks["send_text"].assert_not_called()
        self.assertEqual(len(self.saved), 1)

    def test_ignores_a_duplicate_delivery(self):
        self.mocks["get_conversation"].return_value = {"last_inbound_message_id": "wamid.1"}
        ws_handler.handler(sns_event(text_message()), None)
        self.assertEqual(self.saved, [])

    def test_stores_media_as_a_placeholder_with_its_caption(self):
        image = {"from": "56911111111", "id": "wamid.2", "type": "image", "image": {"id": "m1", "caption": "mi receta"}}
        ws_handler.handler(sns_event(image), None)
        self.assertEqual(self.saved[0]["type"], "image")
        self.assertEqual(self.saved[0]["message"], "[Imagen] mi receta")

    def test_ignores_status_notifications(self):
        event = sns_event()
        ws_handler.handler(event, None)
        self.assertEqual(self.saved, [])


class NormalizePhoneTest(unittest.TestCase):
    def test_completes_a_local_number_with_the_default_prefix(self):
        self.assertEqual(messaging.normalize_phone("9 1234 5678", prefix="56"), "56912345678")

    def test_keeps_a_number_written_with_plus(self):
        self.assertEqual(messaging.normalize_phone("+51 987 654 321", prefix="56"), "51987654321")

    def test_rejects_what_is_not_a_phone(self):
        with self.assertRaises(ValueError):
            messaging.normalize_phone("hola", prefix="56")


if __name__ == "__main__":
    unittest.main()
