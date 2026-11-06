"""Roles and permissions: common.access, the role rules of admin-users, the
pre-token trigger, the realtime authorizer and the WhatsApp permission checks.

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
from common.whatsapp import http  # noqa: E402

import test_admin_users as users_support  # noqa: E402


def load(path: Path, name: str, env: dict | None = None):
    with mock.patch.dict(os.environ, env or {}):
        spec = importlib.util.spec_from_file_location(name, path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
    return module


def event_for(groups: str, resource: str = "/whatsapp/conversations") -> dict:
    return {"resource": resource, "requestContext": {"authorizer": {"groups": groups, "username": "me@example.com"}}}


class FakeTable:
    def __init__(self, items: dict | None = None, fail: bool = False):
        self.items = items or {}
        self.fail = fail

    def get_item(self, Key):
        if self.fail:
            raise RuntimeError("DynamoDB down")
        item = self.items.get(Key["PK"])
        return {"Item": item} if item else {}


class AccessTest(unittest.TestCase):
    def setUp(self):
        access.clear_cache()
        self.addCleanup(access.clear_cache)
        patcher = mock.patch.object(access, "_access_table", return_value=None)
        self.table = patcher.start()
        self.addCleanup(patcher.stop)

    def test_defaults_without_a_table(self):
        self.assertTrue(access.has(["admin"], "users.manage"))
        self.assertTrue(access.has(["admin"], "templates.manage"))
        self.assertFalse(access.has(["admin"], "agent.model"))
        self.assertTrue(access.has(["member"], "whatsapp.reply"))
        self.assertFalse(access.has(["member"], "agent"))
        self.assertFalse(access.has(["member"], "templates"))
        self.assertFalse(access.has(["member"], "templates.send"))
        self.assertFalse(access.has(["member"], "users.manage"))

    def test_developer_has_everything_whatever_the_table_says(self):
        self.table.return_value = FakeTable({"ROLE#developer": {"menu": [], "actions": []}})
        permissions = access.permissions_for(["developer"])
        self.assertEqual(permissions["menu"], list(access.MENUS))
        self.assertEqual(permissions["actions"], list(access.ACTIONS))

    def test_no_role_or_only_a_provider_group_is_member(self):
        self.assertEqual(access.roles_of([]), ["member"])
        self.assertEqual(access.roles_of(["us-east-1_abc_EntraID"]), ["member"])
        self.assertEqual(access.roles_of(["us-east-1_abc_EntraID", "admin"]), ["admin"])
        self.assertTrue(access.has(["us-east-1_abc_EntraID"], "whatsapp"))

    def test_the_table_overrides_the_defaults_and_unknown_ids_are_dropped(self):
        self.table.return_value = FakeTable(
            {"ROLE#member": {"menu": ["whatsapp", "templates", "bogus"], "actions": ["templates.send", "nope"]}}
        )
        permissions = access.permissions_for(["member"])
        self.assertEqual(permissions["menu"], ["whatsapp", "templates"])
        self.assertEqual(permissions["actions"], ["templates.send"])

    def test_an_unreadable_table_falls_back_to_the_defaults(self):
        self.table.return_value = FakeTable(fail=True)
        self.assertTrue(access.has(["admin"], "users.manage"))
        self.assertFalse(access.has(["member"], "users.manage"))

    def test_a_custom_role_gets_what_the_table_gives_it(self):
        self.table.return_value = FakeTable({"ROLE#supervisor": {"menu": ["whatsapp"], "actions": ["whatsapp.reply"]}})
        self.assertTrue(access.has(["supervisor"], "whatsapp"))
        self.assertFalse(access.has(["supervisor"], "users.manage"))
        self.assertFalse(access.has(["unknown-role"], "whatsapp"))

    def test_assignable_roles(self):
        self.assertEqual(access.assignable_roles(["developer"]), ["developer", "admin", "member"])
        self.assertEqual(access.assignable_roles(["admin"]), ["admin", "member"])
        self.assertEqual(access.assignable_roles(["member"]), [])

    def test_whatsapp_routes_check_the_permission_when_the_table_is_set(self):
        with mock.patch.dict(os.environ, {"ACCESS_TABLE_NAME": "access"}):
            self.assertTrue(http.is_allowed(event_for("member"), "whatsapp"))
            self.assertTrue(http.is_allowed(event_for("member"), "whatsapp.reply"))
            self.assertFalse(http.is_allowed(event_for("member"), "templates.send"))
            self.assertTrue(http.is_allowed(event_for("admin"), "templates.manage"))
            self.assertTrue(http.is_allowed(event_for("developer"), "templates.manage"))


class AdminUsersRolesTest(unittest.TestCase):
    """admin-users with the access-control table: who assigns which role."""

    def setUp(self):
        access.clear_cache()
        patcher = mock.patch.object(access, "_access_table", return_value=None)
        patcher.start()
        self.addCleanup(patcher.stop)
        env = mock.patch.dict(os.environ, {"ACCESS_TABLE_NAME": "access"})
        env.start()
        self.addCleanup(env.stop)
        self.module, self.cognito = users_support.load_handler("admin")
        self.groups_of = {"dev@x": ["developer"], "boss@x": ["admin"], "ana@x": ["member"]}
        self.cognito.admin_list_groups_for_user.side_effect = lambda UserPoolId, Username: {
            "Groups": [{"GroupName": g} for g in self.groups_of.get(Username, [])]
        }

    def call(self, method, resource, username="", body=None, groups="admin"):
        return self.module.handler(users_support.request(method, resource, username, body, groups), None)

    def test_admin_is_offered_admin_and_member_only(self):
        response = self.call("GET", "/admin/roles")
        self.assertEqual([role["id"] for role in users_support.data(response)], ["admin", "member"])
        response = self.call("GET", "/admin/roles", groups="developer")
        self.assertEqual([role["id"] for role in users_support.data(response)], ["developer", "admin", "member"])

    def test_member_cannot_manage_users(self):
        self.assertEqual(self.call("GET", "/admin/users", groups="member")["statusCode"], 403)
        self.assertEqual(self.call("GET", "/admin/roles", groups="member")["statusCode"], 403)

    def test_admin_does_not_see_developers(self):
        self.cognito.list_users.return_value = {
            "Users": [{"Username": name, "Attributes": [{"Name": "email", "Value": name}]} for name in self.groups_of]
        }
        listed = [user["username"] for user in users_support.data(self.call("GET", "/admin/users"))]
        self.assertNotIn("dev@x", listed)
        self.assertIn("ana@x", listed)
        listed = [user["username"] for user in users_support.data(self.call("GET", "/admin/users", groups="developer"))]
        self.assertIn("dev@x", listed)

    def test_admin_cannot_assign_developer(self):
        response = self.call("PATCH", "/admin/users/{username}", "ana@x", {"roles": ["developer"]})
        self.assertEqual(response["statusCode"], 403)
        self.cognito.admin_add_user_to_group.assert_not_called()

    def test_admin_cannot_touch_a_developer(self):
        for method, resource, body in (
            ("PATCH", "/admin/users/{username}", {"name": "x"}),
            ("DELETE", "/admin/users/{username}", None),
            ("PATCH", "/admin/users/{username}/status", {"enabled": False}),
            ("POST", "/admin/users/{username}/password", None),
        ):
            self.assertEqual(self.call(method, resource, "dev@x", body)["statusCode"], 403, method + resource)
        self.cognito.admin_delete_user.assert_not_called()
        self.cognito.admin_disable_user.assert_not_called()

    def test_developer_assigns_developer_and_the_user_is_signed_out(self):
        response = self.call("PATCH", "/admin/users/{username}", "ana@x", {"roles": ["developer"]}, groups="developer")
        self.assertEqual(response["statusCode"], 204)
        self.cognito.admin_add_user_to_group.assert_called_once_with(UserPoolId="pool", Username="ana@x", GroupName="developer")
        self.cognito.admin_remove_user_from_group.assert_called_once_with(UserPoolId="pool", Username="ana@x", GroupName="member")
        self.cognito.admin_user_global_sign_out.assert_called_once_with(UserPoolId="pool", Username="ana@x")

    def test_same_roles_do_not_sign_out(self):
        self.call("PATCH", "/admin/users/{username}", "ana@x", {"roles": ["member"]})
        self.cognito.admin_user_global_sign_out.assert_not_called()

    def test_admin_promotes_a_member_to_admin(self):
        response = self.call("PATCH", "/admin/users/{username}", "ana@x", {"roles": ["admin"]})
        self.assertEqual(response["statusCode"], 204)
        self.cognito.admin_add_user_to_group.assert_called_once_with(UserPoolId="pool", Username="ana@x", GroupName="admin")
        self.cognito.admin_user_global_sign_out.assert_called_once()


class PreTokenTest(unittest.TestCase):
    def setUp(self):
        self.cognito = mock.MagicMock()
        sys.modules.setdefault("boto3", types.ModuleType("boto3"))
        with mock.patch.object(sys.modules["boto3"], "client", mock.MagicMock(return_value=self.cognito), create=True):
            self.module = load(ROOT / "src" / "lambda" / "access" / "pre-token" / "index.py", "pre_token")

    def event(self, groups):
        return {
            "userPoolId": "pool",
            "userName": "EntraID_abc",
            "request": {"groupConfiguration": {"groupsToOverride": groups}},
            "response": {},
        }

    def test_a_user_without_role_gets_member_in_this_token(self):
        result = self.module.handler(self.event(["us-east-1_pool_EntraID"]), None)
        self.cognito.admin_add_user_to_group.assert_called_once_with(UserPoolId="pool", Username="EntraID_abc", GroupName="member")
        self.assertEqual(
            result["response"]["claimsOverrideDetails"]["groupOverrideDetails"]["groupsToOverride"],
            ["us-east-1_pool_EntraID", "member"],
        )

    def test_a_user_with_a_role_passes_unchanged(self):
        result = self.module.handler(self.event(["admin"]), None)
        self.cognito.admin_add_user_to_group.assert_not_called()
        self.assertEqual(result["response"], {})

    def test_a_cognito_failure_never_blocks_the_sign_in(self):
        self.cognito.admin_add_user_to_group.side_effect = RuntimeError("throttled")
        result = self.module.handler(self.event([]), None)
        self.assertEqual(result["response"]["claimsOverrideDetails"]["groupOverrideDetails"]["groupsToOverride"], ["member"])


class RealtimeAuthorizerTest(unittest.TestCase):
    def setUp(self):
        access.clear_cache()
        patcher = mock.patch.object(access, "_access_table", return_value=None)
        patcher.start()
        self.addCleanup(patcher.stop)
        jwt_module = types.ModuleType("jwt")
        jwt_module.PyJWKClient = mock.MagicMock()
        jwt_module.decode = mock.MagicMock()
        self.jwt = jwt_module
        with mock.patch.dict(sys.modules, {"jwt": jwt_module}):
            self.module = load(
                ROOT / "src" / "lambda" / "access" / "appsync-authorizer" / "index.py",
                "appsync_authorizer",
                {"USER_POOL_ID": "pool", "APP_CLIENT_ID": "client"},
            )

    def claims(self, groups, **extra):
        return {"sub": "u1", "token_use": "id", "aud": "client", "cognito:groups": groups, **extra}

    def test_a_role_with_the_inbox_is_authorized(self):
        self.jwt.decode.return_value = self.claims(["member"])
        result = self.module.handler({"authorizationToken": "Bearer t"}, None)
        self.assertTrue(result["isAuthorized"])
        self.assertEqual(result["ttlOverride"], 300)

    def test_no_role_counts_as_member(self):
        self.jwt.decode.return_value = self.claims(None)
        self.assertTrue(self.module.handler({"authorizationToken": "t"}, None)["isAuthorized"])

    def test_a_role_without_the_inbox_is_denied(self):
        self.jwt.decode.return_value = self.claims(["visitor"])
        self.assertFalse(self.module.handler({"authorizationToken": "t"}, None)["isAuthorized"])

    def test_a_bad_token_or_another_client_is_denied(self):
        self.jwt.decode.side_effect = ValueError("bad signature")
        self.assertFalse(self.module.handler({"authorizationToken": "t"}, None)["isAuthorized"])
        self.jwt.decode.side_effect = None
        self.jwt.decode.return_value = self.claims(["admin"], aud="other")
        self.assertFalse(self.module.handler({"authorizationToken": "t"}, None)["isAuthorized"])
        self.assertFalse(self.module.handler({}, None)["isAuthorized"])


class MePermissionsTest(unittest.TestCase):
    def test_returns_the_union_of_the_roles(self):
        access.clear_cache()
        with mock.patch.object(access, "_access_table", return_value=None):
            module = load(ROOT / "src" / "lambda" / "access" / "me-permissions" / "index.py", "me_permissions")
            response = module.handler(event_for("admin,member"), None)
        body = json.loads(response["body"])["data"]
        self.assertEqual(body["roles"], ["admin", "member"])
        self.assertIn("users", body["menu"])
        self.assertNotIn("agent_advanced", body["menu"])


if __name__ == "__main__":
    unittest.main()
