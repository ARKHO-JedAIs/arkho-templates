---
name: arkho-branding
description: "Trigger: brandear, personalizar la marca, aplicar la identidad del cliente, esta es la web del cliente, saca los colores de este sitio, estos son los colores de la marca, aca va el CSS de la marca, manual de marca, pon el logo, cambia el favicon, cambia los colores, brand this project from a client site. Extracts a brand from whatever source is at hand - a client website, a pasted CSS or token file, a brand manual, a logo - and applies it to a project generated from an ARKHO frontend template: the primary and secondary colours and the logos in src/styles/brand.json, the favicon and the page description."
license: Apache-2.0
metadata:
  author: arkho
  version: "2.0"
---

# Applying a brand to this project

The whole brand lives in **one file**, `src/styles/brand.json`:

```json
{
  "primary": "#E30613",
  "secondary": "",
  "logo": "/brand/logo.svg",
  "logoOnDark": "/brand/logo-white.svg"
}
```

Everything else follows from it: `tailwind.config.ts` turns each hex into a full
palette at build time (`src/lib/theme/brandPalette.ts`), and the header and every
sign-in layout render the logo through `src/components/brand/BrandMark.tsx`. So
this skill's job is to find the right values and write them there - not to edit
CSS, not to compute shades.

**Ask the questions in Spanish** - the UI and the team are Spanish-speaking.
These instructions are in English to match the rest of the repo's developer docs.

## 1. Read the current state first

Never assume the defaults are still in place; someone may have branded this
project already, or partially.

- `src/styles/brand.json` - the colours chosen at generation time and whether a
  logo is set.
- `public/brand/` - logo files already there.
- `src/features/auth/layouts/index.ts` - which sign-in layout is in use
  (`basic`, `brand-panel`, `insights` or `orbit`). It tells you where the logos
  will show (see step 5).
- `public/favicon.svg` - the placeholder still carries a "Neutral placeholder
  mark" comment.
- `index.html` - whether a `<meta name="description">` exists.

Say what you found, and ask what the developer wants to change rather than
running the full interview when part of it is done.

## 2. Ask for a source, not for a hex

Nobody has the brand values to hand. What they do have is the client's website,
a brand manual, a CSS file, or a logo. **Lead with that** - ask in Spanish for
whatever they already have, and only fall back to asking for a colour directly
if they have nothing.

Ask for: the client's site or brand material, the logo (and a light version for
dark backgrounds, if they have one), and one sentence for the page description.
Then extract the rest yourself.

### From a website

The highest-signal source, in order:

1. **CSS custom properties.** Fetch the site's stylesheets and look for
   declarations like `--color-primary`, `--brand-*`, or a company-specific prefix
   (a Chilean corporate site might define `--naranjo-acme`, `--gris-acme`). When
   a site names its own palette, that naming *is* the brand system - take it
   over anything you infer.
2. **Computed styles of the elements that carry the brand**, if a browser tool is
   available: the primary call-to-action button's background, the header or nav
   background, and the link colour.
3. **`<meta name="theme-color">`** and the og:image, as corroboration.

Do not take "the most frequent colour on the page" as the brand colour - on most
sites that is a background grey or white. The brand colour is the one on the
buttons the site wants you to click.

### From CSS or a token file the developer pastes

Map their names onto ours rather than guessing by value. Their "primary",
"brand", "accent" or CTA colour becomes `primary`; their dark neutral,
"secondary", or header/sidebar colour becomes `secondary`. If they hand over a
full ramp (50 through 900), take their 500 as the value - the scale is rebuilt
from it.

### From a brand manual (PDF or image)

Read it and pull the named primary and secondary colours plus their hex values.
Manuals usually also state the minimum sizes and clear space for the logo -
respect those.

### Two colours, not more

`brand.json` holds **two** colours, and a brand usually has more:

- `primary` - the colour the brand uses for action. Buttons, links, the active
  state, the sign-in panels.
- `secondary` - the dark neutral surface: sidebar, secondary buttons. If the
  brand has no such colour, leave it **empty**: a dark shade of the primary's hue
  is derived for it, which is better than inventing an unrelated colour.

Anything else in the brand palette (success, warning, chart colours) already has
its own token in `src/styles/colors.css` and is out of scope here. Say which
colours you used and which you left out, so the choice is visible rather than
silent.

### Logo

Prefer an official asset from the client's brand kit, ideally SVG with a
transparent background: what you can pull off a website is usually a small
raster, sometimes with a baked-in background, and it will look wrong on a retina
display. Ask for the real file first.

If you do extract from the site, look for an inline `<svg>` or an `<img>` in the
header - those beat the favicon, which is usually a cropped mark rather than the
full logo. State plainly that the asset came from the site and should be replaced
with the official one.

These assets belong to the client. Use them for that client's project, and do not
copy a brand into an unrelated one.

## 3. Confirm before applying

Extraction is inference, so show your work before editing anything: the colours
you found, where each came from, and which key each will become. A wrong guess
is cheap to correct here and annoying to unpick afterwards.

## 4. Apply

- **Colours** - write 6-digit hexes (`#RRGGBB`) into `primary` and `secondary`
  in `src/styles/brand.json`. Nothing else: the scale `50`-`950`, hover, active,
  light and the readable text colour are generated, and hover/active are kept at
  4.5:1 contrast against their text automatically. Do **not** edit the
  `--brand-accent-*` / `--brand-navy-*` variables or write HSL anywhere - they
  are build output.
- **Logo** - copy the files into `public/brand/` and set `logo` (for light
  backgrounds) and, when there is one, `logoOnDark` (for the coloured panels) to
  their root paths, e.g. `/brand/logo.svg`. Leave `logoOnDark` empty to reuse
  `logo`.
- **Favicon** - replace `public/favicon.svg`, keeping the filename, or update the
  `<link>` in `index.html`. Keep it SVG: it stays crisp at every size.
- **Description** - add `<meta name="description">` to `index.html`.

## 5. Where the brand shows

| Place | Uses |
|---|---|
| Header | `logo` (or the app name) |
| `basic` sign-in | `logo` above the card |
| `brand-panel` sign-in | `logoOnDark` on the coloured panel, `logo` above the form on phones |
| `insights` sign-in | `logoOnDark` on the dark panel |
| `orbit` sign-in | `logo` above the greeting, `logoOnDark` in the disc on the right (the sign-in's brand image) |

Check the logo against the background it lands on: a dark logo on the
`brand-panel` or `insights` panel disappears - that is what `logoOnDark` is for.

## 6. Verify before handing back

Use the project's own package manager - whichever lockfile is in the folder
(`package-lock.json` -> npm, `pnpm-lock.yaml` -> pnpm, `yarn.lock` -> yarn), or
the `packageManager` field of `package.json`:

```bash
<pm> run lint     # 0 errors, 0 warnings is the baseline
<pm> test
<pm> run build
```

Then start the dev server and confirm on screen that the primary button, the
sidebar active state, the sign-in screen and the logo all changed. A colour that
compiles but renders wrong is the failure mode here, and only looking catches it.

## What this skill does not do

- It does not add or remove sections. That is decided at generation time by
  `arkho-cli generate`; changing it now means regenerating.
- It does not switch the sign-in layout; that is one export in
  `src/features/auth/layouts/index.ts`, documented in `CLAUDE.md`.
- It does not translate the UI. The language is a separate decision, documented
  in `CLAUDE.md`.
- It does not introduce a dark theme. The template is light-only by design; see
  the theming section of `README.md` for what adding one actually requires.
