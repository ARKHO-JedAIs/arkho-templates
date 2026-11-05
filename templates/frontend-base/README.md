# {{ project_name }}

A React single-page app (TypeScript, Vite): a sidebar shell, sign-in with the
forced password change for admin-created users, role-gated routing and a themed
design-token system, plus whichever optional sections you picked (user
management, chat assistant). It runs against a mock auth provider until you
point it at a Cognito user pool.

Generated from the ARKHO `frontend-base` template (see `arkho.json` for the
exact version and answers).

## Prerequisites

| Tool | Version | Source |
|---|---|---|
| Node.js | 24 recommended, `>=20` required | `.nvmrc`, `package.json` → `engines` |
| Package manager | `{{ package_manager }}` (chosen at generation); npm must be `>=10` | `arkho.json`, `package.json` → `engines` |

`.npmrc` sets `engine-strict=true`, so npm refuses to install on a Node or npm
below the `engines` floor instead of failing later in the build.

Nothing else is needed to run the app locally with `VITE_AUTH_PROVIDER=mock`.
For real sign-in you need an existing **Cognito user pool** with a **public app
client** (no client secret). The optional sections need the backends described
in [Chat backend contract](#chat-backend-contract) and
[Users API](#users-api); this project does not create any AWS resources.

## Getting started

```bash
{{ package_manager }} install
{{ package_manager }} run dev        # http://localhost:5173
```

`.env` was written from your CLI answers and is gitignored. `.env.example` is
the committed, value-free placeholder; keep the two in sync key for key, and
add any new variable to `src/vite-env.d.ts` as well.

The project ships without a lockfile: commit the one your first install creates.

## Configuration

Every `VITE_` variable is **inlined into the client bundle** and readable by
anyone using the app. Public configuration only, never a secret, an API key or
an AWS credential.

| Variable | Purpose | Filled from (CLI parameter) |
|---|---|---|
| `VITE_AUTH_PROVIDER` | `mock` or `cognito`. Any value other than `mock` (including empty) selects Cognito. | `auth_provider` |
| `VITE_MOCK_AUTH_GROUPS` | Mock mode only: comma-separated groups the fake user belongs to. Must include `VITE_ADMIN_GROUP` for admin screens to be reachable. | `admin_group` |
| `VITE_COGNITO_USER_POOL_ID` | Cognito user pool id. Required for `cognito`. Its region prefix is also the region voice input uses. | `cognito_user_pool_id` (empty with mock auth) |
| `VITE_COGNITO_USER_POOL_CLIENT_ID` | Public app client id. Required for `cognito`. | `cognito_user_pool_client_id` (empty with mock auth) |
| `VITE_ADMIN_GROUP` | Cognito group that grants admin-only screens (default `admin`). | `admin_group` |
| `VITE_API_BASE_URL` | Base URL of your backend API. Empty is allowed: screens that need data show their own errors. | `api_base_url` |
| `VITE_USERS_API_PATH` | Path of the user-management endpoints, appended to `VITE_API_BASE_URL`. | fixed: `/admin/users` |
| `VITE_AGENT_CHAT_API_URL` | Chat backend base URL; the client POSTs to `{url}/chat`. | `agent_chat_api_url` |
| `VITE_CHAT_CAPABILITIES` | Comma-separated chat extras: `voice`, `images`. Empty means a text-only chat. | `chat_capabilities` |
| `VITE_CHAT_VOICE_LANGUAGE` | Amazon Transcribe language code for voice input. | fixed: `es-US` |
| `VITE_COGNITO_IDENTITY_POOL_ID` | Identity pool whose credentials sign the Transcribe calls (voice only). | `cognito_identity_pool_id` |
| `VITE_CHAT_IMAGES_UPLOAD_URL` | Endpoint that returns presigned S3 PUT targets (images only). | `chat_images_upload_url` |

The chat variables are written even when the chat section was not generated;
they are simply unused then.

If `VITE_AUTH_PROVIDER` selects Cognito and either id is missing, the app
renders a configuration screen naming the missing variable instead of
throwing from inside Amplify.

## What's included

**Stack:** React 19, TypeScript 5.7, Vite 6, TanStack Router, Zustand, Tailwind
CSS 3 with shadcn/ui (Radix) components, sonner toasts, AWS Amplify v6 (auth),
Vitest 3 with Testing Library. No data-fetching library is included on purpose;
add the one your team prefers. `components.json` is set up, so
`npx shadcn@latest add <component>` works.

| Part | Always / optional | Enabled by |
|---|---|---|
| App shell: header, collapsible sidebar, home grid, 404 and error screens | always | - |
| Sign-in page with "remember email" and the forced new-password step | always | - |
| Auth seam with `mock` and `cognito` providers | always | `VITE_AUTH_PROVIDER` (initial value from `auth_provider`) |
| Role gating (`requireAdmin`, admin-only sidebar entries) | always | `VITE_ADMIN_GROUP`; whether user management is admin-only comes from `use_roles` |
| User management (`/admin/users`): list, create, edit, enable/disable, reset password, delete | optional | `include_users_admin` (generates `src/features/admin/`) |
| Chat assistant (`/chat`): streaming answers rendered as Markdown | optional | `include_chat` (generates `src/features/chat/` and `public/pcm-worklet.js`) |
| Chat voice input (push-to-talk via Amazon Transcribe) | runtime flag | `voice` in `VITE_CHAT_CAPABILITIES` (initial value from `chat_capabilities`) |
| Chat image attachments (presigned S3 upload) | runtime flag | `images` in `VITE_CHAT_CAPABILITIES` |
| Branding skill for Claude Code | always | `.claude/skills/arkho-branding/` |
| CI: lint, test, build on push to `main` and on pull requests | always | `.github/workflows/ci.yml` |

The UI text is in Spanish (`index.html` has `lang="es"`); code and developer
docs are in English.

### Authentication

Everything auth-related goes through **one seam**, `src/lib/auth/session.ts`.
Nothing else in `src/` imports `aws-amplify` or a provider directly, so
switching providers is an `.env` change, not a refactor.

| `VITE_AUTH_PROVIDER` | Behaviour |
|---|---|
| `mock` | Any credentials are accepted, the session lives in `localStorage`, groups come from `VITE_MOCK_AUTH_GROUPS`. No AWS involved. |
| `cognito` | A real Cognito user pool through Amplify, including the `NEW_PASSWORD_REQUIRED` challenge for admin-created users. |

**Mock auth is not a security boundary.** It exists so every screen, guard and
role branch is reachable before a user pool exists. Its ID token is the literal
string `mock-id-token`, which no real backend accepts, so "mock in production"
fails loudly at the API. While mock auth is on, the home page shows a warning.

To switch to Cognito, set these in `.env` and restart the dev server:

```
VITE_AUTH_PROVIDER=cognito
VITE_COGNITO_USER_POOL_ID=us-east-1_xxxxxxxxx
VITE_COGNITO_USER_POOL_CLIENT_ID=xxxxxxxxxxxxxxxxxxxxxxxxxx
```

The new-password form checks the rules in
`src/features/auth/utils/passwordPolicy.ts` (8+ characters, upper case, lower
case, a digit). Keep them in line with your user pool's password policy;
Cognito remains the authority.

### Roles

Roles come from the `cognito:groups` claim of the ID token. A user in the
`VITE_ADMIN_GROUP` group is an admin. `isAdmin` is derived from the groups on
every read, never stored, so editing `localStorage` cannot grant it.

- With `use_roles` = yes, the user-management section is admin-only (route and
  sidebar).
- With `use_roles` = no, it is generated with `requiresAdmin: false` in
  `src/features/admin/section.tsx` and every signed-in user can open it.

Group reading distinguishes "no groups" from "could not read the token": a
missing ID token gets one forced refresh, and if that still yields nothing the
store keeps the groups it already had instead of demoting the user.

Hiding an entry from the sidebar is cosmetic; access is enforced by the route
guards in `src/router/guards.ts`, and your backend must re-check the group.

### Sections

Optional areas of the app are discovered from the filesystem. A section
declares itself by exporting `section` from `src/features/<name>/section.tsx`:

```tsx
export const section: AppSection = {
  path: '/reports',
  label: 'Reportes',
  icon: FileText,
  load: () => import('./ReportsPage'),
  requiresAdmin: false,
  order: 20,
};
```

`src/app/sections.ts` collects them with `import.meta.glob`, and the router and
sidebar both build from that list. **Adding a section is creating its folder;
removing one is deleting it**; neither touches the router. That is why a
project generated without a section has no code, route or import for it.

Keep `load` as a function returning `import()`: that is where the bundle is
split. Importing the page statically in `section.tsx` silently brings back a
single bundle while build and lint stay green.

### Users API

Used by the user-management section (`include_users_admin`). Base URL:
`VITE_API_BASE_URL` + `VITE_USERS_API_PATH`. Every request carries
`Authorization: Bearer <idToken>`.

| Method | Path | Body | Response |
|---|---|---|---|
| `GET` | `/` | - | `{ data: ManagedUser[] }` |
| `POST` | `/` | `CreateUserInput` | `{ data: ManagedUser }` |
| `PATCH` | `/{username}` | `UpdateUserInput` | `2xx` |
| `PATCH` | `/{username}/status` | `{ enabled: boolean }` | `2xx` |
| `POST` | `/{username}/password` | - | `{ data: { temporaryPassword } }` |
| `DELETE` | `/{username}` | - | `2xx` |

JSON responses must be sent as `application/json`. On failure, return
`{ error: { message } }` and the UI shows that message. A `401` becomes a
session-expired toast and a redirect to `/login`. Types are in
`src/features/admin/types/user.types.ts`; the role options (`admin`, `member`)
are Cognito group names listed in
`src/features/admin/components/UserFormDialog.tsx`, and `admin` must match
`VITE_ADMIN_GROUP`.

### Chat backend contract

Used by the chat section (`include_chat`). Capabilities are runtime flags read
by `src/features/chat/chatConfig.ts`, not generated-away code, so you can
enable one later, once its backend exists, without regenerating.

**Text streaming (always required)**

```
POST {VITE_AGENT_CHAT_API_URL}/chat
Authorization: Bearer <idToken>
{ "message": "...", "sessionId": "<uuid>", "imageKeys": [] }
```

Respond with `text/event-stream`, one JSON object per `data:` line:

```
data: {"chunk":"partial text","sessionId":"..."}
data: {"done":true,"sessionId":"...","startNewSession":false}
data: {"error":"human-readable message","sessionId":"..."}
```

`sessionId` is minted client-side per conversation; use it to key
conversational memory. `startNewSession: true` on the `done` event tells the UI
to start a fresh conversation id. Answer `401` when the token has expired and
the UI sends the user back to sign in.

**`images`**

```
POST {VITE_CHAT_IMAGES_UPLOAD_URL}
Authorization: Bearer <idToken>
{ "files": [{ "filename": "...", "contentType": "image/png" }], "sessionId": "..." }
-> { "data": { "uploads": [{ "s3Key": "...", "uploadUrl": "...", "contentType": "..." }] } }
```

The browser PUTs each file straight to `uploadUrl`; the chat request only
carries the resulting `s3Key`s in `imageKeys`. Scope keys by `sessionId` and
keep the presigned URLs short-lived.

**`voice`**

Push-to-talk audio is streamed to **Amazon Transcribe from the browser**, so
there is no endpoint to build, but there is IAM to set up:

- A Cognito identity pool (`VITE_COGNITO_IDENTITY_POOL_ID`) with your user pool
  as an authenticated provider, in the same region as the user pool (the
  region is taken from `VITE_COGNITO_USER_POOL_ID`).
- Its authenticated role needs `transcribe:StartStreamTranscription`.
- `VITE_CHAT_VOICE_LANGUAGE` selects the Transcribe language.

Voice needs Cognito auth, since it signs real AWS calls with the user's ID
token. When the flag, the identity pool, the user pool id or browser audio
support is missing, the mic button does not render and the chat stays usable.

### Theming

Two hues at the top of `src/styles/colors.css` drive the palette:

| Token | Role | Feeds |
|---|---|---|
| `--brand-accent` | calls to action | `--primary`, `--btn-default-*`, `--ring` |
| `--brand-navy` | surfaces and chrome | `--secondary`, `--sidebar-*`, `--btn-secondary-*` |

Values are space-separated `H S% L%` (no commas). Use semantic Tailwind classes
(`bg-primary`, `text-muted-foreground`) rather than raw hex values. The theme is
light-only; adding dark mode means a `.dark` block, `darkMode: ['class']` in
`tailwind.config.js` and a toggle. To brand the project, see `CLAUDE.md` or ask
Claude Code to run the `arkho-branding` skill.

## Project structure

```
.
├── .claude/skills/arkho-branding/   # Claude Code skill that applies a brand
├── .github/workflows/ci.yml         # lint, test, build
├── public/
│   ├── favicon.svg                  # placeholder mark
│   └── pcm-worklet.js               # audio worklet for voice (chat only)
├── src/
│   ├── app/sections.ts              # section registry (import.meta.glob)
│   ├── components/
│   │   ├── layout/                  # header, sidebar, navigation
│   │   └── ui/                      # shadcn/ui components
│   ├── features/
│   │   ├── auth/                    # sign-in and new-password forms
│   │   ├── home/                    # home grid of sections
│   │   ├── admin/                   # user management (include_users_admin)
│   │   └── chat/                    # chat assistant (include_chat)
│   ├── lib/
│   │   ├── auth/                    # session.ts seam, mock and Cognito providers
│   │   └── stores/useAuthStore.ts   # signed-in user (Zustand, persisted)
│   ├── router/                      # route tree and guards
│   ├── styles/colors.css            # brand hues and semantic tokens
│   ├── test/setup.ts                # Vitest setup
│   └── vite-env.d.ts                # typed VITE_ variables
├── .env / .env.example
├── CLAUDE.md                        # working brief: branding and conventions
├── arkho.json                       # generation provenance
├── components.json                  # shadcn/ui config
├── index.html
├── package.json
├── tailwind.config.js
└── vite.config.ts                   # also holds the Vitest config
```

## Scripts

| Script | What it does |
|---|---|
| `dev` | Vite dev server on http://localhost:5173 |
| `build` | `tsc -b` typecheck, then `vite build` into `dist/` |
| `preview` | Serves the built `dist/` locally |
| `lint` | ESLint (with the Prettier plugin, so formatting is checked too) |
| `lint:fix` | ESLint with `--fix` |
| `format` | Prettier on `src/**/*.{ts,tsx,css}` |
| `test` | `vitest run` (single run) |
| `test:watch` | Vitest in watch mode |

Run them with `{{ package_manager }} run <script>`.

## Build & run

```bash
{{ package_manager }} run build      # writes dist/
{{ package_manager }} run preview    # check the production build locally
```

The output is static files. Host `dist/` on any static host or CDN and serve
`index.html` for unknown paths, since routes are client-side. `VITE_` values are
baked in at build time: build once per environment with that environment's
`.env`. This project includes no deployment infrastructure.

## Testing & quality

```bash
{{ package_manager }} run lint       # 0 errors, 0 warnings is the baseline
{{ package_manager }} run test       # vitest run (jsdom)
{{ package_manager }} run build      # includes the tsc typecheck
```

Unit tests cover the section registry, the route guards, the auth store and,
when the chat is generated, the capability parser. Tests for an optional
section live inside its folder, so removing the section removes its tests too.
`vite.config.ts` pins `VITE_ADMIN_GROUP=admin` for tests, so they do not depend
on your `.env`.

CI (`.github/workflows/ci.yml`) runs the same three checks with **npm** and
`npm install` (there is no lockfile yet). If you chose another package manager,
or once you commit a lockfile, adjust the workflow (for example to `npm ci`).

## Regenerating / upgrading

`arkho.json` records the template name, version, git tag and commit, and every
answer you gave the CLI. The template version is pinned there. To reproduce or
compare against a newer template, run `arkho-cli generate --template
frontend-base --template-version <version>` with the same answers into a
separate directory and diff it against this project.
