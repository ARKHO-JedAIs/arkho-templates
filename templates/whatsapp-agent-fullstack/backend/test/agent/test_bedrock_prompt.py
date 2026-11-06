"""The agent reads its instructions and model from the Bedrock Prompt Management
version the prompt manager published, with the SSM copy as the fallback.

Run from the backend root: python -m unittest discover -s test/agent -v
"""
import json
import unittest
from unittest import mock

import support  # noqa: F401 - puts src/agent/src on the path

from agent_core import config as config_module
from agent_core.config import AgentSettings, fill_variables, parse_settings, resolve_prompt, runtime_config, with_model

PARAMETER = {
    "enabled": True,
    "businessName": "Acme",
    "basePrompt": "Copia en SSM: atraso tras {{tolerancia}} minutos.",
    "parameters": {"tolerancia": "15"},
    "model": {"id": "us.anthropic.claude-sonnet-4-6", "temperature": 0.2, "maxTokens": 4096},
    "bedrockPrompt": {"id": "PROMPT1", "version": "3"},
}

BEDROCK_VERSION = {
    "defaultVariant": "default",
    "variants": [
        {
            "name": "default",
            "modelId": "us.anthropic.claude-haiku-4-5-20251001-v1:0",
            "templateConfiguration": {"chat": {"system": [{"text": "Desde Bedrock: atraso tras {{tolerancia}} min."}], "messages": []}},
            "inferenceConfiguration": {"text": {"temperature": 0.5, "maxTokens": 2048}},
        }
    ],
}


class BedrockPromptTest(unittest.TestCase):
    def setUp(self):
        config_module.clear_settings_cache()
        self.addCleanup(config_module.clear_settings_cache)
        self.client = mock.MagicMock()
        self.client.get_prompt.return_value = BEDROCK_VERSION
        patcher = mock.patch.object(config_module, "_bedrock_agent_client", return_value=self.client)
        patcher.start()
        self.addCleanup(patcher.stop)

    def resolve(self, data=PARAMETER):
        raw = json.dumps(data)
        return resolve_prompt(parse_settings(raw), raw, "us-east-1")

    def test_instructions_and_model_come_from_the_published_bedrock_version(self):
        settings = self.resolve()
        self.assertEqual(settings.base_prompt, "Desde Bedrock: atraso tras 15 min.")
        self.assertEqual(settings.model_id, "us.anthropic.claude-haiku-4-5-20251001-v1:0")
        self.assertEqual((settings.temperature, settings.max_tokens), (0.5, 2048))
        self.assertEqual(settings.prompt_source, "bedrock:PROMPT1:3")
        self.client.get_prompt.assert_called_once_with(promptIdentifier="PROMPT1", promptVersion="3")

    def test_a_version_is_read_once(self):
        self.resolve()
        self.resolve()
        self.assertEqual(self.client.get_prompt.call_count, 1)

    def test_bedrock_down_falls_back_to_the_parameter_copy(self):
        self.client.get_prompt.side_effect = RuntimeError("throttled")
        settings = self.resolve()
        self.assertEqual(settings.base_prompt, "Copia en SSM: atraso tras 15 minutos.")
        self.assertEqual(settings.model_id, "us.anthropic.claude-sonnet-4-6")
        self.assertEqual(settings.prompt_source, "parameter")

    def test_a_parameter_without_bedrock_keeps_working(self):
        data = {key: value for key, value in PARAMETER.items() if key not in ("bedrockPrompt", "model")}
        settings = self.resolve(data)
        self.assertEqual(settings.base_prompt, "Copia en SSM: atraso tras 15 minutos.")
        self.assertEqual(settings.model_id, "")
        self.client.get_prompt.assert_not_called()

    def test_with_model_overrides_only_what_was_set(self):
        config = runtime_config()
        self.assertIs(with_model(config, AgentSettings()), config)
        changed = with_model(config, AgentSettings(model_id="us.anthropic.claude-haiku-4-5-20251001-v1:0", temperature=0.7))
        self.assertEqual(changed.model_id, "us.anthropic.claude-haiku-4-5-20251001-v1:0")
        self.assertEqual(changed.temperature, 0.7)
        self.assertEqual(changed.max_tokens, config.max_tokens)

    def test_fill_variables(self):
        self.assertEqual(fill_variables("a {{x}} b {{ y }} {{z}}", {"x": "1", "y": "2"}), "a 1 b 2 {{z}}")


if __name__ == "__main__":
    unittest.main()
