# {{ project_name }}

WhatsApp inbox on AWS, generated from the ARKHO `whatsapp-fullstack` template.

| Folder | What it is | Based on |
|---|---|---|
| `backend/` | CDK stack: Cognito, REST API, and the WhatsApp module (`lib/stack/whatsapp`) | `aws-cdk-serverless-backend` |
| `frontend/` | React SPA with a live WhatsApp section (`src/features/whatsapp`) | `frontend-base` |

A project generated with `components=backend` or `components=frontend` only has
that folder; everything below about the other one does not apply.

## How it works

```
Contact (WhatsApp) -> Meta -> AWS End User Messaging Social -> SNS topic -> ws-handler Lambda
   ws-handler: stores the message (DynamoDB), announces it (AppSync), marks it read,
               and sends the automatic reply unless a person took the conversation
Frontend -> REST API (Cognito) -> send-message / send-template / put-control ...
Frontend <- AppSync subscription (live updates)
```

- No Meta access token is stored anywhere: End User Messaging Social sends with
  the Lambda's IAM role.
- Free-form text only reaches a contact within 24 hours of their last message.
  Outside that window (or to start a conversation) send an approved template.
- **Take conversation** pauses the automatic replies for that contact;
  **Return to assistant** resumes them.
- `ws-handler`'s `answer()` is the seam for an agent: today it returns the
  configured automatic reply; replace it with a call to your model.

## Run it locally (no AWS)

```bash
# Backend: tests and synth only, nothing is deployed
cd backend                      # .env was written with your answers (gitignored)
npm install
npm test                        # vitest: CDK assertions
python -m unittest discover -s test/python -v   # ws-handler unit tests
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
   (templates are created and approved in WhatsApp Manager).

## WhatsApp configuration

In `backend/.env` (gitignored: the phone number ARN carries the account id).
At deploy they become the Parameter Store parameter the Lambdas read.

| Variable | Meaning |
|---|---|
| `WHATSAPP_PHONE_NUMBER_ID` | Phone number ARN in End User Messaging Social. Needed to send from the web. |
| `WHATSAPP_BUSINESS_ACCOUNT_ID` | WABA id (`waba-...`). Needed to list templates. |
| `WHATSAPP_META_API_VERSION` | Meta Graph API version the payloads target. |
| `WHATSAPP_DEFAULT_PHONE_PREFIX` | Country prefix added to numbers typed without one. |
| `WHATSAPP_AUTO_REPLY_MESSAGE` | Sent to every inbound message while the assistant answers. Empty = none. |
| `WHATSAPP_ADMIN_GROUP` / `WHATSAPP_REQUIRE_ADMIN` | Cognito group the WhatsApp API and live channel require; `false` = any signed-in user. |

Inbound notifications that still fail after Lambda's retries are kept 14 days
in the `WhatsAppDeadLetterQueueUrl` queue: fix the cause, then redrive them.

## Backend API (all behind the Cognito authorizer)

Every route requires the `WHATSAPP_ADMIN_GROUP` group (403 otherwise), unless
`WHATSAPP_REQUIRE_ADMIN=false`.

| Method | Path | Body / query | Returns `data` |
|---|---|---|---|
| GET | `/whatsapp/conversations` | | conversations, most recent first |
| GET | `/whatsapp/messages` | `?phone=<digits>[&before=<iso>]` | `{ conversation, messages, window_open }` |
| POST | `/whatsapp/messages` | `{ phone, message }` | the stored message; 409 `WINDOW_CLOSED` after 24 h |
| GET | `/whatsapp/templates` | | every template with its status, components and variables (only APPROVED ones can be sent) |
| POST | `/whatsapp/templates/send` | `{ phone, template_name, language, parameters? }` | the stored message |
| PUT | `/whatsapp/control` | `{ phone, mode: "human" \| "assistant" }` | the conversation |

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

Nobody can disable, delete or change the roles of their own account.

Realtime (AppSync `onEvent(id)`): `id=<phone>` carries `MESSAGE_RECEIVED`,
`MESSAGE_SENT`, `TEMPLATE_SENT`, `MESSAGE_STATUS` (sent, delivered, read,
failed) and `CONTROL_CHANGED`; `id=inbox` carries `CONVERSATION_UPDATED`. The
payload is the stored item. Only the admin group can subscribe when one is set.

## Not included yet

Every WhatsApp event, what the template does with it today and what to add
next: [docs/WHATSAPP_EVENTS.md](docs/WHATSAPP_EVENTS.md).

- Media: images, audio and documents are stored as a placeholder text with
  their caption, not downloaded.
- An AI agent: plug it into `answer()` in `backend/src/lambda/whatsapp/ws-handler`.
- Message rate limits per contact.
- Inbox: unread counters, search and filters, and the hours left in the 24 h
  window, computed by the backend.
- Quick replies (saved texts inserted with one click) and a new-message alert
  (tab title counter and sound).
- A `deploy` script that wraps `cdk deploy --profile` for the SSO profile.
- Filling `frontend/.env` from the stack outputs after a deploy (API URL,
  AppSync URL, Cognito ids) instead of asking for them at generation.
- Terraform as an alternative to CDK: no ARKHO template ships Terraform yet.

To verify on the first deploy (built from midoc's working setup, not yet run
against AWS from this template): the Python 3.12 Lambda runtime ships a boto3
with the `socialmessaging` client, and the delivery statuses match the sent
messages (the message id End User Messaging Social returns is the one its
status notifications carry - an unmatched status is logged and ignored).
