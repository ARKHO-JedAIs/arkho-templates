# {{ project_name }}

Single-page React application (TypeScript + Vite) that signs users in against an
existing Amazon Cognito user pool and calls a backend REST API with the user's
token. It ships a small, working example of each building block (routing, auth
guard, data fetching, client state, UI kit) for you to replace with real screens.

Generated from the ARKHO `react-spa` template (see `arkho.json` for the exact
version and answers).

## Prerequisites

| Requirement | Notes |
|---|---|
| Node.js 18 or later | Minimum for Vite 6. No version is pinned (there is no `.nvmrc` or `engines` field). |
| `{{ package_manager }}` | The package manager chosen at generation. No lockfile is generated; the first install creates it. |
| A Cognito user pool | With a **public** app client (no client secret) that allows username/password sign-in (`USER_SRP_AUTH`, the Amplify default). Users must already exist in the pool: the app has no sign-up screen. |
| A backend API | Reachable from the browser (CORS enabled for the dev origin `http://localhost:5173`) and accepting `Authorization: Bearer <Cognito ID token>`. |

No AWS CLI, CDK or AWS credentials are needed: this project contains no
infrastructure code.

## Getting started

`.env` was already written with your CLI answers, so the app runs as soon as
dependencies are installed:

```bash
{{ package_manager }} install
{{ package_manager }} run dev    # http://localhost:5173
```

If `.env` is missing (for example, in a fresh clone, since it is gitignored),
copy `.env.example` to `.env` and fill in the values.

## Configuration

Configuration comes from `VITE_*` build-time variables. `src/lib/config/env.ts`
validates them with Zod at startup; if a required value is missing or invalid,
the app renders a **Configuration error** screen that lists each problem instead
of starting. Vite inlines these values into the bundle, so changing one requires
restarting the dev server or rebuilding.

| Variable | Required | Purpose | Filled from CLI parameter |
|---|---|---|---|
| `VITE_AWS_REGION` | yes | Region of the user pool; must look like `us-east-1`. Validated only (Amplify takes the region from the pool id). | `aws_region` |
| `VITE_COGNITO_USER_POOL_ID` | yes | Cognito user pool id, passed to `Amplify.configure`. | `cognito_user_pool_id` |
| `VITE_COGNITO_USER_POOL_CLIENT_ID` | yes | Public app client id, passed to `Amplify.configure`. | `cognito_user_pool_client_id` |
| `VITE_COGNITO_DOMAIN` | no | Reserved for future hosted UI / federation flows; not read by the app today. | `cognito_domain` (may be empty) |
| `VITE_API_BASE_URL` | yes | Base URL of the backend API (must be a valid URL); used by the shared Axios client. | `api_base_url` |

- `.env` holds your local values and is gitignored. `.env.example` holds
  placeholders and is the file to commit and share with teammates.
- Every value is public client configuration and ends up in the browser bundle.
  Never put secrets in a `VITE_*` variable.

## What's included

| Area | Implementation |
|---|---|
| Build & dev server | Vite 6 with `@vitejs/plugin-react`; `@/` path alias to `src/` (`vite.config.ts`, `tsconfig.json`). |
| Language | TypeScript 5 in strict mode, with `noUncheckedIndexedAccess` and no unused locals/parameters. |
| Routing | React Router 7 (`src/app/router.tsx`): public `/`, `/items`, `/signin`, and the protected `/dashboard`. |
| Authentication | AWS Amplify v6 Auth against Cognito (`src/lib/auth/`), using a custom sign-in form (no hosted UI). The session is restored on reload; `RequireAuth` redirects signed-out users to `/signin` and sends them back to the page they asked for after sign-in. |
| API client | One Axios instance (`src/lib/http/client.ts`): base URL `VITE_API_BASE_URL`, 15 s timeout, JSON headers, and an interceptor that adds `Authorization: Bearer <ID token>` when a session exists. |
| Server state | TanStack Query 5. Example: `useItems` runs `GET /items` and validates the response with Zod (`src/features/items/`). |
| Client state | Zustand 5: the auth status/user store and an example UI store (theme, sidebar) in `src/features/`. |
| UI | Tailwind CSS 3 + shadcn/ui (`components.json`, Radix primitives, `lucide-react`), with design tokens as CSS variables in `src/styles/globals.css`. |
| Lint & format | Biome 1.9 (`biome.json`). |
| Tests | Vitest 2 + Testing Library + jsdom. |

Things to know before you build on it:

- **Example API contract.** `/items` expects a JSON array of
  `{ id: string, name: string, description?: string }`. Change
  `itemSchema.ts` and `useItems.ts` to match your API.
- **Extra sign-in steps are not handled in the UI.** If Cognito returns a
  challenge (for example `CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED` for a user
  created by an admin, or MFA), the form shows "Additional step required: …".
  `useAuth().submitNewPassword` already wraps `confirmSignIn` for the
  new-password case; you still need to add the screen that calls it.
- **The theme toggle only changes store state.** `globals.css` defines `.dark`
  tokens and Tailwind uses `darkMode: ["class"]`, but nothing adds the `dark`
  class to the document yet.
- **No sign-up, password reset or federation flows** are included.

## Project structure

```
{{ project_name }}/
├── arkho.json              # provenance written by arkho-cli
├── .env                    # your local values (gitignored)
├── .env.example            # committed placeholders
├── index.html              # Vite entry HTML
├── src/
│   ├── main.tsx            # validates env, configures Amplify, mounts providers
│   ├── app/                # router, layout shell, RequireAuth guard, AppConfig context
│   ├── components/
│   │   ├── atoms/          # shadcn/ui primitives: button, card, input, label
│   │   ├── molecules/      # FormField
│   │   ├── organisms/      # SiteHeader (nav + sign in/out)
│   │   └── templates/      # ConfigError screen
│   ├── features/           # auth (useAuth), items (schema + query hook), ui (store)
│   ├── lib/                # auth (Amplify), config (env schema), http (Axios), utils (cn)
│   ├── pages/              # HomePage, ItemsPage, SignInPage, DashboardPage
│   ├── styles/globals.css  # Tailwind layers + design tokens
│   └── test/               # Vitest setup and tests
├── biome.json
├── components.json         # shadcn/ui config
├── tailwind.config.ts
├── postcss.config.js
├── tsconfig.json           # app config (+ tsconfig.node.json for the config files)
├── vite.config.ts
└── vitest.config.ts
```

## Scripts

| Command | What it does |
|---|---|
| `{{ package_manager }} run dev` | Start the Vite dev server on port 5173. |
| `{{ package_manager }} run build` | Type-check (`tsc -b`), then build the production bundle into `dist/`. |
| `{{ package_manager }} run preview` | Serve the built `dist/` locally. |
| `{{ package_manager }} run test` | Run the Vitest suite once. |
| `{{ package_manager }} run test:watch` | Run Vitest in watch mode. |
| `{{ package_manager }} run lint` | Biome lint, formatting and import-order check (read-only). |
| `{{ package_manager }} run format` | Apply Biome's safe fixes and formatting. |

## Build & run

```bash
{{ package_manager }} run build    # outputs static files to dist/
{{ package_manager }} run preview  # check the build locally
```

`dist/` is a static site you can host on any static host or CDN (for example,
S3 + CloudFront). This project does not include hosting or deployment
infrastructure. When you host it:

- Set the `VITE_*` values for the target environment **before** building; they
  are baked into the bundle.
- Configure the host to serve `index.html` for unknown paths, because the app
  uses browser-history routing (`/items` and `/dashboard` would otherwise
  return 404 when opened directly or reloaded).
- Allow the deployed origin in the backend API's CORS configuration.

## Testing & quality

```bash
{{ package_manager }} run test     # Vitest (jsdom), single run
{{ package_manager }} run lint     # Biome check
{{ package_manager }} run build    # includes the TypeScript type-check
```

Included tests (`src/test/`) cover the `HomePage` render and theme toggle, the
`RequireAuth` redirect/allow behaviour, and the loading, success and error states
of `useItems`. Amplify and the API client are mocked, so tests need no network
access or `.env`.

## Regenerating / upgrading

`arkho.json` records the template name, version, git tag (`react-spa@<version>`),
commit and the answers used to generate this project. To compare against a newer
template release, generate a fresh project with the same answers into another
directory, pinning the version you want:

```bash
arkho-cli generate --template react-spa --name {{ project_name }} --template-version <version> --dir <other-dir>
```

Then diff it against this project and bring over the changes you want.
Published template versions are immutable git tags in
[`ARKHO-JedAIs/arkho-templates`](https://github.com/ARKHO-JedAIs/arkho-templates).
