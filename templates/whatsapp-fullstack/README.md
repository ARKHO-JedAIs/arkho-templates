# {{ project_name }}

WhatsApp inbox on AWS, generated from the ARKHO `whatsapp-fullstack` template.

| Folder | What it is | Based on |
|---|---|---|
| `backend/` | CDK stack: Cognito, REST API, the WhatsApp module (`lib/stack/whatsapp`) and the optional AI agent (`lib/stack/agent`, code in `backend/agent`) | `aws-cdk-serverless-backend` |
| `frontend/` | React SPA with a live WhatsApp section (`src/features/whatsapp`) | `frontend-base` |

A project generated with `components=backend` or `components=frontend` only has
that folder; everything below about the other one does not apply.

## How it works

```
Contact (WhatsApp) -> Meta -> AWS End User Messaging Social -> SNS topic -> ws-handler Lambda
   ws-handler: stores the message (DynamoDB), announces it (AppSync), marks it read,
               and, unless a person took the conversation, queues it for the AI agent
               (agent-jobs SQS -> agent-worker -> AgentCore Runtime or Lambda -> reply)
               or, without an agent, sends the fixed automatic reply
Frontend -> REST API (Cognito) -> send-message / send-template / put-control ...
Frontend <- AppSync subscription (live updates)
```

- No Meta access token is stored anywhere: End User Messaging Social sends with
  the Lambda's IAM role.
- Free-form text only reaches a contact within 24 hours of their last message.
  Outside that window (or to start a conversation) send an approved template.
- **Take conversation** pauses the automatic replies for that contact;
  **Return to assistant** resumes them.
- `ws-handler`'s `answer()` decides who answers: the AI agent when one is
  deployed and switched on, otherwise the configured automatic reply. See
  [AI agent](#ai-agent).

## Run it locally (no AWS)

```bash
# Backend: tests and synth only, nothing is deployed
cd backend                      # .env was written with your answers (gitignored)
npm install
npm test                        # vitest: CDK assertions
python -m unittest discover -s test/python -v   # Lambda unit tests (ws-handler, agent-worker...)
npx cdk synth --quiet

# Frontend: with VITE_AUTH_PROVIDER=mock the WhatsApp section runs on demo data
cd ../frontend
{{ package_manager }} install
{{ package_manager }} run dev   # http://localhost:5173/whatsapp, any credentials
```

In demo mode a contact answers a couple of seconds after you write, through the
same realtime path AppSync uses, so the whole screen can be exercised.

## Sign-in and brand

| Setting | Where | Notes |
|---|---|---|
| Brand colours and logo | `frontend/src/styles/brand.json` | `primary` and `secondary` hex (empty secondary = a dark shade of the primary), `logo` and `logoOnDark` paths under `frontend/public/`. Tailwind turns each hex into a full palette at build time; `dev` picks up an edit by itself. |
| Sign-in layout | `frontend/src/features/auth/layouts/` | One of `basic`, `brand-panel`, `insights`, `orbit`, chosen at generation; `index.ts` re-exports it. |
| Verification code | `frontend/.env` `VITE_MOCK_AUTH_OTP`, `backend/.env` `EMAIL_MFA_ENABLED` + `SES_FROM_EMAIL` | Mock mode: code `000000`. Real: Cognito email MFA through SES (verified sender, SES out of the sandbox). |
| Microsoft / Google buttons | `backend/.env` `SSO_PROVIDERS`, `frontend/.env` `VITE_AUTH_SSO_PROVIDERS` | Cognito sign-in only (hidden in mock mode). See [Sign in with Microsoft or Google](#sign-in-with-microsoft-or-google). |

## Deploy and connect a WhatsApp number

1. **Deploy the backend**

   ```bash
   cd backend
   # .env: check AWS_REGION (a region where End User Messaging Social is available).
   # The account comes from the AWS profile you deploy with (SSO): no keys, no account id.
   aws sso login --profile <your-profile>
   npx cdk bootstrap --profile <your-profile>   # once per account/region
   npx cdk deploy --profile <your-profile>
   ```

   Note the outputs: `WhatsAppTopicArn`, `WhatsAppEventsGraphqlUrl`, the REST API
   URL, and the Cognito user pool and client ids.

2. **Link the number (once, from the console)** - AWS End User Messaging Social >
   WhatsApp > *Add WhatsApp phone number*. It opens Meta's embedded signup:
   sign in with Facebook, pick or create the Meta Business portfolio and the
   WhatsApp Business Account, and verify the number (it must not be in use in
   the WhatsApp app). The safe choice is a real number you control that is not
   registered in any WhatsApp app.

3. **Send its events to the backend** - in the WABA, set the **event
   destination** to the SNS topic `WhatsAppTopicArn`.

4. **Give the backend the ids** - set `WHATSAPP_PHONE_NUMBER_ID` (the phone
   number ARN) and `WHATSAPP_BUSINESS_ACCOUNT_ID` in `backend/.env` and deploy
   again (or edit the Parameter Store parameter
   `WhatsAppConfigurationParameterName` directly, no deploy needed; Lambdas read
   it on cold start).

5. **Point the frontend at it** - in `frontend/.env`:

   ```
   VITE_AUTH_PROVIDER=cognito
   VITE_COGNITO_USER_POOL_ID=<UserPoolId>
   VITE_COGNITO_USER_POOL_CLIENT_ID=<UserPoolClientId>
   VITE_API_BASE_URL=<RestApiUrl>
   VITE_APPSYNC_URL=<WhatsAppEventsGraphqlUrl>
   ```

   Create the first administrator (sign-up is closed: admins create the
   rest from the Usuarios screen, if you included it):

   ```bash
   POOL=<UserPoolId>; EMAIL=you@example.com
   aws cognito-idp admin-create-user --user-pool-id $POOL --username $EMAIL      --user-attributes Name=email,Value=$EMAIL Name=email_verified,Value=true
   aws cognito-idp admin-add-user-to-group --user-pool-id $POOL --username $EMAIL --group-name admin
   ```

   Cognito emails a temporary password; sign in, set yours, and open **WhatsApp**.
   (Without user management, create the `admin` group first:
   `aws cognito-idp create-group --user-pool-id $POOL --group-name admin`.)

6. **Try it** - write to the business number from your phone: the conversation
   shows up live. Reply from the web within 24 hours, or send a template
   (create it from Configuración > Plantillas; Meta reviews it before it can
   be sent).

## Sign in with Microsoft or Google

Optional buttons ("Iniciar sesión con Microsoft", "Continuar con Google") next
to email and password, through the Cognito Hosted UI. Chosen at generation
(`sso_providers`), or later: `SSO_PROVIDERS=microsoft,google` in
`backend/.env` and `VITE_AUTH_SSO_PROVIDERS=microsoft,google` in
`frontend/.env` (`VITE_AUTH_PROVIDER=cognito` only).

1. **Deploy once.** A listed provider without its ids is skipped with a
   warning, but the Hosted UI domain is created. Note two outputs:
   `CognitoIdpRedirectUri` (`https://<domain>.auth.<region>.amazoncognito.com/oauth2/idpresponse`)
   and `CognitoDomainUrl`.
2. **Microsoft (Entra ID)** - Azure portal > Microsoft Entra ID > App
   registrations > *New registration*, platform *Web*, redirect URI =
   `CognitoIdpRedirectUri`. Copy the *Application (client) ID* and the
   *Directory (tenant) ID*, then Certificates & secrets > *New client secret*.
   In `backend/.env`:

   ```
   ENTRA_ID_CLIENT_ID=<application id>
   ENTRA_ID_CLIENT_SECRET=<secret value>
   ENTRA_ID_ISSUER_URL=https://login.microsoftonline.com/<tenant-id>/v2.0
   ```

3. **Google** - Google Cloud Console > APIs & Services > *OAuth consent
   screen* (app name, support email, scopes openid, email, profile), then
   Credentials > *Create credentials* > *OAuth client ID*, type *Web
   application*, authorised redirect URI = `CognitoIdpRedirectUri`. In
   `backend/.env`: `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.
4. **Redeploy** (`npx cdk deploy`): the providers are created and added to the
   app client.
5. **Frontend** - in `frontend/.env`, `VITE_COGNITO_DOMAIN=<CognitoDomainUrl>`
   (with or without `https://`). After sign-in Cognito returns to
   `VITE_AUTH_REDIRECT_SIGN_IN` (`/auth/callback`) and after sign-out to
   `VITE_AUTH_REDIRECT_SIGN_OUT` (`/login`); both must be listed in the backend
   `AUTH_CALLBACK_URLS` / `AUTH_LOGOUT_URLS` (defaults: `http://localhost:5173/...`).
   Add the production URLs there before deploying for real.

A federated user gets a Cognito account on first sign-in but **does not join
the `admin` group automatically**: an admin assigns the role from Usuarios
(or `admin-add-user-to-group`). Mapping Entra or Google groups to roles is a
later step. Client secrets come from `backend/.env` at synth time; move them to
AWS Secrets Manager before production.

## AI agent

Chosen at generation (`AGENT_RUNTIME` in `backend/.env`); the agent's code is
`backend/agent` (Python, Bedrock) and is the same for both runtimes.

| `AGENT_RUNTIME` | What is created | When |
|---|---|---|
| `agentcore` (default) | The agent image (ARM64, built by `cdk deploy`) on **Bedrock AgentCore Runtime**, X-Ray traces, AgentCore Memory | Managed sessions per customer, memory, traces; scales on its own |
| `lambda` | The same image as a container **Lambda** (ARM64, 2048 MB, 120 s), same memory | Low traffic, simplest to operate |
| `none` | Nothing: no agent resource at all | Only the fixed `WHATSAPP_AUTO_REPLY_MESSAGE`, as before |

With either runtime the stack also creates:

- `agent-prompt` Parameter Store parameter (output `AgentPromptParameterName`):
  JSON with `enabled`, `basePrompt`, `businessName`, `greeting`, `refusal`,
  `handoffMessage`, `timezone`, seeded from `AGENT_BUSINESS_DESCRIPTION`.
- `agent-jobs.fifo` SQS queue (+ `agent-jobs-dlq.fifo`) and the
  `whatsapp-agent-worker` Lambda: ws-handler queues each customer message (one
  message group per customer, so their turns run in order) and the worker
  invokes the agent, sends the reply and stores it as `sent_by: agent` (the
  web labels it **Agente IA**). At most 10 agent turns run at once, to protect
  the account's Bedrock quotas.
- AgentCore Memory, unless `AGENT_MEMORY_MODE=off`: `conversation` (only the
  conversation, as events), `facts` (+ semantic facts and user preferences,
  namespaces `/facts/{actorId}` and `/preferences/{actorId}`),
  `facts_summaries` (+ summaries, `/summaries/{actorId}/{sessionId}`). Events
  expire after 30 days; the memory is retained when `ENV_NAME=prod`.

How it behaves:

- One agent session per customer and day (`wa-<hash>-<YYYYMMDD>`, UTC); the
  memory knows the customer as `wa-<hash>`. The phone itself never reaches
  the agent runtime.
- A conversation a person took (**Tomar conversación**) is not answered by the
  agent, and nothing is sent once WhatsApp's 24 hour window closed.
- `AGENT_RATE_LIMIT_PER_HOUR` agent replies per customer per hour (atomic
  counter on the conversation); beyond it the agent is not called and the
  customer gets one polite notice per hour.
- An off-topic (`blocked`) answer is sent as the agent wrote it; the third in
  24 hours hands the conversation to a person. When the agent fails or times
  out, the conversation goes to a person with the notice "El agente no pudo
  responder" - the customer never sees an error.

**Edit the prompt**: Parameter Store > `AgentPromptParameterName` (a web screen
comes later). No deploy needed; the agent reads it at runtime. CloudFormation
only rewrites the parameter when its seed changes, so your edits survive
every deploy unless you change `AGENT_BUSINESS_DESCRIPTION` (or the project
name), which resets it to the new seed - copy your prompt first.

**Switch it off and on**: set `"enabled": false` in that parameter; within a
minute ws-handler stops queuing and the fixed automatic reply answers again.
To remove every agent resource: `AGENT_RUNTIME=none` and deploy.

**Before the first deploy**: enable the model of `AGENT_MODEL_ID` in Bedrock >
Model access (the default is the `us.` cross-region inference profile of
Claude Sonnet 4.6; IAM is scoped to exactly that model), and have Docker
running: `cdk deploy` builds the ARM64 image (on an x86 machine through
Docker's emulation, slower). `cdk synth` and the tests do not need Docker.
AgentCore traces need CloudWatch Transaction Search enabled once per account
(CloudWatch > Application Signals > Transaction Search).

**Cost** (on top of the inbox): Bedrock tokens per agent turn (the bulk of
it; `MODEL_MAX_TOKENS` 1024 per reply), AgentCore Runtime per vCPU-second the
agent actually works and per GB-second of memory while its session is alive
(AgentCore pricing page; an idle session ends after its idle timeout, 15
minutes by default), AgentCore Memory per
stored event and, with `facts` / `facts_summaries`, per extracted record (the
extraction is extra model calls), or Lambda per GB-second for the `lambda`
variant. SQS, the worker and Parameter Store are cents. The rate limit and the
concurrency cap bound the worst case.

**Test it**: `npm test` (CDK, every variant) and
`python -m unittest discover -s test/python -v` (worker and routing) run
without AWS. Deployed: write to the business number; the reply shows up
labelled **Agente IA**, and the worker's log (`whatsapp-agent-worker`) records
each turn's outcome and token usage. Jobs that failed twice (the worker could
not even read the conversation) wait 14 days in `AgentJobsDeadLetterQueueUrl`.

| Variable | Meaning |
|---|---|
| `AGENT_RUNTIME` | `agentcore`, `lambda` or `none` (unset = `none`). |
| `AGENT_MODEL_ID` | Bedrock model id or inference profile id. |
| `AGENT_BUSINESS_DESCRIPTION` | One or two sentences that seed the base prompt. |
| `AGENT_MEMORY_MODE` | `off`, `conversation`, `facts`, `facts_summaries`. |
| `AGENT_RATE_LIMIT_PER_HOUR` | Agent replies per customer per hour (default 30). |
| `AGENT_BUSINESS_API_URL` | Optional HTTPS API the agent's tools may call. |

## WhatsApp configuration

In `backend/.env` (gitignored: the phone number ARN carries the account id).
At deploy they become the Parameter Store parameter the Lambdas read.

| Variable | Meaning |
|---|---|
| `WHATSAPP_PHONE_NUMBER_ID` | Phone number ARN in End User Messaging Social. Needed to send from the web. |
| `WHATSAPP_BUSINESS_ACCOUNT_ID` | WABA id (`waba-...`). Needed to list templates. |
| `WHATSAPP_META_API_VERSION` | Meta Graph API version the payloads target. |
| `WHATSAPP_DEFAULT_PHONE_PREFIX` | Country prefix added to numbers typed without one. |
| `WHATSAPP_AUTO_REPLY_MESSAGE` | Sent to every inbound message while the assistant answers and no AI agent is on. Empty = none. |
| `WHATSAPP_ADMIN_GROUP` / `WHATSAPP_REQUIRE_ADMIN` | Cognito group the WhatsApp API and live channel require; `false` = any signed-in user. |
| `MEDIA_RETENTION_DAYS` | Days the `whatsapp-media` bucket keeps received/sent files. Empty = keep forever. |
| `MEDIA_URL_TTL_SECONDS` | Lifetime of the presigned URLs the web gets for files (default 900). |

Inbound notifications that still fail after Lambda's retries are kept 14 days
in the `WhatsAppDeadLetterQueueUrl` queue: fix the cause, then redrive them.

## Backend API (all behind the Cognito authorizer)

Every route requires the `WHATSAPP_ADMIN_GROUP` group (403 otherwise), unless
`WHATSAPP_REQUIRE_ADMIN=false`.

| Method | Path | Body / query | Returns `data` |
|---|---|---|---|
| GET | `/whatsapp/conversations` | `[?search=<text>]` | conversations, most recent first, each with `unreadCount`; with `search` (2+ characters) only those whose name (case and accents ignored) or phone digits contain it, up to 50 |
| PUT | `/whatsapp/conversations/{phone}/read` | | the conversation with `unreadCount: 0` (also announced on `inbox`); 404 if unknown |
| GET | `/whatsapp/messages` | `?phone=<digits>[&before=<iso>]` | `{ conversation, messages, window_open }`; files as presigned `media.url` |
| POST | `/whatsapp/messages` | `{ phone, message }` or `{ phone, media: { key, mimeType, filename?, caption? } }` | the stored message; 409 `WINDOW_CLOSED` after 24 h; 422 `MEDIA_REJECTED` |
| POST | `/whatsapp/media/upload-url` | `{ phone?, filename, mimeType, size }` | `{ upload_url, key, type, headers, expires_in }`: a presigned PUT checked against WhatsApp's type/size limits (`phone` is left out for a template header sample) |
| GET | `/whatsapp/templates` | | every template with its status, components, variables, `headerFormat`, button URLs and the reviewed `examples` (only APPROVED ones can be sent) |
| POST | `/whatsapp/templates` | a template request (see below) | `{ metaTemplateId, status, category, name, language }` (201); 422 `TEMPLATE_INVALID` with `error.details.rules` |
| PUT | `/whatsapp/templates/{metaTemplateId}` | the same request (`category` only when it changes) | `{ metaTemplateId, status: "PENDING" }`: the components are replaced and Meta reviews it again |
| DELETE | `/whatsapp/templates` | `?name=<name>[&metaTemplateId=<id>]` | with the id, that language version; without it, every language of the name |
| POST | `/whatsapp/templates/media` | `{ key, mimeType }` of a file uploaded through `upload-url` | `{ handle, format }`: the sample of an IMAGE (JPEG/PNG), VIDEO (MP4) or DOCUMENT (PDF) header |
| POST | `/whatsapp/templates/send` | `{ phone, template_name, language, parameters?, header?: { text? , media?: { key, mimeType, filename? } }, buttons?: [{ index, text }] }` | the stored message; 422 when a part the template needs is missing or one it does not take is sent |
| PUT | `/whatsapp/control` | `{ phone, mode: "human" \| "assistant" }` | the conversation; a real change also stores and announces a notice (`type: event`) |

A template request (`templates-admin`, one function behind the four template
write routes) is the creator's draft:

```json
{
  "name": "confirmacion_pedido", "language": "es", "category": "UTILITY",
  "parameterFormat": "POSITIONAL",
  "header": { "format": "TEXT", "text": "..." },
  "body": "...", "footer": "...",
  "buttons": [{ "type": "URL", "text": "Seguir", "url": "https://example.com/" }],
  "examples": { "header:1": "A-1", "body:1": "Ana", "button:0": "A-1" }
}
```

`header` may also be `{ "format": "IMAGE" | "VIDEO" | "DOCUMENT", "handle": "<from /templates/media>" }`
or `null`. The backend checks it with the same rules and limits as the web's
creator (`common/whatsapp/templates.py` mirrors `validateTemplate.ts` and
`templateRules.ts`), builds Meta's definition and calls
`CreateWhatsAppMessageTemplate` / `UpdateWhatsAppMessageTemplate` (components
up to 3,000 characters). AWS and Meta errors become 4xx: invalid parameters 422
`META_REJECTED`, Meta access denied 403 `META_ACCESS_DENIED`, throttling 429
`THROTTLED`, not found 404. Every template change logs one JSON audit line
(`"audit": "whatsapp-templates"`).

Inbox search scans the conversations table with a filter on `search_key` (the
folded name and the phone, written on every new message): fine for thousands
of contacts. Conversations stored before this version get their `search_key`
with their next message. Searching inside the messages is out of scope: it
needs a search engine (Amazon OpenSearch Service) fed from the messages table.

With `USERS_API_ENABLED=true`, the Usuarios screen's API (one `admin-users`
function over Cognito, roles = the `admin` and `member` groups):

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/admin/users` | | users with their roles |
| POST | `/admin/users` | `{ email, name?, roles? }` | the user; Cognito emails the temporary password |
| PATCH | `/admin/users/{username}` | `{ name?, email?, roles? }` | 204 |
| PATCH | `/admin/users/{username}/status` | `{ enabled }` | 204 |
| POST | `/admin/users/{username}/password` | | `{ temporaryPassword }` |
| DELETE | `/admin/users/{username}` | | 204 |

Nobody can disable, delete or change the roles of their own account. Each
successful change logs one JSON line (`"audit": "admin-users"`) with the acting
admin, the action, the target user and the roles - never a password - in the
function's CloudWatch log group; CloudTrail also records the Cognito `Admin*`
calls themselves.

Realtime (AppSync `onEvent(id)`): `id=<phone>` carries `MESSAGE_RECEIVED`,
`MESSAGE_SENT`, `TEMPLATE_SENT`, `MESSAGE_STATUS` (sent, delivered, read,
failed, deleted, warning), `MESSAGE_UPDATED` (a reaction), `CONTROL_CHANGED`
and `CONVERSATION_EVENT` (an internal notice: `direction: internal`,
`type: event`, `payload: { kind: human_takeover | assistant_resumed |
agent_handoff | agent_failed, by }`);
`id=inbox` carries `CONVERSATION_UPDATED` with `unreadCount`. The payload is
the stored item, with a presigned `media.url` instead of the file's key. Every
inbound WhatsApp message type and how it is stored is mapped in
`docs/WHATSAPP_EVENTS.md`. Only the admin group can subscribe when one is set.

## Not included yet

Every WhatsApp event, what the template does with it today and what to add
next: [docs/WHATSAPP_EVENTS.md](docs/WHATSAPP_EVENTS.md).

- Media: images, audio and documents are stored as a placeholder text with
  their caption, not downloaded.
- A web screen to edit the agent's prompt (today: Parameter Store).
- Voice notes for the agent: transcribe them in ws-handler's
  `after_media_stored` before they are queued (today the agent reads
  "[Audio]").
- Grouping a burst of customer messages into one agent turn (today each
  message is one turn, answered in order).
- Inbox: search inside the messages (Amazon OpenSearch Service), and the hours
  left in the 24 h window computed by the backend.
- Quick replies (saved texts inserted with one click) and a new-message sound.
- Pushing template review results: the templates page polls every 45 s while
  one is in review; the `message_template_status_update` webhook is not wired.
- A `deploy` script that wraps `cdk deploy --profile` for the SSO profile.
- Filling `frontend/.env` from the stack outputs after a deploy (API URL,
  AppSync URL, Cognito ids) instead of asking for them at generation.
- Terraform as an alternative to CDK: no ARKHO template ships Terraform yet.

To verify on the first deploy (built from midoc's working setup, not yet run
against AWS from this template): the Python 3.12 Lambda runtime ships a boto3
with the `socialmessaging` client, and the delivery statuses match the sent
messages (the message id End User Messaging Social returns is the one its
status notifications carry - an unmatched status is logged and ignored). The
template write calls (`create_whatsapp_message_template`, `update_...`,
`delete_...`, `create_whatsapp_message_template_media`) are recent: if the
runtime's boto3 lacks them, bundle a newer boto3 in the `python-common` layer.
The details of the template definition the AWS documentation does not state
are listed in `docs/WHATSAPP_EVENTS.md` (section 5).
