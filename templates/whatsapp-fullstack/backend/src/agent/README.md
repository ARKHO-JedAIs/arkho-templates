# WhatsApp AI agent

A generic customer-service agent (Strands Agents on Amazon Bedrock) that
answers the WhatsApp contacts while a conversation is in `assistant` mode, and
hands it to a person when needed. One container image runs on **Bedrock
AgentCore Runtime** (default) or on **AWS Lambda** (same image, different
command). The business it serves is described by an admin-editable prompt; the
safety rules live in code.

## Architecture

```
backend/src/agent/
  Dockerfile              # linux/arm64, python 3.12-slim, non-root, ADOT
  requirements.txt        # only what the code imports, pinned
  src/
    agentcore_main.py     # BedrockAgentCoreApp @app.entrypoint (port 8080)
    lambda_handler.py     # handler(event, context) for the Lambda variant
    agent_core/
      turn.py             # one turn: contract, pre-filter, agent, output check, log line
      config.py           # env vars + admin settings (SSM, cached 60 s)
      prompt.py           # system prompt wrapper, fixed rules, untrusted-text tags
      agent.py            # BedrockModel (prompt caching), hooks, build_agent
      memory.py           # AgentCore Memory session manager + fixes
      whatsapp_store.py   # minimal copy of the layer's store/realtime helpers
      tools/              # request_human_handoff, get_current_datetime, call_business_api
      safety/             # prefilter, rules (data), normalize, output_check
```

Flow of a turn (`agent_core/turn.py`):

1. Parse the payload; load the admin settings (SSM, 60 s cache).
2. Agent disabled -> `blocked` / `agent_disabled` with an empty response.
3. Pre-filter (no model call): greeting fast path, blocked categories,
   self-harm support + handoff.
4. Build the system prompt, the per-request tools, the memory session manager
   and the agent; the user text goes inside `<user_message>` tags.
5. Run the agent; the output check replaces a leaking answer (also before it
   reaches the memory).
6. Build the contract response and log one structured line.

## Invocation contract

Payload (both entrypoints):

```json
{"prompt": "...", "actor_id": "wa-3f2a...", "session_id": "...", "channel": "whatsapp", "user_name": "Ana",
 "phone": "56911112222"}
```

- `channel`: `whatsapp` (default) or `web`.
- `actor_id` / `session_id` identify the memory only (the worker sends
  `wa-<sha256(phone)[:32]>`); `actor_id` is never read as a phone.
- `phone` (WhatsApp): the contact's digits, the key of the conversations
  table. The handoff tool and the self-harm handoff are bound to it; when it
  is missing or invalid the handoff tool is not offered (a warning is logged).
- `"stream": true` (AgentCore only) streams the answer, see below.

Response:

```json
{"status": "ok", "response": "...", "handoff": false, "blocked_category": null,
 "usage": {"inputTokens": 1234, "outputTokens": 56}}
```

| status | when | response |
|---|---|---|
| `ok` | normal answer, greeting, handoff, self-harm support | text to send |
| `blocked` | pre-filter or output check stopped it | refusal (or `""` for `agent_disabled`) |
| `error` | anything failed | generic Spanish message (details only in the logs) |

- `handoff: true` - the conversation must be answered by a person. On WhatsApp
  the agent already set `mode = human` in the conversations table, stored the
  `agent_handoff` notice and published the realtime events; the caller only
  sends `response`.
- `blocked_category`: `prompt_injection`, `sexual`, `sexual_minors`,
  `harassment_hate`, `violence_threats`, `output_leak`, `empty_input`,
  `input_too_long`, `agent_disabled`; and `self_harm` together with
  `status: ok` and `handoff: true` (support, not a refusal).
- An empty `response` means "send nothing".

### Streaming (AgentCore, for the web chat)

With `"stream": true` the runtime answers with Server-Sent Events:
`{"event": "chunk", "data": "..."}` while the answer is generated, then one
`{"event": "done", "response": <contract response>}` or
`{"event": "error", "response": <contract response>}`. The last ~200
characters are held back until they pass the output check. The `done`
response is authoritative: when it is `blocked` or a handoff, the client
replaces the text it already showed with `response.response`.

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `MODEL_ID` | `us.anthropic.claude-sonnet-4-6` | Bedrock model or inference profile |
| `MODEL_MAX_TOKENS` | `1000` | answer cap |
| `MODEL_TEMPERATURE` | `0.2` | |
| `AWS_REGION` | `us-east-1` | Bedrock, SSM, DynamoDB, Memory, AppSync region |
| `AGENT_PROMPT_PARAMETER_NAME` | empty (defaults) | SSM String parameter with the admin settings |
| `AGENT_MEMORY_ID` | empty (no memory) | AgentCore Memory id |
| `AGENT_MEMORY_MODE` | `conversation` when an id is set | `off`, `conversation`, `facts`, `facts_summaries` |
| `AGENT_MEMORY_FACTS_NAMESPACE` | `/facts/{actorId}` | long-term facts namespace (facts modes) |
| `AGENT_MEMORY_PREFERENCES_NAMESPACE` | `/preferences/{actorId}` | user preferences namespace (facts modes) |
| `AGENT_MEMORY_SUMMARIES_NAMESPACE` | `/summaries/{actorId}/{sessionId}` | summaries namespace (`facts_summaries`) |
| `WHATSAPP_CONVERSATIONS_TABLE_NAME` | empty | enables the handoff tool |
| `WHATSAPP_MESSAGES_TABLE_NAME` | empty | where the handoff notice is stored |
| `APPSYNC_GRAPHQL_URL` | empty | realtime events of the handoff |
| `WHATSAPP_ADMIN_GROUP` | empty | written as `payload.group` of the handoff notice |
| `AGENT_BUSINESS_API_URL` | empty | enables `call_business_api` |
| `AGENT_MAX_TOOL_ITERATIONS` | `6` | tool calls per turn before they are cancelled |

The namespaces must match the strategies of the Memory resource (placeholders
`{actorId}`, `{sessionId}`, `{memoryStrategyId}` are resolved by AgentCore).

Admin settings (SSM String parameter, JSON; every key optional, missing or
invalid keys keep a safe generic default):

```json
{"enabled": true, "basePrompt": "...", "businessName": "...", "greeting": "...",
 "refusal": "...", "handoffMessage": "...", "supportMessage": "...", "timezone": "America/Santiago"}
```

Permissions the runtime role needs: `bedrock:InvokeModel` /
`bedrock:InvokeModelWithResponseStream` on the model and inference profile,
`ssm:GetParameter` on the parameter, `bedrock-agentcore:CreateEvent`,
`ListEvents`, `GetEvent`, `RetrieveMemoryRecords` (and the session/agent state
calls of the session manager) on the memory, `dynamodb:UpdateItem` on the
conversations table, `dynamodb:PutItem` on the messages table and
`appsync:GraphQL` on the events API.

## Safety layers (no Bedrock Guardrail)

1. **Pre-filter** (`safety/prefilter.py`, rules in `safety/rules.py`): runs
   before the model, so a blocked message costs no tokens and never enters the
   memory. The text is normalized (NFKC, lowercase, no accents, no
   zero-width/control characters, leetspeak `0->o 1->i 3->e 4->a 5->s 7->t
   @->a $->s`, repeated letters collapsed, spaced letters glued) and matched
   with word-boundary regular expressions; long `compact` signatures catch
   "i g n o r a  l a s  i n s t r u c c i o n e s". Messages over 2000
   characters are rejected. Greetings and "what can you do" are answered with
   the configured greeting without calling the model.
2. **Fixed prompt rules** (`prompt.fixed_rules`): scope, untrusted content,
   confidentiality, identity, safety, honesty, handoff, privacy, output. They
   come after the admin `basePrompt` and declare that they win; the admin text
   cannot open or close the prompt's sections (its tags are stripped).
3. **Untrusted content delimiting**: the user's text travels inside
   `<user_message>` and tool/RAG output inside `<tool_output>` (use
   `prompt.wrap_untrusted`); the rules say their content is data.
4. **Output check** (`safety/output_check.py`): a random per-process canary in
   the system prompt, 10-word runs copied from the fixed rules, and
   secret-like patterns (AWS keys, private keys, JWTs, tokens) turn the answer
   into the refusal with `blocked_category: output_leak`. The hook rewrites
   the message before it is stored in the memory.
5. **Repeat offenders**: the agent is stateless across containers, so it only
   reports `blocked_category`; the caller keeps the per-actor counter. Count
   the categories in `safety.rules.OFFENSE_CATEGORIES` (`is_offense()`):
   `prompt_injection`, `sexual`, `sexual_minors`, `harassment_hate`,
   `violence_threats`, `output_leak`. `self_harm`, `empty_input`,
   `input_too_long` and `agent_disabled` are not offenses.

Every turn logs one JSON line (`"event": "agent_turn"`) with the hashed actor,
channel, status, category, handoff, tokens and duration; never the message,
the answer or the phone.

### Extending the rules

Edit `src/agent_core/safety/rules.py`: add patterns to a `Category` (folded
form: lowercase, no accents, `\b` at both ends, phrases over single words) or
append a new `Category` with `action=BLOCK` or `SUPPORT`. Add the new attack
and a few legitimate messages of the business to `test/agent/test_prefilter.py`
and run the tests: they guard both false negatives and false positives.

## Adding a business tool

`tools/business_api.py` (`call_business_api`, GET only, relative paths, 10 s
timeout, truncated output wrapped as `<tool_output>`) is the example and is
registered only when `AGENT_BUSINESS_API_URL` is set. For a real project,
prefer one tool per operation with typed arguments:

1. Create `src/agent_core/tools/<name>.py` with a class whose constructor takes
   what the request binds (phone, settings, config) and a method decorated
   with `@tool` whose docstring tells the model when to use it.
2. Return text, wrapping any external data with
   `wrap_untrusted(data, TOOL_OUTPUT_TAG, source="<name>")`.
3. Register it in `tools/__init__.py::build_tools` (conditionally on its env
   var) and add its permissions to the runtime role.
4. Test it with `FakeModel` (see `test/agent/support.py`).

Never let the model choose identity-bearing values (phone, customer id): bind
them in the constructor, as `HandoffTools` does.

## Running locally

```bash
cd backend/src/agent
python -m venv .venv && . .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
export AWS_REGION=us-east-1 AWS_PROFILE=<profile with Bedrock access>
python src/agentcore_main.py
curl -s localhost:8080/invocations -H "Content-Type: application/json" \
  -d '{"prompt": "hola, cuanto cuesta el envio?", "actor_id": "local-test", "session_id": "local-1", "channel": "web"}'
curl -N localhost:8080/invocations -H "Content-Type: application/json" \
  -d '{"prompt": "que productos tienen?", "actor_id": "local-test", "channel": "web", "stream": true}'
```

Container (AgentCore Runtime requires arm64):

```bash
docker build --platform linux/arm64 -t whatsapp-agent backend/src/agent
docker run --rm -p 8080:8080 -e AWS_REGION -e AWS_ACCESS_KEY_ID -e AWS_SECRET_ACCESS_KEY -e AWS_SESSION_TOKEN whatsapp-agent
```

Lambda variant: same image, command `["lambda_handler.handler"]` (the
entrypoint starts `awslambdaric` when `AWS_LAMBDA_RUNTIME_API` is set),
architecture `arm64`. Invoke it with the contract payload as the event.

Tests (no AWS, the model is scripted): see `backend/test/agent/README.md`.

## Limitations

- Keyword filters have false positives (a legitimate message that looks like
  an attack gets the refusal) and false negatives (paraphrases, other
  languages, images). Layers 2 and 4 are the backstop, not a guarantee; review
  the `blocked_category` metrics and tune `rules.py` with real traffic.
- The output check only sees text: a model that paraphrases its rules without
  copying 10 words in a row, or leaks business data that is not secret-shaped,
  is not caught.
- In streaming, up to the held-back tail is safe; text already sent before a
  leak is detected cannot be recalled (the `done` event tells the client to
  replace it).
- The greeting fast path does not know the conversation history: a mid-chat
  "hola" gets the full greeting.
- Memory strips tool calls before persisting, so a later turn does not
  remember tool results verbatim, only what the agent said about them.
