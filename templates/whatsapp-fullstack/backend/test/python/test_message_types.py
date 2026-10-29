"""Unit tests of every inbound message type, media and the media endpoints.

The payloads follow the Meta webhook reference as End User Messaging Social
relays it. Run from the backend root:

    python -m unittest discover -s test/python -v
"""
import importlib.util
import json
import unittest
from decimal import Decimal
from unittest import mock

import test_ws_handler as support

config = support.config
media = support.media
messaging = support.messaging
realtime = support.realtime
store = support.store
ws_handler = support.ws_handler
sns_event = support.sns_event

PHONE = "56911111111"


def load(folder: str):
    spec = importlib.util.spec_from_file_location(
        folder.replace("-", "_"), support.ROOT / "src" / "lambda" / "whatsapp" / folder / "index.py"
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


get_messages = load("get-messages")
send_message = load("send-message")
upload_url = load("media-upload-url")


def inbound(message_type: str, body: dict | None = None, message_id: str = "wamid.in", **extra) -> dict:
    message = {"from": PHONE, "id": message_id, "timestamp": "1760000000", "type": message_type, **extra}
    if body is not None:
        message[message_type] = body
    return message


class HandlerCase(support.WsHandlerTest):
    """Reuses the stubs of WsHandlerTest without re-running its tests."""

    def run_event(self, *messages, statuses=None):
        return ws_handler.handler(sns_event(*messages, statuses=statuses), None)

    def first(self) -> dict:
        self.assertTrue(self.saved, "nothing was stored")
        return self.saved[0]


# Do not collect the inherited tests twice.
for name in [attribute for attribute in dir(support.WsHandlerTest) if attribute.startswith("test_")]:
    setattr(HandlerCase, name, None)


class NormalizeTypesTest(HandlerCase):
    def test_text_keeps_the_reply_to_and_the_ad_referral(self):
        message = inbound(
            "text",
            {"body": "Lo vi en el anuncio"},
            context={"from": "15550001111", "id": "wamid.quoted"},
            referral={
                "source_url": "https://fb.me/ad",
                "source_type": "ad",
                "source_id": "120",
                "headline": "Oferta",
                "ctwa_clid": "ARAk",
                "media_type": "image",
                "image_url": "https://scontent/x.jpg",
            },
        )
        self.run_event(message)
        saved = self.first()
        self.assertEqual(saved["type"], "text")
        self.assertEqual(saved["message"], "Lo vi en el anuncio")
        self.assertEqual(saved["reply_to"], "wamid.quoted")
        self.assertEqual(saved["referral"]["source_type"], "ad")
        self.assertEqual(saved["referral"]["headline"], "Oferta")
        self.assertNotIn("image_url", saved["referral"])

    def test_forwarded_is_kept(self):
        self.run_event(inbound("text", {"body": "fwd"}, context={"forwarded": True}))
        self.assertTrue(self.first()["forwarded"])

    def test_image_is_downloaded_and_stored_with_its_media(self):
        image = {"id": "1234567890", "mime_type": "image/jpeg", "sha256": "abc=", "caption": "mi receta"}
        self.run_event(inbound("image", image))
        saved = self.first()
        self.mocks["download_inbound"].assert_called_once_with("1234567890", "arn:phone")
        self.assertEqual(saved["type"], "image")
        self.assertEqual(saved["message"], "[Imagen] mi receta")
        self.assertEqual(
            saved["media"],
            {"key": "media/m1.jpg", "mimeType": "image/jpeg", "size": 2048, "caption": "mi receta", "sha256": "abc="},
        )

    def test_the_announced_message_has_a_url_and_no_key(self):
        self.run_event(inbound("image", {"id": "1", "mime_type": "image/jpeg"}))
        announced = self.mocks["announce_message"].call_args.args[1]
        self.assertEqual(announced["media"]["url"], "https://signed/media/m1.jpg")
        self.assertNotIn("key", announced["media"])

    def test_a_failed_download_keeps_the_message(self):
        self.mocks["download_inbound"].side_effect = RuntimeError("AccessDenied")
        document = {"id": "99", "mime_type": "application/pdf", "filename": "receta.pdf", "sha256": "x"}
        self.assertEqual(self.run_event(inbound("document", document)), {"status": "processed"})
        saved = self.first()
        self.assertEqual(saved["type"], "document")
        self.assertEqual(saved["media"]["error"], "download_failed")
        self.assertEqual(saved["media"]["filename"], "receta.pdf")
        self.assertNotIn("key", saved["media"])

    def test_audio_video_and_sticker_are_media(self):
        self.run_event(
            inbound("audio", {"id": "1", "mime_type": "audio/ogg; codecs=opus", "voice": True}, "wamid.a"),
            inbound("video", {"id": "2", "mime_type": "video/mp4", "caption": "mira"}, "wamid.v"),
            inbound("sticker", {"id": "3", "mime_type": "image/webp", "animated": False}, "wamid.s"),
        )
        types = [item["type"] for item in self.saved]
        self.assertEqual(types, ["audio", "video", "sticker"])
        self.assertTrue(self.saved[0]["media"]["voice"])
        self.assertEqual(self.saved[1]["message"], "[Video] mira")
        self.assertEqual(self.mocks["download_inbound"].call_count, 3)

    def test_location_keeps_the_coordinates(self):
        location = {"latitude": -33.4372, "longitude": -70.6506, "name": "Oficina", "address": "Av. Providencia 1234"}
        self.run_event(inbound("location", location))
        saved = self.first()
        self.assertEqual(saved["type"], "location")
        self.assertEqual(saved["payload"]["latitude"], -33.4372)
        self.assertEqual(saved["payload"]["longitude"], -70.6506)
        self.assertEqual(saved["payload"]["name"], "Oficina")
        self.assertEqual(saved["message"], "[Ubicación] Oficina")

    def test_contacts_keep_names_phones_and_emails(self):
        contacts = [
            {
                "name": {"formatted_name": "Ana Pérez", "first_name": "Ana"},
                "phones": [{"phone": "+56 9 2222 3333", "wa_id": "56922223333", "type": "CELL"}],
                "emails": [{"email": "ana@example.com", "type": "WORK"}],
                "org": {"company": "ACME"},
            }
        ]
        self.run_event(inbound("contacts", None, contacts=contacts))
        card = self.first()["payload"]["contacts"][0]
        self.assertEqual(card["name"], "Ana Pérez")
        self.assertEqual(card["phones"][0]["phone"], "+56 9 2222 3333")
        self.assertEqual(card["emails"], ["ana@example.com"])
        self.assertEqual(card["org"], "ACME")
        self.assertEqual(self.first()["message"], "[Contacto] Ana Pérez")

    def test_button_and_list_replies_keep_their_ids(self):
        self.run_event(
            inbound("interactive", {"type": "button_reply", "button_reply": {"id": "yes", "title": "Sí"}}, "wamid.b"),
            inbound(
                "interactive",
                {"type": "list_reply", "list_reply": {"id": "slot-10", "title": "10:00", "description": "Jueves"}},
                "wamid.l",
            ),
        )
        self.assertEqual(self.saved[0]["type"], "button_reply")
        self.assertEqual(self.saved[0]["payload"], {"id": "yes", "title": "Sí"})
        self.assertEqual(self.saved[0]["message"], "Sí")
        self.assertEqual(self.saved[1]["type"], "list_reply")
        self.assertEqual(self.saved[1]["payload"]["description"], "Jueves")

    def test_a_flow_reply_parses_the_response(self):
        reply = {
            "type": "nfm_reply",
            "nfm_reply": {
                "name": "flow",
                "body": "Sent",
                "response_json": json.dumps({"flow_token": "t1", "rut": "12.345.678-9", "score": 4.5}),
            },
        }
        self.run_event(inbound("interactive", reply))
        saved = self.first()
        self.assertEqual(saved["type"], "nfm_reply")
        self.assertEqual(saved["payload"]["response"]["rut"], "12.345.678-9")
        self.assertEqual(saved["payload"]["response"]["score"], 4.5)
        self.assertEqual(saved["payload"]["body"], "Sent")

    def test_a_flow_reply_with_invalid_json_keeps_the_raw_text(self):
        reply = {"type": "nfm_reply", "nfm_reply": {"name": "flow", "body": "", "response_json": "not json"}}
        self.run_event(inbound("interactive", reply))
        self.assertEqual(self.first()["payload"]["response"], "not json")
        self.assertEqual(self.first()["message"], "[Formulario]")

    def test_a_template_quick_reply_keeps_text_and_payload(self):
        message = inbound("button", {"text": "Confirmar", "payload": "CONFIRM_42"}, context={"id": "wamid.template"})
        self.run_event(message)
        saved = self.first()
        self.assertEqual(saved["type"], "button")
        self.assertEqual(saved["payload"], {"text": "Confirmar", "payload": "CONFIRM_42"})
        self.assertEqual(saved["reply_to"], "wamid.template")

    def test_an_order_keeps_its_items(self):
        order = {
            "catalog_id": "cat-1",
            "text": "Para mañana",
            "product_items": [
                {"product_retailer_id": "SKU-1", "quantity": 2, "item_price": 9990.5, "currency": "CLP"},
            ],
        }
        self.run_event(inbound("order", order))
        saved = self.first()
        self.assertEqual(saved["type"], "order")
        self.assertEqual(saved["payload"]["catalog_id"], "cat-1")
        self.assertEqual(saved["payload"]["items"][0]["item_price"], 9990.5)
        self.assertEqual(saved["payload"]["items"][0]["quantity"], 2)

    def test_an_unknown_type_keeps_the_raw_message(self):
        message = inbound("unsupported", None, errors=[{"code": 131051, "title": "Message type unknown"}])
        self.run_event(message)
        saved = self.first()
        self.assertEqual(saved["type"], "unsupported")
        self.assertEqual(saved["payload"]["original_type"], "unsupported")
        self.assertEqual(saved["payload"]["errors"][0]["code"], 131051)
        self.assertIn("131051", saved["payload"]["raw"])

    def test_a_new_meta_type_is_unsupported_too(self):
        self.run_event(inbound("ephemeral", {"x": 1}))
        self.assertEqual(self.first()["type"], "unsupported")
        self.assertEqual(self.first()["payload"]["original_type"], "ephemeral")


class AutoReplyRulesTest(HandlerCase):
    def setUp(self):
        super().setUp()
        self.mocks["auto_reply_message"].return_value = "Gracias"

    def test_customer_content_is_answered(self):
        self.run_event(inbound("location", {"latitude": 1.5, "longitude": 2.5}))
        self.mocks["send_text"].assert_called_once()

    def test_system_notices_are_stored_but_not_answered_and_do_not_open_the_window(self):
        system = {"body": "User A changed from 56911111111 to 56933333333", "type": "user_changed_number", "new_wa_id": "56933333333"}
        with mock.patch.object(store, "touch_conversation", return_value=self.conversation) as touch:
            self.run_event(inbound("system", system))
        self.assertEqual(self.first()["type"], "system")
        self.assertEqual(self.first()["payload"]["new_wa_id"], "56933333333")
        self.assertFalse(touch.call_args.kwargs["opens_window"])
        self.mocks["send_text"].assert_not_called()

    def test_request_welcome_is_not_answered(self):
        self.run_event(inbound("request_welcome"))
        self.assertEqual(self.first()["type"], "request_welcome")
        self.mocks["send_text"].assert_not_called()

    def test_unsupported_is_not_answered(self):
        self.run_event(inbound("unknown"))
        self.mocks["send_text"].assert_not_called()


class ReactionTest(HandlerCase):
    def test_a_reaction_is_attached_to_its_message_and_never_answered(self):
        self.mocks["auto_reply_message"].return_value = "Gracias"
        updated = {"phone": PHONE, "date": "d", "message_id": "wamid.target", "reaction": {"emoji": "❤️"}}
        self.mocks["set_reaction"].return_value = updated
        self.run_event(inbound("reaction", {"message_id": "wamid.target", "emoji": "❤️"}))
        self.mocks["set_reaction"].assert_called_once_with("wamid.target", "❤️")
        self.assertEqual(self.saved, [])
        self.mocks["send_text"].assert_not_called()
        self.mocks["mark_as_read"].assert_not_called()
        self.mocks["publish"].assert_called_once_with(PHONE, realtime.MESSAGE_UPDATED, payload=updated)

    def test_an_empty_emoji_removes_it(self):
        self.run_event(inbound("reaction", {"message_id": "wamid.target", "emoji": ""}))
        self.mocks["set_reaction"].assert_called_once_with("wamid.target", "")

    def test_a_reaction_to_an_unknown_message_is_ignored(self):
        self.run_event(inbound("reaction", {"message_id": "wamid.unknown", "emoji": "👍"}))
        self.mocks["publish"].assert_not_called()


class StatusTypesTest(HandlerCase):
    def test_deleted_marks_the_message(self):
        self.mocks["mark_message"].return_value = {"phone": PHONE, "date": "d", "deleted": True}
        self.run_event(statuses=[{"id": "wamid.out", "status": "deleted"}])
        self.mocks["mark_message"].assert_called_once_with("wamid.out", deleted=True)
        self.mocks["update_status"].assert_not_called()

    def test_warning_is_recorded(self):
        status = {"id": "wamid.out", "status": "warning", "errors": [{"title": "Item unavailable"}]}
        self.run_event(statuses=[status])
        self.mocks["mark_message"].assert_called_once_with("wamid.out", warning="Item unavailable")


class StoreReactionTest(unittest.TestCase):
    def setUp(self):
        self.table = mock.MagicMock()
        self.table.update_item.return_value = {"Attributes": {"phone": PHONE}}
        for patch in (
            mock.patch.object(store, "messages_table", self.table),
            mock.patch.object(store, "find_message_key", return_value={"phone": PHONE, "date": "d"}),
        ):
            patch.start()
        self.addCleanup(mock.patch.stopall)

    def test_sets_and_replaces_the_reaction(self):
        store.set_reaction("wamid.1", "👍")
        kwargs = self.table.update_item.call_args.kwargs
        self.assertEqual(kwargs["UpdateExpression"], "SET #reaction = :reaction")
        self.assertEqual(kwargs["ExpressionAttributeValues"][":reaction"]["emoji"], "👍")

    def test_removes_it_with_an_empty_emoji(self):
        store.set_reaction("wamid.1", "")
        self.assertEqual(self.table.update_item.call_args.kwargs["UpdateExpression"], "REMOVE #reaction")

    def test_floats_become_decimals(self):
        self.assertEqual(store.to_dynamo({"a": [1.25, True, 3]}), {"a": [Decimal("1.25"), True, 3]})

    def test_save_message_stores_coordinates_as_decimals(self):
        store.save_message(PHONE, store.INBOUND, "location", "x", payload={"latitude": -33.4372, "longitude": -70.6506})
        item = self.table.put_item.call_args.kwargs["Item"]
        self.assertEqual(item["payload"]["latitude"], Decimal("-33.4372"))
        self.assertIsInstance(item["payload"]["longitude"], Decimal)


class FakeS3:
    def __init__(self, keys: dict[str, int] | None = None, head: dict | None = None):
        self.keys = keys or {}
        self.head = head
        self.copied: list[tuple[str, str]] = []
        self.deleted: list[str] = []

    def list_objects_v2(self, Bucket, Prefix):
        return {"Contents": [{"Key": key, "Size": size} for key, size in self.keys.items() if key.startswith(Prefix)]}

    def copy_object(self, Bucket, Key, CopySource, ContentType, MetadataDirective):
        self.copied.append((CopySource["Key"], Key))

    def delete_object(self, Bucket, Key):
        self.deleted.append(Key)

    def head_object(self, Bucket, Key):
        if self.head is None:
            raise RuntimeError("404")
        return self.head

    def generate_presigned_url(self, operation, Params, ExpiresIn):
        return f"https://signed/{operation}/{Params['Key']}?ttl={ExpiresIn}&ct={Params.get('ContentType', '')}"


class MediaModuleTest(unittest.TestCase):
    def setUp(self):
        patch = mock.patch.object(media, "MEDIA_BUCKET_NAME", "bucket")
        patch.start()
        self.addCleanup(mock.patch.stopall)

    def test_download_finds_and_renames_the_object(self):
        fake = FakeS3({"media/777.vnd.openxmlformats-officedocument.wordprocessingml.document": 4096})
        social = mock.MagicMock()
        social.get_whatsapp_message_media.return_value = {
            "mimeType": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "fileSize": 4,
        }
        with mock.patch.object(media, "s3", fake), mock.patch.object(media, "social_messaging", social):
            stored = media.download_inbound("777", "arn:phone")
        social.get_whatsapp_message_media.assert_called_once_with(
            mediaId="777",
            originationPhoneNumberId="arn:phone",
            metadataOnly=False,
            destinationS3File={"bucketName": "bucket", "key": "media/"},
        )
        self.assertEqual(stored["key"], "media/777.docx")
        self.assertEqual(stored["size"], 4096)
        self.assertEqual(fake.deleted, ["media/777.vnd.openxmlformats-officedocument.wordprocessingml.document"])

    def test_the_transcribe_output_is_not_the_media(self):
        fake = FakeS3({"media/5.json": 10, "media/5.ogg": 20})
        with mock.patch.object(media, "s3", fake):
            self.assertEqual(media.stored_media_key("5"), {"key": "media/5.ogg", "size": 20})

    def test_limits_follow_whatsapp(self):
        self.assertEqual(media.validate_outbound("image/png", 5 * media.MB), "image")
        self.assertEqual(media.validate_outbound("audio/ogg; codecs=opus", 1000), "audio")
        self.assertEqual(media.validate_outbound("video/3gpp", 1000), "video")
        self.assertEqual(media.validate_outbound("application/pdf", 100 * media.MB), "document")
        for mime, size in (("image/png", 5 * media.MB + 1), ("image/gif", 10), ("video/mp4", 17 * media.MB), ("application/pdf", 0)):
            with self.assertRaises(media.MediaRejected):
                media.validate_outbound(mime, size)

    def test_exposed_swaps_the_key_for_a_url(self):
        with mock.patch.object(media, "s3", FakeS3()):
            item = media.exposed({"media": {"key": "media/1.jpg", "mimeType": "image/jpeg"}})
        self.assertTrue(item["media"]["url"].startswith("https://signed/get_object/media/1.jpg?ttl="))
        self.assertNotIn("key", item["media"])
        self.assertEqual(media.exposed({"message": "x"}), {"message": "x"})

    def test_exposed_never_returns_the_key_of_a_failed_download(self):
        item = media.exposed({"media": {"error": "download_failed", "mimeType": "image/jpeg"}})
        self.assertNotIn("url", item["media"])


def api_event(body: dict | None = None, query: dict | None = None, groups: str = "admin") -> dict:
    return {
        "httpMethod": "POST",
        "headers": {},
        "body": json.dumps(body) if body is not None else None,
        "queryStringParameters": query,
        "requestContext": {"authorizer": {"username": "ana", "email": "ana@example.com", "groups": groups}},
    }


def response_body(response: dict) -> dict:
    return json.loads(response["body"])


class GetMessagesTest(unittest.TestCase):
    def test_returns_presigned_urls_and_never_the_key(self):
        items = [{"phone": PHONE, "date": "d", "type": "image", "media": {"key": "media/1.jpg", "mimeType": "image/jpeg"}}]
        with mock.patch.object(store, "list_messages", return_value=items), mock.patch.object(
            store, "get_conversation", return_value={"phone": PHONE}
        ), mock.patch.object(media, "MEDIA_BUCKET_NAME", "bucket"), mock.patch.object(media, "s3", FakeS3()):
            response = get_messages.handler(api_event(query={"phone": PHONE}), None)
        self.assertEqual(response["statusCode"], 200)
        self.assertNotIn('"key"', response["body"])
        message = response_body(response)["data"]["messages"][0]
        self.assertIn("url", message["media"])
        self.assertNotIn("key", message["media"])


class UploadUrlTest(unittest.TestCase):
    def setUp(self):
        for patch in (
            mock.patch.object(media, "MEDIA_BUCKET_NAME", "bucket"),
            mock.patch.object(media, "s3", FakeS3()),
            mock.patch.object(config, "default_phone_prefix", return_value="56"),
        ):
            patch.start()
        self.addCleanup(mock.patch.stopall)

    def test_presigns_an_outbound_key_bound_to_the_content_type(self):
        body = {"phone": PHONE, "filename": "receta.pdf", "mimeType": "application/pdf", "size": 2048}
        response = upload_url.handler(api_event(body), None)
        self.assertEqual(response["statusCode"], 200)
        data = response_body(response)["data"]
        self.assertRegex(data["key"], r"^outbound/[0-9a-f-]{36}\.pdf$")
        self.assertIn("ct=application/pdf", data["upload_url"])
        self.assertEqual(data["headers"], {"Content-Type": "application/pdf"})
        self.assertEqual(data["type"], "document")

    def test_rejects_what_whatsapp_does_not_accept(self):
        too_big = {"phone": PHONE, "filename": "foto.png", "mimeType": "image/png", "size": 6 * media.MB}
        response = upload_url.handler(api_event(too_big), None)
        self.assertEqual(response["statusCode"], 422)
        self.assertIn("MEDIA_REJECTED", response["body"])
        gif = {"phone": PHONE, "filename": "x.gif", "mimeType": "image/gif", "size": 10}
        self.assertEqual(upload_url.handler(api_event(gif), None)["statusCode"], 422)
        no_size = {"phone": PHONE, "filename": "x.png", "mimeType": "image/png"}
        self.assertEqual(upload_url.handler(api_event(no_size), None)["statusCode"], 422)

    def test_requires_the_admin_group(self):
        with mock.patch.object(support.http, "ADMIN_GROUP", "admin"):
            response = upload_url.handler(api_event({"phone": PHONE}, groups="member"), None)
        self.assertEqual(response["statusCode"], 403)


class SendMediaTest(unittest.TestCase):
    KEY = "outbound/0f8fad5b-d9cb-469f-a165-70867728950e.jpg"

    def setUp(self):
        self.s3 = FakeS3(head={"ContentType": "image/jpeg", "ContentLength": 1024})
        self.social = mock.MagicMock()
        self.social.post_whatsapp_message_media.return_value = {"mediaId": "media-42"}
        self.saved = []

        def save_message(phone, direction, message_type, text="", **extra):
            item = {"phone": phone, "date": "d", "direction": direction, "type": message_type, "message": text}
            item.update({key: value for key, value in extra.items() if value not in (None, "")})
            self.saved.append(item)
            return item

        for patch in (
            mock.patch.object(media, "MEDIA_BUCKET_NAME", "bucket"),
            mock.patch.object(media, "s3", self.s3),
            mock.patch.object(media, "social_messaging", self.social),
            mock.patch.object(config, "default_phone_prefix", return_value="56"),
            mock.patch.object(config, "origination_phone_number_id", return_value="arn:phone"),
            mock.patch.object(store, "get_conversation", return_value={"last_inbound_at": store.now_iso()}),
            mock.patch.object(store, "save_message", side_effect=save_message),
            mock.patch.object(store, "touch_conversation", return_value={}),
            mock.patch.object(realtime, "announce_message"),
            mock.patch.object(messaging, "_send", return_value="wamid.media"),
        ):
            patch.start()
        self.addCleanup(mock.patch.stopall)

    def body(self, **media_fields) -> dict:
        return {"phone": PHONE, "media": {"key": self.KEY, "mimeType": "image/jpeg", **media_fields}}

    def test_uploads_to_whatsapp_and_sends_an_image(self):
        response = send_message.handler(api_event(self.body(caption="Tu receta")), None)
        self.assertEqual(response["statusCode"], 200)
        self.social.post_whatsapp_message_media.assert_called_once_with(
            originationPhoneNumberId="arn:phone", sourceS3File={"bucketName": "bucket", "key": self.KEY}
        )
        payload = messaging._send.call_args.args[0]
        self.assertEqual(payload["type"], "image")
        self.assertEqual(payload["image"], {"id": "media-42", "caption": "Tu receta"})
        stored = self.saved[0]
        self.assertEqual(stored["type"], "image")
        self.assertEqual(stored["media"]["key"], self.KEY)
        self.assertEqual(stored["message"], "[Imagen] Tu receta")
        data = response_body(response)["data"]
        self.assertNotIn("key", data["media"])
        self.assertIn("url", data["media"])

    def test_a_document_carries_its_filename(self):
        self.s3.head = {"ContentType": "application/pdf", "ContentLength": 1024}
        body = {"phone": PHONE, "media": {"key": self.KEY.replace(".jpg", ".pdf"), "mimeType": "application/pdf", "filename": "receta.pdf"}}
        send_message.handler(api_event(body), None)
        payload = messaging._send.call_args.args[0]
        self.assertEqual(payload["document"], {"id": "media-42", "filename": "receta.pdf"})

    def test_rejects_a_key_that_is_not_an_upload(self):
        body = {"phone": PHONE, "media": {"key": "media/123.jpg", "mimeType": "image/jpeg"}}
        response = send_message.handler(api_event(body), None)
        self.assertEqual(response["statusCode"], 422)
        self.social.post_whatsapp_message_media.assert_not_called()

    def test_rejects_an_upload_with_another_content_type(self):
        self.s3.head = {"ContentType": "image/png", "ContentLength": 1024}
        self.assertEqual(send_message.handler(api_event(self.body()), None)["statusCode"], 422)

    def test_rejects_an_upload_over_the_limit(self):
        self.s3.head = {"ContentType": "image/jpeg", "ContentLength": 6 * media.MB}
        self.assertEqual(send_message.handler(api_event(self.body()), None)["statusCode"], 422)

    def test_the_window_rule_still_applies(self):
        with mock.patch.object(store, "get_conversation", return_value={}):
            response = send_message.handler(api_event(self.body()), None)
        self.assertEqual(response["statusCode"], 409)
        self.social.post_whatsapp_message_media.assert_not_called()

    def test_text_still_works(self):
        response = send_message.handler(api_event({"phone": PHONE, "message": "Hola"}), None)
        self.assertEqual(response["statusCode"], 200)
        self.assertEqual(self.saved[0]["type"], "text")


if __name__ == "__main__":
    unittest.main()
