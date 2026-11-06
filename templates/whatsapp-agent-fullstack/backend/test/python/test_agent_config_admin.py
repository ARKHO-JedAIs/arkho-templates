"""The prompt manager API (src/lambda/agent/config-admin), with DynamoDB, SSM and
Bedrock (Prompt Management, runtime, model list) faked.

Run from the backend root: python -m unittest discover -s test/python -v
"""
import importlib.util
import json
import os
import sys
import unittest
from pathlib import Path
from unittest import mock

# Other test modules replace boto3 with a stub in sys.modules; this one needs
# the real package (its DynamoDB type serializer), loaded aside and put back
# only while this module's code runs.
_AWS = ("boto3", "botocore")
_stubs = {name: sys.modules.pop(name) for name in list(sys.modules) if name.split(".")[0] in _AWS}
from boto3.dynamodb.types import TypeDeserializer  # noqa: E402
from botocore.exceptions import ClientError  # noqa: E402

REAL_AWS = {name: module for name, module in sys.modules.items() if name.split(".")[0] in _AWS}
for _name in REAL_AWS:
    sys.modules.pop(_name, None)
sys.modules.update(_stubs)

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "src" / "layer" / "python-common" / "python"))

from common import access  # noqa: E402

LIVE = {
    "enabled": True,
    "businessName": "Acme Soporte",
    "basePrompt": "Eres el asistente de soporte de Acme. " * 3,
    "greeting": "Hola",
    "refusal": "Solo logística",
    "handoffMessage": "Te paso con una persona",
    "timezone": "America/Santiago",
}
SONNET = "us.anthropic.claude-sonnet-4-6"
HAIKU = "us.anthropic.claude-haiku-4-5-20251001-v1:0"
_deserializer = TypeDeserializer()


def plain(typed: dict) -> dict:
    return {key: _deserializer.deserialize(value) for key, value in typed.items()}


class FakeTable:
    """The few DynamoDB calls the function makes, on a dict keyed by (config_id, version)."""

    def __init__(self):
        self.items: dict[tuple, dict] = {}
        self.meta = mock.MagicMock()
        self.meta.client.transact_write_items.side_effect = self.transact

    def get_item(self, Key):
        item = self.items.get((Key["config_id"], Key["version"]))
        return {"Item": dict(item)} if item else {}

    def put_item(self, Item):
        self.items[(Item["config_id"], Item["version"])] = dict(Item)

    def delete_item(self, Key):
        self.items.pop((Key["config_id"], Key["version"]), None)

    def query(self, **kwargs):
        values = kwargs["ExpressionAttributeValues"]
        found = [i for (cid, v), i in self.items.items() if cid == values[":id"] and v.startswith(values[":v"])]
        return {"Items": sorted(found, key=lambda i: i["version"], reverse=not kwargs.get("ScanIndexForward", True))}

    def transact(self, TransactItems):
        def fail():
            raise ClientError({"Error": {"Code": "TransactionCanceledException"}, "CancellationReasons": [{"Code": "ConditionalCheckFailed"}]}, "TransactWriteItems")

        for write in TransactItems:
            kind, spec = next(iter(write.items()))
            key_source = plain(spec.get("Item") or spec.get("Key"))
            existing = self.items.get((key_source["config_id"], key_source["version"]))
            condition = spec.get("ConditionExpression", "")
            values = plain(spec.get("ExpressionAttributeValues", {}))
            if condition == "attribute_not_exists(config_id)" and existing:
                fail()
            if condition.startswith("attribute_not_exists(config_id) OR") and existing and existing["current"] != values[":current"]:
                fail()
            if condition == "revision = :revision" and (not existing or existing["revision"] != values[":revision"]):
                fail()
        for write in TransactItems:
            kind, spec = next(iter(write.items()))
            if kind == "Put":
                self.put_item(plain(spec["Item"]))
            else:
                self.delete_item(plain(spec["Key"]))


class FakeSsm:
    def __init__(self):
        self.value = json.dumps(LIVE)
        self.puts = []

    def get_parameter(self, Name):
        return {"Parameter": {"Value": self.value}}

    def put_parameter(self, **kwargs):
        self.puts.append(kwargs)
        self.value = kwargs["Value"]


class FakePrompts:
    """Bedrock Prompt Management: one prompt with a DRAFT and numbered versions."""

    def __init__(self):
        self.prompt = None
        self.draft = None
        self.versions: dict[str, dict] = {}

    def list_prompts(self, promptIdentifier=None, nextToken=None):
        if promptIdentifier:
            return {"promptSummaries": [{"version": "DRAFT"}] + [{"version": v, "createdAt": "2026-11-06T17:00:00+00:00", "description": d["description"]} for v, d in self.versions.items()]}
        return {"promptSummaries": [self.prompt] if self.prompt else []}

    def create_prompt(self, name, variants, defaultVariant, description=""):
        self.prompt = {"id": "PROMPT1", "arn": "arn:aws:bedrock:us-east-1:1:prompt/PROMPT1", "name": name}
        self.draft = {"variants": variants, "defaultVariant": defaultVariant}
        return self.prompt

    def update_prompt(self, promptIdentifier, name, variants, defaultVariant, description=""):
        self.draft = {"variants": variants, "defaultVariant": defaultVariant}

    def create_prompt_version(self, promptIdentifier, description=""):
        version = str(len(self.versions) + 1)
        self.versions[version] = {**self.draft, "description": description}
        return {"version": version}

    def get_prompt(self, promptIdentifier, promptVersion=None):
        return self.versions[promptVersion] if promptVersion else self.draft


class AgentConfigAdminTest(unittest.TestCase):
    def setUp(self):
        access.clear_cache()
        patcher = mock.patch.object(access, "_access_table", return_value=None)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.table, self.ssm, self.prompts = FakeTable(), FakeSsm(), FakePrompts()
        env = {
            "AGENT_CONFIG_TABLE": "agent-config",
            "AGENT_PROMPT_PARAMETER_NAME": "agent-prompt",
            "AGENT_BEDROCK_PROMPT_NAME": "acme-dev-agent",
            "DEFAULT_MODEL_ID": SONNET,
            "ACCESS_TABLE_NAME": "access",
        }
        aws = mock.patch.dict(sys.modules, REAL_AWS)
        aws.start()
        self.addCleanup(aws.stop)
        with mock.patch.dict(os.environ, env), mock.patch("boto3.resource"), mock.patch("boto3.client"):
            spec = importlib.util.spec_from_file_location("config_admin", ROOT / "src" / "lambda" / "agent" / "config-admin" / "index.py")
            self.module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(self.module)
        self.module.table = lambda: self.table
        self.module.dynamodb_client = self.table.meta.client
        self.module.ssm = self.ssm
        self.module.bedrock_agent = self.prompts
        self.module.bedrock_runtime = mock.MagicMock()
        self.module.bedrock = mock.MagicMock()
        self.module.TABLE_NAME = "agent-config"
        self.env = mock.patch.dict(os.environ, env)
        self.env.start()
        self.addCleanup(self.env.stop)

    def call(self, method, resource, body=None, groups="developer", version=None):
        event = {
            "httpMethod": method,
            "resource": resource,
            "pathParameters": {"version": version} if version else None,
            "body": json.dumps(body) if body is not None else None,
            "requestContext": {"authorizer": {"groups": groups, "email": "ana@acme.com"}},
        }
        response = self.module.handler(event, None)
        return response["statusCode"], json.loads(response["body"]).get("data") if response.get("body") else None

    def config(self, **changes):
        base = {
            "enabled": True,
            "businessName": "Acme Soporte",
            "instructions": "Responde con todos los datos del pedido, en bloques cortos. " * 2,
            "greeting": "Hola",
            "refusal": "Solo logística",
            "handoffMessage": "Te paso con una persona",
        }
        return {**base, **changes}

    def publish(self, **changes):
        _, draft = self.call("PUT", "/admin/agent/config/draft", {"config": self.config(**changes)})
        return self.call("POST", "/admin/agent/config/publish", {"comment": "cambio", "revision": draft["revision"]})

    def test_before_any_publish_the_deployed_parameter_is_v0000(self):
        status, data = self.call("GET", "/admin/agent/config")
        self.assertEqual(status, 200)
        self.assertEqual(data["published"]["version"], "v0000")
        self.assertEqual(data["published"]["config"]["instructions"], LIVE["basePrompt"])
        self.assertEqual(data["published"]["config"]["model"]["id"], SONNET)
        self.assertIsNone(data["draft"])
        self.assertTrue(data["liveMatches"])

    def test_a_draft_creates_and_updates_the_bedrock_prompt_without_reaching_the_agent(self):
        status, _ = self.call("PUT", "/admin/agent/config/draft", {"config": self.config()})
        self.assertEqual(status, 200)
        self.assertEqual(self.prompts.prompt["name"], "acme-dev-agent")
        variant = self.prompts.draft["variants"][0]
        self.assertEqual(variant["templateType"], "CHAT")
        self.assertEqual(variant["modelId"], SONNET)
        self.assertEqual(variant["templateConfiguration"]["chat"]["system"][0]["text"], self.config()["instructions"].strip())
        self.assertEqual(self.ssm.puts, [], "a draft never reaches the agent")

    def test_publish_creates_a_bedrock_version_and_points_the_agent_to_it(self):
        status, version = self.publish()
        self.assertEqual(status, 200)
        self.assertEqual((version["version"], version["bedrockVersion"]), ("v0001", "1"))
        self.assertEqual(version["publishedBy"], "ana@acme.com")
        live = json.loads(self.ssm.value)
        self.assertEqual(live["bedrockPrompt"], {"id": "PROMPT1", "version": "1"})
        self.assertEqual(live["basePrompt"], self.config()["instructions"].strip(), "copy kept as the fallback")
        self.assertEqual(live["model"]["id"], SONNET)
        self.assertEqual(live["timezone"], "America/Santiago")
        _, data = self.call("GET", "/admin/agent/config")
        self.assertEqual(data["published"]["version"], "v0001")
        self.assertIsNone(data["draft"])
        self.assertTrue(data["liveMatches"])
        self.assertIsNone(data["consoleDraft"])

    def test_variables_need_values_and_reach_bedrock_and_the_agent(self):
        text = "Un pedido está atrasado si pasaron más de {{tolerancia_atraso}} minutos de su hora comprometida. " * 2
        status, _ = self.call("PUT", "/admin/agent/config/draft", {"config": self.config(instructions=text)})
        self.assertEqual(status, 422)
        status, _ = self.publish(instructions=text, parameters={"tolerancia_atraso": "15"})
        self.assertEqual(status, 200)
        names = [v["name"] for v in self.prompts.versions["1"]["variants"][0]["templateConfiguration"]["chat"]["inputVariables"]]
        self.assertEqual(names, ["tolerancia_atraso", "pregunta"])
        self.assertEqual(json.loads(self.ssm.value)["parameters"], {"tolerancia_atraso": "15"})

    def test_changing_the_model_needs_agent_model_and_checks_access(self):
        with mock.patch.object(access, "has", side_effect=lambda groups, p: p in ("agent.edit", "agent.publish")):
            status, _ = self.call("PUT", "/admin/agent/config/draft", {"config": self.config(model={"id": HAIKU})})
            self.assertEqual(status, 403)
        status, version = self.publish(model={"id": HAIKU, "temperature": 0.5, "maxTokens": 2048})
        self.assertEqual(status, 200)
        self.module.bedrock_runtime.converse.assert_called_once()
        self.assertEqual(self.prompts.versions["1"]["variants"][0]["modelId"], HAIKU)
        self.module.bedrock_runtime.converse.side_effect = ClientError({"Error": {"Code": "AccessDeniedException"}}, "Converse")
        status, _ = self.publish(model={"id": SONNET})
        self.assertEqual(status, 422)

    def test_a_stale_draft_revision_is_a_conflict(self):
        _, draft = self.call("PUT", "/admin/agent/config/draft", {"config": self.config()})
        self.call("PUT", "/admin/agent/config/draft", {"config": self.config(greeting="Buenas"), "revision": draft["revision"]})
        status, _ = self.call("PUT", "/admin/agent/config/draft", {"config": self.config(greeting="Hola!"), "revision": draft["revision"]})
        self.assertEqual(status, 409)
        status, _ = self.call("POST", "/admin/agent/config/publish", {"revision": draft["revision"]})
        self.assertEqual(status, 409)

    def test_rollback_reuses_the_old_bedrock_version(self):
        self.publish(greeting="Uno")
        self.publish(greeting="Dos")
        status, version = self.call("POST", "/admin/agent/config/rollback", {"version": "v0001"})
        self.assertEqual(status, 200)
        self.assertEqual((version["version"], version["bedrockVersion"], version["rollbackOf"]), ("v0003", "1", "v0001"))
        self.assertEqual(len(self.prompts.versions), 2, "no new Bedrock version: the old one is reused")
        self.assertEqual(json.loads(self.ssm.value)["greeting"], "Uno")
        _, history = self.call("GET", "/admin/agent/config/versions")
        self.assertEqual([item["version"] for item in history["versions"]], ["v0003", "v0002", "v0001"])
        _, one = self.call("GET", "/admin/agent/config/versions/{version}", version="v0002")
        self.assertEqual(one["config"]["greeting"], "Dos")

    def test_console_edits_are_shown_and_console_versions_can_be_adopted(self):
        self.publish()
        console_text = "Editado en la consola de AWS con más detalle de los pedidos. " * 2
        variant = self.module.variant_of({**self.module.complete(self.config()), "instructions": console_text})
        self.prompts.update_prompt("PROMPT1", "acme-dev-agent", [variant], "default")
        _, data = self.call("GET", "/admin/agent/config")
        self.assertEqual(data["consoleDraft"]["instructions"], console_text)
        self.prompts.create_prompt_version("PROMPT1", description="desde la consola")
        _, history = self.call("GET", "/admin/agent/config/versions")
        self.assertEqual([item["bedrockVersion"] for item in history["consoleVersions"]], ["2"])
        status, version = self.call("POST", "/admin/agent/config/adopt", {"bedrockVersion": "2"})
        self.assertEqual(status, 200)
        self.assertEqual((version["version"], version["bedrockVersion"], version["source"]), ("v0002", "2", "console"))
        self.assertEqual(json.loads(self.ssm.value)["basePrompt"], console_text.strip())
        _, history = self.call("GET", "/admin/agent/config/versions")
        self.assertEqual(history["consoleVersions"], [])

    def test_validation(self):
        for bad in (
            self.config(instructions="corto"),
            self.config(enabled="si"),
            {**self.config(), "tools": []},
            self.config(instructions="á" * 6999),
            self.config(model={"id": "meta.llama3"}),
            self.config(model={"id": SONNET, "temperature": 3}),
        ):
            status, _ = self.call("PUT", "/admin/agent/config/draft", {"config": bad})
            self.assertEqual(status, 422, str(bad)[:80])

    def test_permissions(self):
        for groups in ("member", "admin"):
            status, _ = self.call("GET", "/admin/agent/config", groups=groups)
            self.assertEqual(status, 403, groups)
        # A role that may edit but not publish cannot switch the agent off through a draft.
        with mock.patch.object(access, "has", side_effect=lambda groups, p: p == "agent.edit"):
            status, _ = self.call("PUT", "/admin/agent/config/draft", {"config": self.config(enabled=False)})
            self.assertEqual(status, 403)
            status, _ = self.call("PUT", "/admin/agent/config/draft", {"config": self.config()})
            self.assertEqual(status, 200)
            status, _ = self.call("POST", "/admin/agent/config/publish", {})
            self.assertEqual(status, 403)

    def test_a_change_outside_the_web_is_reported(self):
        self.publish()
        self.ssm.value = json.dumps({**json.loads(self.ssm.value), "greeting": "otro despliegue"})
        _, data = self.call("GET", "/admin/agent/config")
        self.assertFalse(data["liveMatches"])

    def test_models_lists_active_claude_profiles(self):
        self.module.bedrock.list_inference_profiles.return_value = {
            "inferenceProfileSummaries": [
                {"inferenceProfileId": SONNET, "inferenceProfileName": "Sonnet 4.6", "status": "ACTIVE"},
                {"inferenceProfileId": "us.meta.llama3", "inferenceProfileName": "Llama", "status": "ACTIVE"},
                {"inferenceProfileId": HAIKU, "inferenceProfileName": "Haiku 4.5", "status": "ACTIVE"},
            ]
        }
        _, models = self.call("GET", "/admin/agent/models")
        self.assertEqual([model["id"] for model in models], [HAIKU, SONNET])


if __name__ == "__main__":
    unittest.main()
