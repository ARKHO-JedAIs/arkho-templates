# Agent tests

Unit tests of the WhatsApp AI agent in `backend/src/agent`. They never call AWS
or Bedrock: `support.FakeModel` scripts the model's answers (text or tool
calls) so the real Strands event loop, hooks and tools run offline, and the
DynamoDB / AppSync / SSM / AgentCore Memory clients are mocked.

They need the agent's dependencies, so run them in their own virtual
environment (the WhatsApp Lambda tests under `test/python` stay independent of
these packages):

```bash
cd backend
python -m venv .venv
. .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r src/agent/requirements.txt
python -m unittest discover -s test/agent
```

`test_prefilter.py` holds the attack and legitimate-message lists: add the new
cases there whenever `agent/src/agent_core/safety/rules.py` changes.
