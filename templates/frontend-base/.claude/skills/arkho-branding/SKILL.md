---
name: arkho-branding
description: "Trigger: brandear, personalizar la marca, aplicar la identidad del cliente, esta es la web del cliente, saca los colores de este sitio, estos son los colores de la marca, aca va el CSS de la marca, manual de marca, pon el logo, cambia el favicon, brand this project from a client site. Extracts a brand from whatever source is at hand - a client website, a pasted CSS or token file, a brand manual, a logo - and applies it to a project generated from the ARKHO frontend-base template: the two brand hues with their derived hover/active/light states, the wordmarks, the favicon and the page description."
license: Apache-2.0
metadata:
  author: arkho
  version: "1.0"
---

# Applying a brand to this project

The project ships deliberately unbranded. This skill takes whatever brand source
the developer has at hand - most often the client's own website - extracts the
identity from it, and does the edits. That includes the fiddly part a human
usually gets wrong: the derived hover/active/light shades that keep button states
proportional.

**Ask the questions in Spanish** — the UI and the team are Spanish-speaking.
These instructions are in English to match the rest of the repo's developer docs.

## 1. Read the current state first

Never assume the defaults are still in place; someone may have branded this
project already, or partially.

- `src/styles/colors.css` — the two hues in the `BRAND COLORS` block.
- `src/features/auth/LoginPage.tsx` and `src/components/layout/Header.tsx` — the
  `APP_NAME` constants and whether a wordmark or an `<img>` is rendered.
- `public/favicon.svg` — the placeholder still carries a "Neutral placeholder
  mark" comment.
- `index.html` — whether a `<meta name="description">` exists.
- `src/assets/` — whether a logo asset is already there.

If the hues are no longer the shipped defaults (`217 91% 60%` for the accent,
`215 25% 27%` for the slate), say so and ask what the developer wants to change
rather than running the full interview.

## 2. Ask for a source, not for a hex

Nobody has the HSL triples to hand. What they do have is the client's website, a
brand manual, a CSS file, or a logo. **Lead with that** — ask in Spanish for
whatever they already have, and only fall back to asking for a colour directly if
they have nothing.

Ask for: the client's site or brand material, the logo, and one sentence for the
page description. Then extract the rest yourself.

### From a website

The highest-signal source, in order:

1. **CSS custom properties.** Fetch the site's stylesheets and look for
   declarations like `--color-primary`, `--brand-*`, or a company-specific prefix
   (a Chilean corporate site might define `--naranjo-acme`, `--gris-acme`). When
   a site names its own palette, that naming *is* the brand system — take it
   over anything you infer.
2. **Computed styles of the elements that carry the brand**, if a browser tool is
   available: the primary call-to-action button's background, the header or nav
   background, and the link colour. These three map almost directly onto what
   this template needs.
3. **`<meta name="theme-color">`** and the og:image, as corroboration.

Do not take "the most frequent colour on the page" as the brand colour — on most
sites that is a background grey or white. The brand colour is the one on the
buttons the site wants you to click.

### From CSS or a token file the developer pastes

Map their names onto ours rather than guessing by value. Their "primary",
"brand", "accent" or CTA colour becomes `--brand-accent`; their dark neutral,
"secondary", or header/sidebar colour becomes `--brand-navy`. If they hand over a
full ramp (50 through 900), take 500 as the base and use their own 600/700/100
for hover/active/light instead of deriving.

### From a brand manual (PDF or image)

Read it and pull the named primary and secondary colours plus their hex values.
Manuals usually also state the minimum sizes and clear space for the logo —
respect those when sizing the wordmark replacement.

### Reconciling with the two-hue system

This template has exactly **two** hues, and a brand usually has more. Do not try
to fit them all in:

- `--brand-accent` → the colour the brand uses for action. Buttons, links, the
  active state.
- `--brand-navy` → the dark neutral surface: header, sidebar, secondary buttons.
  If the brand has no such colour, derive a desaturated dark from the accent's
  hue rather than inventing an unrelated one.

Anything else in the brand palette (success, warning, chart colours) already has
its own token further down `colors.css` and is out of scope here. Say which
colours you used and which you left out, so the choice is visible rather than
silent.

### Logo and favicon

Prefer an official asset from the client's brand kit: what you can pull off a
website is usually a small raster, sometimes with a baked-in background, and it
will look wrong on a retina display. Ask for the real file first.

If you do extract from the site, look for an inline `<svg>` or an `<img>` in the
header — those beat the favicon, which is usually a cropped mark rather than the
full logo. State plainly that the asset came from the site and should be replaced
with the official one.

These assets belong to the client. Use them for that client's project, and do not
copy a brand into an unrelated one.

## 3. Confirm before applying

Extraction is inference, so show your work before editing anything: the colours
you found, where each came from, and which token each will become. A wrong guess
is cheap to correct here and annoying to unpick afterwards.

## 4. Convert to the token format

Values in `colors.css` are **space-separated `H S% L%`**, never comma-separated.
This is not cosmetic: Tailwind renders an opacity modifier as
`hsl(var(--x) / .8)`, and slash-alpha is invalid CSS when mixed with commas — so
a comma would make every `/opacity` utility in the app silently paint nothing.

Convert a hex to HSL and write the three numbers with no commas.

## 5. Derive the four values per hue

Each brand hue needs a base plus three states. Two ways to get them, in order of
preference:

**If the colour maps to a Tailwind palette** (the shipped defaults do: the accent
is `blue-500`, with `blue-100` / `blue-600` / `blue-700` as its light / hover /
active), take those ramp steps. They are designed to stay legible together.

**Otherwise derive from the base**, keeping hue and saturation and moving only
lightness:

| Token | Rule |
|---|---|
| `--brand-*` | the chosen colour |
| `--brand-*-hover` | lightness − 7 points |
| `--brand-*-active` | lightness − 12 points |
| `--brand-*-light` | lightness → 93%, saturation slightly raised |

Check the result: `-hover` and `-active` must stay dark enough for white text
(aim for a contrast ratio of at least 4.5:1 against `#fff`), and `-light` must be
pale enough to carry dark text.

Do not touch the neutral grey scale, and do not edit any token below the
`BRAND COLORS` block — those are all derived and will follow on their own.

## 6. Apply

- **Hues** — edit only the eight `--brand-*` lines. Update the trailing comment
  on each base hue to name the new colour instead of the old one.
- **Logo** — put the asset in `src/assets/` and import it, so Vite fingerprints
  it. Replace the wordmark `<span>` in both files. Give the header version a
  height, never a width: the header is a fixed 3.5rem and a tall logo pushes it.
  The two constants are separate on purpose — a full logo on the sign-in screen
  and a compact mark in the header is the common split.
- **Favicon** — replace `public/favicon.svg`, keeping the filename, or update the
  `<link>` in `index.html`. Keep it SVG: it stays crisp at every size.
- **Description** — add `<meta name="description">` to `index.html`.

## 7. Verify before handing back

Run all three, and report the real result:

```bash
npm run lint     # 0 errors, 0 warnings is the baseline
npm test
npm run build
```

Then start the dev server and confirm on screen that the primary button, the
sidebar active state and the sign-in card all changed. A colour that compiles but
renders wrong is the failure mode here, and only looking catches it.

## What this skill does not do

- It does not add or remove sections. That is decided at generation time by
  `arkho-cli generate`; changing it now means regenerating.
- It does not translate the UI. The language is a separate decision, documented
  in `CLAUDE.md`.
- It does not introduce a dark theme. The template is light-only by design; see
  the theming section of `README.md` for what adding one actually requires.
