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
project generated without the user-management screen has no admin code, no
admin route and no dangling import, rather than a hidden feature flag.

A section can also declare `routes`: extra pages with no sidebar entry (such
as `/settings/templates/new`), registered with the section's guard.

Sections that set the same `group` (e.g. `group: 'Configuración'`) render in
the sidebar as one collapsible entry with a sub-item each; it opens by itself
when one of its routes is active. Admin filtering runs per section, so a group
with no visible section is not shown.

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

### WhatsApp

`src/features/whatsapp` is the WhatsApp inbox: the conversation list, the
thread, replies, approved templates and the take-over switch. It talks to the
backend's `/whatsapp/*` routes (see the root README for the contract) and
listens to the AppSync events API at `VITE_APPSYNC_URL` for live updates; the
AppSync client lives in `src/features/whatsapp/realtime.ts`, the one module
outside `src/lib/auth` that imports `aws-amplify`.

Under `VITE_AUTH_PROVIDER=mock` the section runs on in-memory demo data
(`services/mockWhatsApp.ts`) instead of the API, so it works with no backend.

`src/features/templates` (Configuración > Plantillas, `/settings/templates`)
lists every message template from `GET /whatsapp/templates` with its Meta
review status, quality, a WhatsApp-like preview and its variables. The send
dialog in the inbox offers only the `APPROVED` ones.

"Agregar plantilla" opens `/settings/templates/new`, a frontend-only preview of
creating a template: the form, a live preview and Meta's rules checked as you
type (`templateRules.ts` holds the limits, `validateTemplate.ts` checks them).
There is no create endpoint yet: under mock auth "Enviar a revisión" adds the
template to the demo list as `PENDING`; otherwise the button stays disabled.

## Theming

The brand lives in one file, `src/styles/brand.json`:

```json
{
  "primary": "#E30613",
  "secondary": "",
  "logo": "/brand/logo.svg",
  "logoOnDark": "/brand/logo-white.svg"
}
```

| Key | What it drives |
|---|---|
| `primary` | calls to action: `--brand-accent-*` -> `--primary`, `--btn-default-*`, highlights, the sign-in layouts |
| `secondary` | surfaces and chrome: `--brand-navy-*` -> `--secondary`, `--sidebar-*`, `--btn-secondary-*`, `--ring`. Empty = a dark shade of the primary's hue |
| `logo` | the header and sign-in wordmark (`BrandMark`); empty = the app name as text |
| `logoOnDark` | the logo on the coloured sign-in panels (`brand-panel`, `insights`, the `orbit` disc); empty = `logo` |

`tailwind.config.ts` turns each hex into CSS variables at build time
(`src/lib/theme/brandPalette.ts`): a Tailwind-style scale `50`-`950`, the
`-hover`, `-active` and `-light` states, and the text colour that reads on it
(white or dark, by contrast; hover and active are kept at 4.5:1 against it).
So `bg-primary`, `bg-primary-100` and `text-secondary-700` all follow the
brand, and changing a hex re-themes the app with no other edit.
`src/styles/colors.css` maps those variables onto the semantic tokens, and
holds the neutrals and the state colours (success, warning, error).

Logos go in `public/brand/` and are referenced from the root
(`/brand/logo.svg`). Prefer SVG with a transparent background.

Components use semantic Tailwind classes (`bg-primary`, `text-muted-foreground`,
`text-warning`) — avoid reintroducing raw hex values, which is what silently
decouples a component from the theme.

The template is light-only by design: a scaffold should not ship a theme
nobody can switch. If you add a dark theme, define a `.dark` block redefining
the semantic tokens, set `darkMode: ['class']` in `tailwind.config.ts`, and add
the control that toggles the class on `<html>` - all three, or it is dead code.

## Security notes

- Every `VITE_` variable is **inlined into the client bundle** and readable by
  anyone using the app. Public configuration only — never a secret, an API key
  or an AWS access key.
- "Remember me" stores only the email, in plain `localStorage`. Storing the
  password — even encrypted — is not real protection in a SPA, because the key
  would ship inside the bundle alongside the ciphertext.
- `.env` is gitignored; `.env.example` is the file that gets committed.
