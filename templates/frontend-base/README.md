# {{ project_name }}

React SPA generated from the ARKHO `frontend-base` template.

```bash
{{ package_manager }} install
{{ package_manager }} run dev      # http://localhost:5173
```

`.env` was written with your answers at generation time. `.env.example` is the
committed placeholder — keep it in sync and value-free.

## Stack

React 19 · TypeScript · Vite 6 · TanStack Router · Zustand · Tailwind ·
shadcn/Radix · sonner

Dependencies are kept to what the template actually uses. Add what you need -
`npx shadcn@latest add <component>` is wired up (`components.json` points at
`src/index.css`), and a data-fetching library is a deliberate omission rather
than an oversight: pick the one your team wants.

## Authentication

Everything auth-related goes through **one seam**, `src/lib/auth/session.ts`.
Nothing else in `src/` imports `aws-amplify` or a provider directly, which is
what makes the swap below a one-line change instead of a refactor.

| `VITE_AUTH_PROVIDER` | Behaviour |
|---|---|
| `mock` | Any credentials accepted, session in `localStorage`, groups from `VITE_MOCK_AUTH_GROUPS`. No AWS involved. |
| `cognito` | Real Cognito user pool via Amplify, including the forced password change for admin-created users. |

**Mock auth is not a security boundary.** It exists so every screen, guard and
role branch is reachable before a user pool exists. Its `getIdToken()` returns
the literal string `mock-id-token`, which no real backend will accept — a
misconfigured "mock in production" therefore fails loudly at the API instead of
silently authorizing anything.

### Switching to Cognito

Set three values in `.env` and restart the dev server:

```
VITE_AUTH_PROVIDER=cognito
VITE_COGNITO_USER_POOL_ID=us-east-1_xxxxxxxxx
VITE_COGNITO_USER_POOL_CLIENT_ID=xxxxxxxxxxxxxxxxxxxxxxxxxx
```

Use a **public** app client (no client secret) — a secret cannot be kept in a
browser bundle. If either id is missing, the app renders a configuration screen
naming the missing variable rather than throwing from inside Amplify.

### Roles

Roles come from the `cognito:groups` claim on the ID token. A user in the group
named by `VITE_ADMIN_GROUP` (default `admin`) gets `isAdmin`, which unlocks
admin-only routes and sidebar entries.

Group reading deliberately distinguishes "no groups" from "could not read the
token": a missing ID token earns one forced refresh, and if that still yields
nothing the store keeps what it had. Collapsing the two would silently
demote a signed-in administrator to a regular user.

## Sections

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

Note `load`, not the component itself: that `import()` is where the bundler cuts
the graph, so the page ships in its own chunk and is fetched on first visit.
Importing the page statically at the top of `section.tsx` undoes that silently —
the build and the lint stay green, the bundle goes back to being monolithic.

`src/app/sections.ts` picks it up with `import.meta.glob`, and the router and
sidebar both build from that list. **Adding a section is creating its folder;
removing one is deleting it** — neither touches the router. That is why a
project generated without the chat assistant has no chat code, no chat route
and no dangling import, rather than a hidden feature flag.

Hiding an admin entry from the sidebar is cosmetic. Access is enforced by
`requireAdmin` in `src/router/routes.tsx`.

## Backend contracts

### Users API

Base URL: `VITE_API_BASE_URL` + `VITE_USERS_API_PATH` (default `/admin/users`).
Every request carries `Authorization: Bearer <idToken>`.

| Method | Path | Body | Response |
|---|---|---|---|
| `GET` | `/` | — | `{ data: ManagedUser[] }` |
| `POST` | `/` | `CreateUserInput` | `{ data: ManagedUser }` |
| `PATCH` | `/{username}` | `UpdateUserInput` | `204` |
| `PATCH` | `/{username}/status` | `{ enabled: boolean }` | `204` |
| `POST` | `/{username}/password` | — | `{ data: { temporaryPassword } }` |
| `DELETE` | `/{username}` | — | `204` |

A `401` is surfaced as a session-expired toast and a redirect to `/login`.
Types live in `src/features/admin/types/user.types.ts`.

### Chat assistant

Capabilities are runtime flags in `VITE_CHAT_CAPABILITIES` (comma-separated:
`voice`, `images`), read by `src/features/chat/chatConfig.ts`. They are flags
rather than generated-away code because voice and images share `ChatInput.tsx`.
The practical upside: **enable one later, once its backend exists, without
regenerating the project.**

Below is what each capability expects you to implement.

#### Text streaming — always required

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

`sessionId` is minted client-side per conversation and is how you key
conversational memory. Answer `401` when the token expired — the UI turns that
into a re-login rather than a generic failure. Setting `startNewSession: true`
on the `done` event tells the UI to clear the thread and mint a fresh id.

#### `images`

```
POST {VITE_CHAT_IMAGES_UPLOAD_URL}
{ "files": [{ "filename": "...", "contentType": "image/png" }], "sessionId": "..." }
-> { "data": { "uploads": [{ "s3Key": "...", "uploadUrl": "...", "contentType": "..." }] } }
```

The browser PUTs each file straight to `uploadUrl`; the chat request itself only
ever carries the resulting `s3Key`s. Scope keys by `sessionId`, and keep the
presigned URLs short-lived.

#### `voice`

Push-to-talk dictation streams audio to **Amazon Transcribe from the browser**,
so there is no endpoint of yours to build — but there is IAM to set up:

- A **Cognito identity pool** (`VITE_COGNITO_IDENTITY_POOL_ID`) with the user
  pool as an authenticated provider.
- Its authenticated role needs `transcribe:StartStreamTranscription`.
- `VITE_CHAT_VOICE_LANGUAGE` selects the Transcribe language (e.g. `en-US`).

Voice requires `VITE_AUTH_PROVIDER=cognito`: it signs real AWS calls, so it
cannot work under mock auth. When unavailable, the mic button simply does not
render — the chat stays usable.

## Theming

Two hues in `src/styles/colors.css` drive the whole palette:

| Token | Role | Semantic tokens fed |
|---|---|---|
| `--brand-accent` | calls to action | `--primary`, `--btn-default-*`, `--ring` |
| `--brand-navy` | surfaces and chrome | `--secondary`, `--sidebar-*`, `--btn-secondary-*` |

Everything below them is derived, so changing those two re-themes the app.
Components use semantic Tailwind classes (`bg-primary`, `text-muted-foreground`,
`text-warning`) — avoid reintroducing raw hex values, which is what silently
decouples a component from the theme.

The template is light-only by design: a scaffold should not ship a theme
nobody can switch. If you add a dark theme, define a `.dark` block redefining
the semantic tokens, set `darkMode: ['class']` in `tailwind.config.js`, and add
the control that toggles the class on `<html>` - all three, or it is dead code.

## Security notes

- Every `VITE_` variable is **inlined into the client bundle** and readable by
  anyone using the app. Public configuration only — never a secret, an API key
  or an AWS access key.
- "Remember me" stores only the email, in plain `localStorage`. Storing the
  password — even encrypted — is not real protection in a SPA, because the key
  would ship inside the bundle alongside the ciphertext.
- `.env` is gitignored; `.env.example` is the file that gets committed.
