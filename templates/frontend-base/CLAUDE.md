# {{ project_name }}

Generated from the ARKHO `frontend-base` template. This file is the working
brief for anyone — human or agent — touching this repo.

Read [README.md](README.md) for the stack, the auth model and the backend
contracts. This file covers what to do **next**: making the project yours, and
the conventions that keep it coherent while you do.

---

## If this project is still unbranded

Signal: `src/styles/colors.css` still carries the shipped defaults —
`--brand-accent: 217 91% 60%` and `--brand-navy: 215 25% 27%`.

When that is true, **mention once** that the `arkho-branding` skill can run the
whole checklist below as a short interview, and then get on with whatever was
actually asked. Do not raise it again in the same session, and never block a
request on it: a team can legitimately postpone branding for weeks.

The signal turns itself off — branding changes those exact values — so there is
no marker file to remember to clean up.

---

## Branding checklist

The template ships deliberately unbranded. The `arkho-branding` skill
(`.claude/skills/arkho-branding/`) automates this list; what follows is the same
work done by hand. Each step is small, and together they are the whole of it.

### 1. The two hues

`src/styles/colors.css` has exactly two brand hues at the top. Everything else
in the file is derived from them.

```css
--brand-accent: 217 91% 60%;   /* calls to action  -> --primary */
--brand-navy:   215 25% 27%;   /* surfaces, chrome -> --secondary */
```

Change those two and the whole app re-themes: buttons, focus rings, active
sidebar items, the sign-in wash, chart colours. Adjust `-hover`, `-active` and
`-light` alongside each so states stay proportional.

> **Format matters.** Values are space-separated `H S% L%`, never
> `H, S%, L%`. Tailwind renders an opacity modifier as `hsl(var(--x) / .8)`,
> and slash-alpha is invalid CSS when mixed with commas — with commas, every
> `/opacity` utility in the app silently paints nothing.

### 2. The name

`{{ project_name }}` was substituted at generation time. It now appears in:

| Where | What it is |
|---|---|
| `package.json` → `name` | the npm package name |
| `index.html` → `<title>` | the browser tab |
| `src/features/auth/LoginPage.tsx` → `APP_NAME` | the sign-in wordmark |
| `src/components/layout/Header.tsx` → `APP_NAME` | the header wordmark |

The two `APP_NAME` constants are intentionally separate: the sign-in screen and
the app shell usually diverge (a full logo on one, a compact mark on the other).

### 3. The logo

Both wordmarks are a `<span>` holding `APP_NAME`. Swap each for an `<img>`:

```tsx
<img src={logo} alt={APP_NAME} className='h-7 w-auto' />
```

Put the asset in `src/assets/` and import it, so Vite fingerprints it. Give the
header version a height, not a width — the header is a fixed 3.5rem and a tall
logo will push it.

### 4. Favicon and title

`public/favicon.svg` is a neutral placeholder mark. Replace it (keep the
filename, or update the `<link>` in `index.html`). It is SVG rather than a
raster so it stays crisp at every size and can be edited as text. Add a
`<meta name="description">` while you are in there — the template does not ship
one, because a scaffold has nothing true to say.

### 5. Typography

The font is `@fontsource-variable/public-sans`, imported in `src/index.css` and
wired to Tailwind's `sans`. To change it: install the new
`@fontsource-variable/*` package, swap the import, and update `fontFamily.sans`
in `tailwind.config.js`. Keep it self-hosted — a Google Fonts `<link>` is a
third-party request on every page load and a privacy question you do not need.

### 6. Language

The UI ships in **Spanish**. `index.html` sets `lang="es"`, and
`VITE_CHAT_VOICE_LANGUAGE` defaults to `es-US` for Transcribe. Timestamps use
the browser's own locale rather than a hardcoded one.

Code comments, this file and the README are in English on purpose: they are
developer documentation, and the surrounding ARKHO template catalogue is in
English. If you localise the UI to another language, change `lang`, the voice
code, and the strings — nothing else keys off the language.

### 7. Sign-in screen

`LoginPage.tsx` is a single centred card on purpose: a scaffold has no product
to sell, and placeholder value propositions mean every project starts by
deleting copy that was never true. If your product does have a story, the split
layout belongs there — but write it, do not inherit it.

---

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
`src/features/chat/`, not `src/test/`: the generator deletes whole feature
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
