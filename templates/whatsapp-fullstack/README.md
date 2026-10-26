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
cd backend
cp .env.example .env            # AWS_ACCOUNT_ID can stay a placeholder for synth
npm install
npm test                        # jest: CDK assertions
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
| Brand colour | `frontend/.env` `VITE_BRAND_COLOR` | 6-digit hex, applied at startup over the `--brand-accent` tokens. Change it and restart `dev`. |
| Sign-in layout | `frontend/src/features/auth/layouts/` | One of `basic`, `brand-panel`, `insights`, `orbit`, chosen at generation; `index.ts` re-exports it. |
| Verification code | `frontend/.env` `VITE_MOCK_AUTH_OTP`, `backend/.env` `EMAIL_MFA_ENABLED` + `SES_FROM_EMAIL` | Mock mode: code `000000`. Real: Cognito email MFA through SES (verified sender, SES out of the sandbox). |

## Deploy and connect a WhatsApp number

1. **Deploy the backend**

   ```bash
   cd backend
   # .env: real AWS_ACCOUNT_ID and AWS_REGION (a region where End User Messaging Social is available)
   npx cdk bootstrap aws://<AWS_ACCOUNT_ID>/<AWS_REGION>   # once per account/region
   npx cdk deploy
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

4. **Give the backend the ids** - copy the phone number ARN and the WABA id into
   `backend/src/parameter/whatsapp-configuration.json` and deploy again (or edit
   the Parameter Store parameter `WhatsAppConfigurationParameterName` directly,
   no deploy needed; Lambdas read it on cold start).

5. **Point the frontend at it** - in `frontend/.env`:

   ```
   VITE_AUTH_PROVIDER=cognito
   VITE_COGNITO_USER_POOL_ID=<UserPoolId>
   VITE_COGNITO_USER_POOL_CLIENT_ID=<UserPoolClientId>
   VITE_API_BASE_URL=<RestApiUrl>
   VITE_APPSYNC_URL=<WhatsAppEventsGraphqlUrl>
   ```

   Create a user in the Cognito pool, sign in, and open **WhatsApp**.

6. **Try it** - write to the business number from your phone: the conversation
   shows up live. Reply from the web within 24 hours, or send a template
   (templates are created and approved in WhatsApp Manager).

## WhatsApp configuration

`backend/src/parameter/whatsapp-configuration.json` (non-secret ids only):

| Key | Meaning |
|---|---|
| `origination_phone_number_id` | Phone number ARN in End User Messaging Social. Needed to send from the web. |
| `whatsapp_business_account_id` | WABA id (`waba-...`). Needed to list templates. |
| `meta_api_version` | Meta Graph API version the payloads target. |
| `default_phone_prefix` | Country prefix added to numbers typed without one. |
| `auto_reply_message` | Sent to every inbound message while the assistant answers. Empty = none. |

## Backend API (all behind the Cognito authorizer)

| Method | Path | Body / query | Returns `data` |
|---|---|---|---|
| GET | `/whatsapp/conversations` | | conversations, most recent first |
| GET | `/whatsapp/messages` | `?phone=<digits>[&before=<iso>]` | `{ conversation, messages, window_open }` |
| POST | `/whatsapp/messages` | `{ phone, message }` | the stored message; 409 `WINDOW_CLOSED` after 24 h |
| GET | `/whatsapp/templates` | | approved templates with body and variable count |
| POST | `/whatsapp/templates/send` | `{ phone, template_name, language, parameters? }` | the stored message |
| PUT | `/whatsapp/control` | `{ phone, mode: "human" \| "assistant" }` | the conversation |

Realtime (AppSync `onEvent(id)`): `id=<phone>` carries `MESSAGE_RECEIVED`,
`MESSAGE_SENT`, `TEMPLATE_SENT` and `CONTROL_CHANGED`; `id=inbox` carries
`CONVERSATION_UPDATED`. The payload is the stored item.

## Not included yet

- Media: images, audio and documents are stored as a placeholder text with
  their caption, not downloaded.
- An AI agent: plug it into `answer()` in `backend/src/lambda/whatsapp/ws-handler`.
- Message rate limits per contact.
