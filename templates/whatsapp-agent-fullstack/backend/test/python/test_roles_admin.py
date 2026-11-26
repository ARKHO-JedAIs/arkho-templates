"""roles-admin (create roles, edit their permissions) and the roles it creates.

Run from the backend root: python -m unittest discover -s test/python -v
"""
import importlib.util
import json
import os
import sys
import types
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "src" / "layer" / "python-common" / "python"))

from common import access  # noqa: E402

import test_admin_users as users_support  # noqa: E402


class GroupExists(Exception):
    pass


class NotFound(Exception):
    pass


class FakeTable:
    """The access-control table: put, get, update, delete and a scan."""

    def __init__(self):
        self.items = {}

    def put_item(self, Item):
        self.items[(Item["PK"], Item["SK"])] = dict(Item)

    def get_item(self, Key):
        item = self.items.get((Key["PK"], Key["SK"]))
        return {"Item": dict(item)} if item else {}

    def delete_item(self, Key):
        self.items.pop((Key["PK"], Key["SK"]), None)

    def update_item(self, Key, UpdateExpression, ExpressionAttributeValues, ExpressionAttributeNames=None):
        item = self.items[(Key["PK"], Key["SK"])]
        names = ExpressionAttributeNames or {}
        for part in UpdateExpression.removeprefix("SET ").split(", "):
            target, value = part.split(" = ")
            item[names.get(target, target)] = ExpressionAttributeValues[value]

    def scan(self, **kwargs):
        wanted = kwargs["ExpressionAttributeValues"][":meta"]
        return {"Items": [dict(item) for (_, sk), item in self.items.items() if sk == wanted]}


def load_roles_admin():
    for name in ("boto3", "botocore", "botocore.exceptions"):
        sys.modules.setdefault(name, types.ModuleType(name))
    sys.modules["botocore.exceptions"].ClientError = getattr(
        sys.modules["botocore.exceptions"], "ClientError", type("ClientError", (Exception,), {})
    )
    cognito = mock.MagicMock()
    cognito.exceptions.GroupExistsException = GroupExists
    cognito.exceptions.ResourceNotFoundException = NotFound
    cognito.list_users_in_group.return_value = {"Users": []}
    table = FakeTable()
    resource = mock.MagicMock()
    resource.Table.return_value = table
    with (
        mock.patch.object(sys.modules["boto3"], "client", mock.MagicMock(return_value=cognito), create=True),
        mock.patch.object(sys.modules["boto3"], "resource", mock.MagicMock(return_value=resource), create=True),
        mock.patch.dict(os.environ, {"USER_POOL_ID": "pool", "ACCESS_TABLE_NAME": "access"}),
    ):
        spec = importlib.util.spec_from_file_location(
            "roles_admin", ROOT / "src" / "lambda" / "access" / "roles-admin" / "index.py"
        )
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
    return module, cognito, table


def call(module, method, resource, role="", body=None, groups="admin"):
    event = {
        "httpMethod": method,
        "resource": resource,
        "pathParameters": {"role": role} if role else None,
        "body": json.dumps(body) if body is not None else None,
        "requestContext": {"authorizer": {"username": "boss@example.com", "groups": groups}},
    }
    response = module.handler(event, None)
    parsed = json.loads(response["body"]) if response.get("body") else {}
    return response["statusCode"], parsed.get("data"), parsed


class RolesAdminTest(unittest.TestCase):
    def setUp(self):
        access.clear_cache()
        self.addCleanup(access.clear_cache)
        self.module, self.cognito, self.table = load_roles_admin()
        for target in (access, self.module.access):
            patcher = mock.patch.object(target, "_access_table", return_value=self.table)
            patcher.start()
            self.addCleanup(patcher.stop)

    def test_only_who_manages_access_gets_in(self):
        status, _, _ = call(self.module, "GET", "/admin/access", groups="member")
        self.assertEqual(status, 403)

    def test_lists_the_roles_and_the_catalogs_without_the_developer_for_an_admin(self):
        status, data, _ = call(self.module, "GET", "/admin/access")
        self.assertEqual(status, 200)
        self.assertEqual([role["id"] for role in data["roles"]], ["admin", "member"])
        self.assertIn("templates", [item["id"] for item in data["menu"]])
        self.assertIn("templates.manage", [item["id"] for item in data["actions"]])

    def test_a_developer_sees_the_developer_role_locked(self):
        _, data, _ = call(self.module, "GET", "/admin/access", groups="developer")
        developer = next(role for role in data["roles"] if role["id"] == "developer")
        self.assertTrue(developer["locked"])
        self.assertEqual(developer["permissions"]["menu"], [page for page in access.MENUS if page != "voice"])

    def test_the_voice_page_is_offered_only_where_voice_was_deployed(self):
        _, data, _ = call(self.module, "GET", "/admin/access")
        self.assertNotIn("voice", [item["id"] for item in data["menu"]])
        status, _, _ = call(
            self.module, "POST", "/admin/access/roles", body={"id": "vox", "name": "Vox", "menu": ["voice"]}, groups="developer"
        )
        self.assertEqual(status, 422)
        with mock.patch.object(self.module, "VOICE_ENABLED", True):
            _, data, _ = call(self.module, "GET", "/admin/access")
            self.assertIn("voice", [item["id"] for item in data["menu"]])
            status, _, _ = call(
                self.module, "POST", "/admin/access/roles", body={"id": "vox", "name": "Vox", "menu": ["voice"]}, groups="developer"
            )
            self.assertEqual(status, 201)

    def test_creates_a_role_as_a_group_with_its_permissions(self):
        status, data, _ = call(
            self.module,
            "POST",
            "/admin/access/roles",
            body={"id": "supervisor", "name": "Supervisor", "menu": ["whatsapp"], "actions": ["whatsapp.reply"]},
        )
        self.assertEqual(status, 201)
        self.assertEqual(data["permissions"], {"menu": ["whatsapp"], "actions": ["whatsapp.reply"]})
        self.cognito.create_group.assert_called_once()
        self.assertEqual(self.cognito.create_group.call_args.kwargs["GroupName"], "supervisor")
        self.assertTrue(access.has(["supervisor"], "whatsapp"))
        self.assertIn("supervisor", access.all_roles())
        self.assertEqual(access.role_label("supervisor")[0], "Supervisor")

    def test_rejects_bad_ids_and_duplicates(self):
        for bad in ("A", "has_underscore", "9lives", "x" * 40, "admin", "developer"):
            status, _, _ = call(self.module, "POST", "/admin/access/roles", body={"id": bad, "name": "X"})
            self.assertIn(status, (409, 422), bad)
        self.cognito.create_group.assert_not_called()

    def test_cannot_grant_what_the_editor_does_not_hold(self):
        status, _, parsed = call(
            self.module, "POST", "/admin/access/roles", body={"id": "wide", "name": "Wide", "menu": ["agent"]}
        )
        self.assertEqual(status, 403)
        self.assertEqual(parsed["error"]["code"] if "error" in parsed else parsed.get("code"), "PERMISSION_NOT_HELD")
        status, _, _ = call(
            self.module, "POST", "/admin/access/roles", body={"id": "wide", "name": "Wide", "menu": ["agent"]}, groups="developer"
        )
        self.assertEqual(status, 201)

    def test_updates_the_permissions_of_a_system_role_and_keeps_its_name(self):
        status, data, _ = call(
            self.module,
            "PUT",
            "/admin/access/roles/{role}",
            role="member",
            body={"menu": ["whatsapp", "templates"], "actions": ["whatsapp.reply", "templates.send"], "name": "Hacked"},
        )
        self.assertEqual(status, 200)
        self.assertEqual(data["permissions"]["menu"], ["whatsapp", "templates"])
        self.assertEqual(data["name"], access.ROLE_LABELS["member"][0])
        stored = self.table.items[("ROLE#member", "PERMS")]
        self.assertEqual(stored["updatedBy"], "boss@example.com")

    def test_an_edit_is_visible_to_the_permission_checks(self):
        call(self.module, "PUT", "/admin/access/roles/{role}", role="member", body={"menu": ["whatsapp", "templates"]})
        self.assertTrue(access.has(["member"], "templates"))

    def test_the_developer_role_is_never_edited(self):
        status, _, _ = call(
            self.module, "PUT", "/admin/access/roles/{role}", role="developer", body={"menu": []}, groups="developer"
        )
        self.assertEqual(status, 409)

    def test_nobody_removes_the_roles_screen_from_their_own_role(self):
        status, _, _ = call(
            self.module, "PUT", "/admin/access/roles/{role}", role="admin", body={"menu": ["whatsapp", "templates"]}
        )
        self.assertEqual(status, 409)

    def test_unknown_ids_are_refused(self):
        status, _, _ = call(self.module, "PUT", "/admin/access/roles/{role}", role="member", body={"menu": ["bogus"]})
        self.assertEqual(status, 422)

    def test_deletes_only_a_custom_role_nobody_holds(self):
        call(self.module, "POST", "/admin/access/roles", body={"id": "temp", "name": "Temp"})
        self.cognito.list_users_in_group.return_value = {"Users": [{"Username": "ana"}]}
        status, _, _ = call(self.module, "DELETE", "/admin/access/roles/{role}", role="temp")
        self.assertEqual(status, 409)
        self.cognito.list_users_in_group.return_value = {"Users": []}
        status, _, _ = call(self.module, "DELETE", "/admin/access/roles/{role}", role="temp")
        self.assertEqual(status, 204)
        self.cognito.delete_group.assert_called_once()
        self.assertNotIn("temp", access.all_roles())
        self.assertNotIn(("ROLE#temp", "PERMS"), self.table.items)

    def test_system_roles_are_not_deleted(self):
        status, _, _ = call(self.module, "DELETE", "/admin/access/roles/{role}", role="member")
        self.assertEqual(status, 409)


class CustomRolesInUsersTest(unittest.TestCase):
    """admin-users offers and assigns the roles made from the web."""

    def setUp(self):
        access.clear_cache()
        self.addCleanup(access.clear_cache)
        table = FakeTable()
        table.put_item({"PK": "ROLE#supervisor", "SK": "META", "name": "Supervisor", "description": "Ve la bandeja", "system": False})
        patcher = mock.patch.object(access, "_access_table", return_value=table)
        patcher.start()
        self.addCleanup(patcher.stop)
        env = mock.patch.dict(os.environ, {"ACCESS_TABLE_NAME": "access"})
        env.start()
        self.addCleanup(env.stop)
        self.module, self.cognito = users_support.load_handler("admin")
        self.cognito.admin_list_groups_for_user.side_effect = lambda UserPoolId, Username: {
            "Groups": [{"GroupName": "supervisor"}]
        }

    def call(self, method, resource, username="", body=None, groups="admin"):
        return self.module.handler(users_support.request(method, resource, username, body, groups), None)

    def test_the_roles_list_includes_the_custom_role_with_its_name(self):
        response = self.call("GET", "/admin/roles")
        roles = {role["id"]: role for role in users_support.data(response)}
        self.assertEqual(roles["supervisor"]["name"], "Supervisor")
        self.assertEqual(roles["supervisor"]["description"], "Ve la bandeja")

    def test_a_user_with_the_custom_group_shows_that_role(self):
        self.cognito.list_users.return_value = {
            "Users": [{"Username": "ana@x", "Attributes": [{"Name": "email", "Value": "ana@x"}], "Enabled": True}]
        }
        users = users_support.data(self.call("GET", "/admin/users"))
        self.assertEqual(users[0]["roles"], ["supervisor"])

    def test_assigns_the_custom_role_through_its_group(self):
        self.cognito.admin_list_groups_for_user.side_effect = lambda UserPoolId, Username: {"Groups": [{"GroupName": "member"}]}
        response = self.call("PATCH", "/admin/users/{username}", "ana@x", {"roles": ["supervisor"]})
        self.assertEqual(response["statusCode"], 204)
        self.cognito.admin_add_user_to_group.assert_called_with(UserPoolId="pool", Username="ana@x", GroupName="supervisor")


if __name__ == "__main__":
    unittest.main()
