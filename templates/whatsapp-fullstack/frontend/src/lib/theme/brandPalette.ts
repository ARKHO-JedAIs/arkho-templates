/**
 * Turns the brand of `src/styles/brand.json` into the CSS variables the app
 * paints with. It runs at build time, from tailwind.config.ts, so the browser
 * receives plain CSS: no runtime work and no flash of a default colour.
 *
 * Each hex becomes a Tailwind-style scale (50-950) plus the states the
 * components use (hover, active, light) and the text colour that reads on it:
 *   primary   -> --brand-accent-*  (calls to action: buttons, focus, highlights)
 *   secondary -> --brand-navy-*    (surfaces and chrome: sidebar, secondary buttons)
 * An empty or invalid secondary is derived from the primary: same hue, dark.
 */

export interface Hsl {
  h: number;
  s: number;
  l: number;
}

export interface BrandConfig {
  primary?: string;
  secondary?: string;
  logo?: string;
  logoOnDark?: string;
}

export const DEFAULT_PRIMARY = '#3B82F6';

const HEX = /^#?([0-9a-f]{6})$/i;
const MIN_CONTRAST = 4.5;
const WHITE: Hsl = { h: 0, s: 0, l: 100 };
// --brand-gray-950 of colors.css, the dark text colour.
const INK: Hsl = { h: 210, s: 11, l: 8 };

// How far each step sits between the base and white (lighter steps) or the
// base and near-black (darker ones), so any base yields a monotonic scale.
const LIGHTER: Record<string, number> = { 50: 0.92, 100: 0.82, 200: 0.64, 300: 0.44, 400: 0.22 };
const DARKER: Record<string, number> = { 600: 0.12, 700: 0.27, 800: 0.42, 900: 0.56, 950: 0.7 };
export const SCALE_STEPS = [
  '50',
  '100',
  '200',
  '300',
  '400',
  '500',
  '600',
  '700',
  '800',
  '900',
  '950',
];

export function hexToHsl(hex: string | undefined): Hsl | null {
  const digits = HEX.exec((hex ?? '').trim())?.[1];
  if (!digits) return null;
  const value = parseInt(digits, 16);
  const r = ((value >> 16) & 255) / 255;
  const g = ((value >> 8) & 255) / 255;
  const b = (value & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  let h = 0;
  let s = 0;
  if (d !== 0) {
    s = d / (1 - Math.abs(2 * l - 1));
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h: Math.round(h), s: Math.round(s * 100), l: Math.round(l * 100) };
}

const clamp = (value: number, min = 0, max = 100) => Math.min(max, Math.max(min, value));

/** The `H S% L%` triple colors.css and Tailwind expect (space-separated, never commas). */
export const triple = ({ h, s, l }: Hsl) => `${h} ${clamp(s)}% ${clamp(l)}%`;

/** WCAG relative luminance of an HSL colour, 0 (black) to 1 (white). */
function luminance({ h, s, l }: Hsl): number {
  const sat = s / 100;
  const light = l / 100;
  const a = sat * Math.min(light, 1 - light);
  const channel = (n: number) => {
    const k = (n + h / 30) % 12;
    const c = light - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(8) + 0.0722 * channel(4);
}

export function contrast(a: Hsl, b: Hsl): number {
  const [la, lb] = [luminance(a), luminance(b)];
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** White or dark text, whichever reads better on the colour. */
export function textOn(color: Hsl): Hsl {
  return contrast(color, WHITE) >= contrast(color, INK) ? WHITE : INK;
}

/**
 * Moves a derived state (hover, active) away from its text colour until the
 * text reads at 4.5:1: darker under white text, lighter under dark text.
 */
function readable(color: Hsl, text: Hsl): Hsl {
  const step = text === WHITE ? -1 : 1;
  let shade = { ...color, l: clamp(color.l, 4, 96) };
  while (contrast(shade, text) < MIN_CONTRAST && shade.l > 4 && shade.l < 96) {
    shade = { ...shade, l: shade.l + step };
  }
  return shade;
}

function scale(base: Hsl): Record<string, Hsl> {
  const steps: Record<string, Hsl> = { 500: base };
  for (const [step, t] of Object.entries(LIGHTER)) {
    steps[step] = { ...base, l: Math.round(base.l + (97 - base.l) * t) };
  }
  for (const [step, t] of Object.entries(DARKER)) {
    steps[step] = { ...base, l: Math.round(base.l - (base.l - 6) * t) };
  }
  return steps;
}

/** Every variable of one brand hue, named `--<prefix>`, `--<prefix>-hover`, ... */
function hueVariables(prefix: string, base: Hsl): Record<string, string> {
  const text = textOn(base);
  const vars: Record<string, string> = {
    [`--${prefix}`]: triple(base),
    [`--${prefix}-hover`]: triple(readable({ ...base, l: base.l - 7 }, text)),
    [`--${prefix}-active`]: triple(readable({ ...base, l: base.l - 12 }, text)),
    [`--${prefix}-light`]: triple({ ...base, s: Math.min(base.s, 90), l: 94 }),
    [`--${prefix}-foreground`]: text === WHITE ? 'var(--color-white)' : 'var(--brand-gray-950)',
  };
  for (const [step, color] of Object.entries(scale(base))) {
    vars[`--${prefix}-${step}`] = triple(color);
  }
  return vars;
}

/** The secondary to use: the configured one, or a dark shade of the primary's hue. */
export function secondaryOf(primary: Hsl, secondary?: string): Hsl {
  return hexToHsl(secondary) ?? { h: primary.h, s: Math.min(primary.s, 30), l: 24 };
}

/** All the brand variables for `:root`, from brand.json. Invalid values fall back to defaults. */
export function brandVariables(config: BrandConfig): Record<string, string> {
  const primary = hexToHsl(config.primary) ?? (hexToHsl(DEFAULT_PRIMARY) as Hsl);
  return {
    ...hueVariables('brand-accent', primary),
    ...hueVariables('brand-navy', secondaryOf(primary, config.secondary)),
  };
}

/** Tailwind colour entries `50`..`950` pointing at one hue's variables. */
export function scaleColors(prefix: string): Record<string, string> {
  return Object.fromEntries(SCALE_STEPS.map(step => [step, `hsl(var(--${prefix}-${step}))`]));
}
