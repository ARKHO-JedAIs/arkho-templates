"""Unit tests of the Lambda authorizer's group extraction, with JWT verification
stubbed out (it is only the `cognito:groups` -> policy context wiring under test).

Run from the backend root: python -m unittest discover -s test/python -v
"""
import importlib.util
import os
import sys
import types
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[2]


def load_module():
    """Imports the authorizer fresh, with the jwt package stubbed (it ships via
    a Lambda layer, not this repo) and verify_token replaced per test."""
    sys.modules.setdefault("jwt", types.ModuleType("jwt"))
    sys.modules["jwt"].PyJWKClient = mock.MagicMock()
    with mock.patch.dict(
        os.environ, {"USER_POOL_ID": "pool", "APP_CLIENT_ID": "client", "AWS_REGION": "us-east-1"}
    ):
        spec = importlib.util.spec_from_file_location(
            "authorizer_index", ROOT / "src" / "lambda" / "core" / "authorizer" / "index.py"
        )
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
    return module


def event():
    return {
        "authorizationToken": "Bearer token",
        "methodArn": "arn:aws:execute-api:us-east-1:111122223333:abc123/dev/GET/admin/users",
    }


class AuthorizerGroupsTests(unittest.TestCase):
    """Regression for a bug where group membership never reached downstream
    Lambdas: the ID token branch hard-coded `groups = []` instead of reading
    the `cognito:groups` claim Cognito actually puts there (access tokens
    don't carry it), so every admin/role check failed for every real user."""

    def test_id_token_groups_reach_the_policy_context(self):
        module = load_module()
        module.verify_token = mock.MagicMock(
            return_value={
                "sub": "user-1",
                "token_use": "id",
                "cognito:username": "jordonezp",
                "email": "jordonezp@arkho.io",
                "cognito:groups": ["admin"],
            }
        )
        policy = module.lambda_handler(event(), None)
        self.assertEqual(policy["context"]["groups"], "admin")

    def test_id_token_with_no_groups_is_empty_not_an_error(self):
        module = load_module()
        module.verify_token = mock.MagicMock(
            return_value={
                "sub": "user-2",
                "token_use": "id",
                "cognito:username": "member",
                "email": "member@example.com",
                "cognito:groups": [],
            }
        )
        policy = module.lambda_handler(event(), None)
        self.assertEqual(policy["context"]["groups"], "")

    def test_access_token_groups_still_reach_the_policy_context(self):
        module = load_module()
        module.verify_token = mock.MagicMock(
            return_value={
                "sub": "user-3",
                "token_use": "access",
                "username": "svc",
                "cognito:groups": ["admin", "member"],
            }
        )
        policy = module.lambda_handler(event(), None)
        self.assertEqual(policy["context"]["groups"], "admin,member")


if __name__ == "__main__":
    unittest.main()
