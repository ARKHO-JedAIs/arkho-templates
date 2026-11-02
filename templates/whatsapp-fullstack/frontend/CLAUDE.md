# {{ project_name }}

Generated from the ARKHO `frontend-base` template. This file is the working
brief for anyone — human or agent — touching this repo.

Read [README.md](README.md) for the stack, the auth model and the backend
contracts. This file covers what to do **next**: making the project yours, and
the conventions that keep it coherent while you do.

---

## If this project is still unbranded

Signal: `src/styles/brand.json` has an empty `logo`. The colours were already
asked at generation time; the logo is what is usually still missing.

When that is true, **mention once** that the `arkho-branding` skill can run the
whole checklist below as a short interview, and then get on with whatever was
actually asked. Do not raise it again in the same session, and never block a
request on it: a team can legitimately postpone branding for weeks.

The signal turns itself off - adding a logo changes it - so there is no marker
file to remember to clean up.

---

## Branding checklist

The brand lives in **one file**, `src/styles/brand.json`. The `arkho-branding`
skill (`.claude/skills/arkho-branding/`) automates this list; what follows is
the same work done by hand.

### 1. The colours

```json
{ "primary": "#E30613", "secondary": "", "logo": "", "logoOnDark": "" }
```

- `primary` - calls to action: buttons, focus, highlights, the sign-in layouts.
- `secondary` - surfaces and chrome: sidebar, secondary buttons. Empty = a dark
  shade of the primary's hue.

Write plain 6-digit hexes. `tailwind.config.ts` turns each into the
`--brand-accent-*` / `--brand-navy-*` variables at build time
(`src/lib/theme/brandPalette.ts`): a `50`-`950` scale, `-hover`, `-active`,
`-light` and the readable text colour. Never write HSL triples by hand and never
edit those variables in `colors.css` - they are generated, and `colors.css` only
maps them onto semantic roles (`--primary`, `--secondary`, `--sidebar-*`).

### 2. The name

`{{ project_name }}` was substituted at generation time. It now appears in:

| Where | What it is |
|---|---|
| `package.json` -> `name` | the npm package name |
| `index.html` -> `<title>` | the browser tab |
| `src/features/auth/LoginPage.tsx` -> `APP_NAME` | the sign-in wordmark |
| `src/components/layout/Header.tsx` -> `APP_NAME` | the header wordmark |

### 3. The logo

Put the files in `public/brand/` and point `brand.json` at them:

- `logo` - the header and the sign-in wordmark, on a light background.
- `logoOnDark` - the coloured sign-in panels (`brand-panel`, `insights`) and the
  disc in the middle of `orbit`, the sign-in's brand image. Empty = `logo`.

Both render through `src/components/brand/BrandMark.tsx`; with no logo it shows
`APP_NAME` as text. Prefer SVG with a transparent background. The header is a
fixed 3.5rem: the logo is sized by height there, never by width.

### 4. Favicon and title

`public/favicon.svg` is a neutral placeholder mark. Replace it (keep the
filename, or update the `<link>` in `index.html`). Add a
`<meta name="description">` while you are in there - the template does not ship
one, because a scaffold has nothing true to say.

### 5. Typography

The font is `@fontsource-variable/public-sans`, imported in `src/index.css` and
wired to Tailwind's `sans`. To change it: install the new
`@fontsource-variable/*` package, swap the import, and update `fontFamily.sans`
in `tailwind.config.js`. Keep it self-hosted — a Google Fonts `<link>` is a
third-party request on every page load and a privacy question you do not need.

### 6. Language

The UI ships in **Spanish**. `index.html` sets `lang="es"`. Timestamps use
the browser's own locale rather than a hardcoded one.

Code comments, this file and the README are in English on purpose: they are
developer documentation, and the surrounding ARKHO template catalogue is in
English. If you localise the UI to another language, change `lang` and the
strings — nothing else keys off the language.

### 7. Sign-in screen

The layout was chosen at generation time (`basic`, `brand-panel`, `insights` or
`orbit`) and lives in `src/features/auth/layouts/`; `index.ts` re-exports it.
To switch, change that one export. The marketing copy on the decorated layouts
is a starting point: rewrite it for the product, do not ship it as is.

## Conventions worth keeping

These are not style preferences; each one prevents a specific failure.

**Colour comes from tokens, never from hex.** Use `bg-primary`,
`text-muted-foreground`, `border-destructive`. A raw `#RRGGBB` or a stock
Tailwind colour (`bg-blue-500`) silently decouples that element from the theme —
it will look right today and wrong after any re-theme, and it is what breaks a
dark theme the day someone adds one.

**Auth goes through one seam.** `src/lib/auth/session.ts` is the only module
that talks to a provider. Nothing else imports `aws-amplify`. That is what makes
`VITE_AUTH_PROVIDER=mock` a one-line switch instead of a refactor.

**`isAdmin` is derived, never stored.** The auth store holds the user; roles come
from `selectIsAdmin`. A persisted role flag lands in `localStorage`, where anyone
can edit it, and the route guard would then trust it.

**"Could not read" is not "has none".** `AuthUser.groups` is `string[] | null`.
`null` means the token was unreadable this time, and the store keeps what it
already knew. Collapsing it to `[]` silently demotes a signed-in administrator.

**Sections declare themselves.** An optional area of the app exports `section`
from `src/features/<name>/section.tsx`; `src/app/sections.ts` discovers it with
`import.meta.glob`, and the router and sidebar build from that list. Adding a
section is creating its folder; removing one is deleting it. Never import a
feature page directly into the router — that is what made deleting a section
break the build.

**`section.tsx` names its page, never imports it.** It carries metadata only
(path, label, icon, order) plus `load: () => import('./XxxPage')`. That
`import()` is the cut point that puts the page in its own chunk. A static import
of the page in that file rebuilds the monolith with the build and lint still
green — nothing will tell you.

**A test that imports from an optional feature lives inside it.** Put it in
`src/features/admin/`, not `src/test/`: the generator deletes whole feature
folders, and a test left outside would break `tsc -b` and `vitest run` in every
project generated without that section.

**Guards throw, never return, a redirect.** `throw redirect({ to: '/login' })`.
A returned redirect makes the guard's return value ambiguous, and a guard built
on another cannot tell a user from a redirect descriptor.

**Every `VITE_` variable is public.** It is inlined into the bundle and readable
by anyone using the app. Configuration only — never a secret, an API key or an
AWS credential. New variables go in `src/vite-env.d.ts` too, or they resolve to
`any` and a typo goes unnoticed.

---

## Before you push

```bash
{{ package_manager }} run lint        # 0 errors, 0 warnings is the baseline
{{ package_manager }} test            # vitest run
{{ package_manager }} run build       # tsc -b && vite build
```

The template ships clean on all three, and CI (`.github/workflows/ci.yml`) runs
the same three on every push and pull request. If any of them reports something,
it came from this session's changes.
