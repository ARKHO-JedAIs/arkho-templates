"""Unit tests of the admin-users Lambda, with Cognito stubbed out.

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


class UsernameExists(Exception):
    pass


class UserNotFound(Exception):
    pass


def load_handler(admin_group: str):
    """Imports the function fresh with its env, boto3 stubbed by a fake Cognito."""
    for name in ("boto3", "botocore", "botocore.exceptions"):
        sys.modules.setdefault(name, types.ModuleType(name))
    sys.modules["botocore.exceptions"].ClientError = getattr(
        sys.modules["botocore.exceptions"], "ClientError", type("ClientError", (Exception,), {})
    )
    cognito = mock.MagicMock()
    cognito.exceptions.UsernameExistsException = UsernameExists
    cognito.exceptions.UserNotFoundException = UserNotFound
    cognito.admin_list_groups_for_user.return_value = {"Groups": [{"GroupName": "member"}]}
    sys.modules["boto3"].client = mock.MagicMock(return_value=cognito)
    sys.path.insert(0, str(ROOT / "src" / "layer" / "python-common" / "python"))
    with mock.patch.dict(os.environ, {"USER_POOL_ID": "pool", "ADMIN_GROUP": admin_group}):
        spec = importlib.util.spec_from_file_location(
            f"admin_users_{admin_group or 'open'}",
            ROOT / "src" / "lambda" / "users" / "admin-users" / "index.py",
        )
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
    return module, cognito


def request(method: str, resource: str, username: str = "", body: dict | None = None, groups: str = "admin"):
    return {
        "httpMethod": method,
        "resource": resource,
        "pathParameters": {"username": username} if username else None,
        "body": json.dumps(body) if body is not None else None,
        "requestContext": {"authorizer": {"username": "me@example.com", "groups": groups}},
    }


def data(response: dict):
    return json.loads(response["body"]).get("data")


class AdminUsersTest(unittest.TestCase):
    def setUp(self):
        self.module, self.cognito = load_handler("admin")

    def test_only_admins_may_call_it(self):
        response = self.module.handler(request("GET", "/admin/users", groups="member"), None)
        self.assertEqual(response["statusCode"], 403)

    def test_lists_users_with_their_roles(self):
        self.cognito.list_users.return_value = {
            "Users": [
                {
                    "Username": "ana@example.com",
                    "Attributes": [{"Name": "email", "Value": "ana@example.com"}, {"Name": "sub", "Value": "s1"}],
                    "Enabled": True,
                    "UserStatus": "CONFIRMED",
                }
            ]
        }
        users = data(self.module.handler(request("GET", "/admin/users"), None))
        self.assertEqual(users[0]["email"], "ana@example.com")
        self.assertEqual(users[0]["roles"], ["member"])

    def test_creates_a_member_by_default_and_rejects_a_duplicate(self):
        self.cognito.admin_create_user.return_value = {"User": {"Username": "new@example.com", "Attributes": []}}
        self.cognito.admin_list_groups_for_user.return_value = {"Groups": []}
        response = self.module.handler(request("POST", "/admin/users", body={"email": "New@Example.com"}), None)
        self.assertEqual(response["statusCode"], 201)
        self.cognito.admin_add_user_to_group.assert_called_once_with(
            UserPoolId="pool", Username="new@example.com", GroupName="member"
        )
        self.cognito.admin_create_user.side_effect = UsernameExists()
        response = self.module.handler(request("POST", "/admin/users", body={"email": "x@example.com"}), None)
        self.assertEqual(response["statusCode"], 409)

    def test_cannot_disable_delete_or_rerole_yourself(self):
        me = "me@example.com"
        for event in (
            request("PATCH", "/admin/users/{username}/status", me, {"enabled": False}),
            request("DELETE", "/admin/users/{username}", me),
            request("PATCH", "/admin/users/{username}", me, {"roles": ["member"]}),
        ):
            self.assertEqual(self.module.handler(event, None)["statusCode"], 409)
        self.cognito.admin_disable_user.assert_not_called()
        self.cognito.admin_delete_user.assert_not_called()

    def test_resets_the_password_to_a_temporary_one(self):
        response = self.module.handler(request("POST", "/admin/users/{username}/password", "ana"), None)
        password = data(response)["temporaryPassword"]
        self.assertGreaterEqual(len(password), 8)
        self.cognito.admin_set_user_password.assert_called_once_with(
            UserPoolId="pool", Username="ana", Password=password, Permanent=False
        )

    def test_rejects_an_unknown_role(self):
        event = request("PATCH", "/admin/users/{username}", "ana", {"roles": ["owner"]})
        self.assertEqual(self.module.handler(event, None)["statusCode"], 422)


class AuditLogTest(unittest.TestCase):
    """Each successful change logs one JSON line naming who did what to whom."""

    def setUp(self):
        self.module, self.cognito = load_handler("admin")

    def audit_lines(self, event: dict) -> tuple[dict, list[dict]]:
        with self.assertLogs(self.module.logger, level="INFO") as captured:
            response = self.module.handler(event, None)
        lines = [json.loads(record.getMessage()) for record in captured.records if '"audit"' in record.getMessage()]
        return response, lines

    def test_logs_a_create_with_the_roles(self):
        self.cognito.admin_create_user.return_value = {"User": {"Username": "new@example.com", "Attributes": []}}
        self.cognito.admin_list_groups_for_user.return_value = {"Groups": [{"GroupName": "admin"}]}
        _, lines = self.audit_lines(request("POST", "/admin/users", body={"email": "new@example.com", "roles": ["admin"]}))
        self.assertEqual(
            lines,
            [{"audit": "admin-users", "action": "create", "actor": "me@example.com", "target": "new@example.com", "roles": ["admin"]}],
        )

    def test_logs_an_update_with_the_changed_fields_and_roles(self):
        _, lines = self.audit_lines(request("PATCH", "/admin/users/{username}", "ana", {"name": "Ana", "roles": ["admin"]}))
        self.assertEqual(lines[0]["action"], "update")
        self.assertEqual(lines[0]["target"], "ana")
        self.assertEqual(lines[0]["fields"], ["name"])
        self.assertEqual(lines[0]["roles"], ["admin"])

    def test_logs_enable_disable_and_delete(self):
        cases = (
            (request("PATCH", "/admin/users/{username}/status", "ana", {"enabled": False}), "disable"),
            (request("PATCH", "/admin/users/{username}/status", "ana", {"enabled": True}), "enable"),
            (request("DELETE", "/admin/users/{username}", "ana"), "delete"),
        )
        for event, action in cases:
            _, lines = self.audit_lines(event)
            self.assertEqual(len(lines), 1)
            self.assertEqual(lines[0]["action"], action)
            self.assertEqual(lines[0]["actor"], "me@example.com")
            self.assertEqual(lines[0]["target"], "ana")

    def test_never_logs_the_temporary_password(self):
        with self.assertLogs(self.module.logger, level="INFO") as captured:
            response = self.module.handler(request("POST", "/admin/users/{username}/password", "ana"), None)
        password = data(response)["temporaryPassword"]
        output = "\n".join(captured.output)
        self.assertIn('"action": "reset_password"', output)
        self.assertNotIn(password, output)
        self.assertNotIn("temporaryPassword", output)

    def test_logs_nothing_when_the_change_is_refused(self):
        with self.assertNoLogs(self.module.logger, level="INFO"):
            response = self.module.handler(request("DELETE", "/admin/users/{username}", "me@example.com"), None)
        self.assertEqual(response["statusCode"], 409)


class SingleProfileTest(unittest.TestCase):
    def test_any_signed_in_user_when_there_is_no_admin_group(self):
        module, cognito = load_handler("")
        cognito.list_users.return_value = {"Users": []}
        response = module.handler(request("GET", "/admin/users", groups=""), None)
        self.assertEqual(response["statusCode"], 200)


if __name__ == "__main__":
    unittest.main()
