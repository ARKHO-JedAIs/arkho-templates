"""Unit tests of the inbox: unread counters, search and takeover notices.

Run from the backend root: python -m unittest discover -s test/python -v
"""
import importlib.util
import json
import unittest
from unittest import mock

import test_ws_handler as support

http = support.http
realtime = support.realtime
store = support.store
ws_handler = support.ws_handler


def load(folder: str):
    spec = importlib.util.spec_from_file_location(
        folder.replace("-", "_"), support.ROOT / "src" / "lambda" / "whatsapp" / folder / "index.py"
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


get_conversations = load("get-conversations")
mark_read = load("mark-read")
put_control = load("put-control")


def client_error(code: str) -> Exception:
    error = support.messaging.ClientError(code)
    error.response = {"Error": {"Code": code, "Message": code}}
    return error


def caller(**extra) -> dict:
    return {"requestContext": {"authorizer": {"username": "ana-id", "email": "ana@example.com"}}, **extra}


class TouchConversationTest(unittest.TestCase):
    def setUp(self):
        self.table = mock.MagicMock()
        self.table.update_item.return_value = {"Attributes": {"phone": "56911111111"}}
        patch = mock.patch.object(store, "conversations_table", self.table)
        patch.start()
        self.addCleanup(mock.patch.stopall)

    def touch(self, **kwargs) -> dict:
        message = {"phone": "56911111111", "date": "2026-10-01T10:00:00.000+00:00", "direction": store.INBOUND, "type": "text"}
        store.touch_conversation(message, **kwargs)
        return self.table.update_item.call_args.kwargs

    def test_customer_content_adds_one_unread_atomically(self):
        call = self.touch(name="José Peña", counts_unread=True)
        self.assertIn("ADD #unread :one", call["UpdateExpression"])
        self.assertEqual(call["ExpressionAttributeNames"]["#unread"], "unread_count")
        self.assertEqual(call["ExpressionAttributeValues"][":one"], 1)

    def test_other_messages_do_not_count(self):
        call = self.touch(counts_unread=False)
        self.assertNotIn("ADD", call["UpdateExpression"])

    def test_writes_a_folded_search_key(self):
        call = self.touch(name="José Peña")
        self.assertEqual(call["ExpressionAttributeValues"][":search_key"], "jose pena 56911111111")
        self.assertIn("#search_key = :search_key", call["UpdateExpression"])

    def test_keeps_a_known_name_in_the_search_key_when_none_is_given(self):
        call = self.touch()
        self.assertIn("if_not_exists(#search_key, :search_key)", call["UpdateExpression"])
        self.assertEqual(call["ExpressionAttributeValues"][":search_key"], "56911111111")


class UnreadInWsHandlerTest(unittest.TestCase):
    setUp = support.WsHandlerTest.setUp

    def counted(self) -> bool:
        return self.mocks["touch_conversation"].call_args.kwargs["counts_unread"]

    def test_a_text_counts_as_unread(self):
        ws_handler.handler(support.sns_event(support.text_message()), None)
        self.assertTrue(self.counted())

    def test_notices_do_not_count(self):
        for message in (
            {"from": "56911111111", "id": "wamid.s", "type": "system", "system": {"body": "Cambió"}},
            {"from": "56911111111", "id": "wamid.w", "type": "request_welcome"},
        ):
            ws_handler.handler(support.sns_event(message), None)
            self.assertFalse(self.counted())

    def test_a_reaction_touches_no_conversation(self):
        reaction = {"from": "56911111111", "id": "wamid.r", "type": "reaction", "reaction": {"message_id": "wamid.1", "emoji": "x"}}
        ws_handler.handler(support.sns_event(reaction), None)
        self.mocks["touch_conversation"].assert_not_called()


class ConversationViewTest(unittest.TestCase):
    def test_exposes_the_unread_count_and_hides_internals(self):
        view = store.conversation_view({"phone": "1", "unread_count": 3, "search_key": "x", "inbox": "all"})
        self.assertEqual(view, {"phone": "1", "unread_count": 3, "unreadCount": 3})

    def test_a_conversation_without_counter_has_none_unread(self):
        self.assertEqual(store.conversation_view({"phone": "1"})["unreadCount"], 0)


class SearchTest(unittest.TestCase):
    def setUp(self):
        self.table = mock.MagicMock()
        patch = mock.patch.object(store, "conversations_table", self.table)
        patch.start()
        self.addCleanup(mock.patch.stopall)

    def test_search_terms(self):
        self.assertEqual(store.search_term("  José "), "jose")
        self.assertEqual(store.search_term("+56 9 1234-5678"), "56912345678")
        self.assertEqual(store.search_term("Ana 2"), "ana 2")

    def test_scans_every_page_with_the_filter_and_sorts_by_recency(self):
        self.table.scan.side_effect = [
            {"Items": [{"phone": "1", "last_message_at": "2026-10-01"}], "LastEvaluatedKey": {"phone": "1"}},
            {"Items": [{"phone": "2", "last_message_at": "2026-10-02"}]},
        ]
        found = store.search_conversations("Pérez")
        self.assertEqual([item["phone"] for item in found], ["2", "1"])
        first, second = self.table.scan.call_args_list
        self.assertEqual(first.kwargs["FilterExpression"], "contains(#search_key, :term)")
        self.assertEqual(first.kwargs["ExpressionAttributeValues"], {":term": "perez"})
        self.assertEqual(second.kwargs["ExclusiveStartKey"], {"phone": "1"})

    def test_stops_at_the_limit(self):
        self.table.scan.return_value = {"Items": [{"phone": str(n)} for n in range(30)], "LastEvaluatedKey": {"phone": "x"}}
        self.assertEqual(len(store.search_conversations("ana", limit=50)), 50)
        self.assertEqual(self.table.scan.call_count, 2)

    def test_the_endpoint_searches_with_two_characters_or_more(self):
        with mock.patch.object(store, "search_conversations", return_value=[{"phone": "1"}]) as search, mock.patch.object(
            store, "list_conversations", return_value=[]
        ) as listing:
            response = get_conversations.handler(caller(queryStringParameters={"search": "jo"}), None)
            self.assertEqual(json.loads(response["body"])["data"], [{"phone": "1", "unreadCount": 0}])
            search.assert_called_once_with("jo")
            get_conversations.handler(caller(queryStringParameters={"search": "j"}), None)
            listing.assert_called_once()

    def test_the_endpoint_rejects_a_long_search(self):
        response = get_conversations.handler(caller(queryStringParameters={"search": "x" * 65}), None)
        self.assertEqual(response["statusCode"], 422)


class MarkReadTest(unittest.TestCase):
    def setUp(self):
        self.table = mock.MagicMock()
        patches = [mock.patch.object(store, "conversations_table", self.table), mock.patch.object(realtime, "publish")]
        self.mocks = [patch.start() for patch in patches]
        self.addCleanup(mock.patch.stopall)

    def request(self, phone: str = "56911111111") -> tuple[int, dict]:
        response = mark_read.handler(caller(pathParameters={"phone": phone}), None)
        return response["statusCode"], json.loads(response["body"])

    def test_resets_the_counter_and_announces_it(self):
        self.table.update_item.return_value = {"Attributes": {"phone": "56911111111", "unread_count": 0}}
        status, body = self.request()
        self.assertEqual(status, 200)
        self.assertEqual(body["data"]["unreadCount"], 0)
        call = self.table.update_item.call_args.kwargs
        self.assertEqual(call["ExpressionAttributeValues"], {":zero": 0})
        self.assertEqual(call["ConditionExpression"], "attribute_exists(phone)")
        self.mocks[1].assert_called_once_with(
            realtime.INBOX_CHANNEL, realtime.CONVERSATION_UPDATED, payload={"phone": "56911111111", "unread_count": 0, "unreadCount": 0}
        )

    def test_an_unknown_conversation_is_404(self):
        self.table.update_item.side_effect = client_error("ConditionalCheckFailedException")
        status, body = self.request()
        self.assertEqual(status, 404)
        self.assertEqual(body["error"]["code"], "NOT_FOUND")

    def test_rejects_what_is_not_a_phone(self):
        self.assertEqual(self.request("abc")[0], 422)

    def test_requires_the_admin_group(self):
        with mock.patch.object(http, "ADMIN_GROUP", "admin"):
            self.assertEqual(self.request()[0], 403)


class TakeoverNoticeTest(unittest.TestCase):
    def setUp(self):
        self.current = {"phone": "56911111111", "mode": "assistant"}
        self.saved: list[dict] = []

        def save_message(phone, direction, message_type, text="", **extra):
            item = {"phone": phone, "date": "d", "direction": direction, "type": message_type, "message": text, **extra}
            self.saved.append(item)
            return item

        patches = [
            mock.patch.object(store, "get_conversation", side_effect=lambda phone: dict(self.current)),
            mock.patch.object(store, "set_mode", side_effect=lambda phone, mode, *a: {"phone": phone, "mode": mode}),
            mock.patch.object(store, "save_message", side_effect=save_message),
            mock.patch.object(store, "touch_conversation"),
            mock.patch.object(realtime, "publish"),
        ]
        self.mocks = {patch.attribute: patch.start() for patch in patches}
        self.addCleanup(mock.patch.stopall)

    def change(self, mode: str) -> int:
        return put_control.handler(caller(body=json.dumps({"phone": "56911111111", "mode": mode})), None)["statusCode"]

    def test_a_takeover_stores_and_announces_an_internal_notice(self):
        self.assertEqual(self.change("human"), 200)
        [notice] = self.saved
        self.assertEqual(notice["direction"], store.INTERNAL)
        self.assertEqual(notice["type"], "event")
        self.assertEqual(notice["payload"], {"kind": "human_takeover", "by": "ana@example.com"})
        self.assertEqual(notice["message"], "ana@example.com tomó la conversación")
        self.mocks["publish"].assert_any_call(
            "56911111111", realtime.CONVERSATION_EVENT, payload=notice, message=notice["message"]
        )
        # Never part of the inbox summary: no unread, no window.
        self.mocks["touch_conversation"].assert_not_called()

    def test_resuming_the_assistant_is_announced_too(self):
        self.current["mode"] = "human"
        self.change("assistant")
        self.assertEqual(self.saved[0]["payload"]["kind"], "assistant_resumed")
        self.assertEqual(self.saved[0]["message"], "El Agente IA retomó la conversación")

    def test_no_notice_when_the_mode_does_not_change(self):
        self.change("assistant")
        self.assertEqual(self.saved, [])


if __name__ == "__main__":
    unittest.main()
