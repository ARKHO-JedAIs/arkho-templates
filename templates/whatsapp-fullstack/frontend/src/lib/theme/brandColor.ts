/**
 * The brand colour from `VITE_BRAND_COLOR` (a hex such as `#E30613`), applied
 * over the `--brand-accent*` tokens of `src/styles/colors.css` at startup.
 *
 * Done at runtime because the tokens are `H S% L%` triples and the generator
 * can only substitute text, not convert a hex. The upside: changing the colour
 * later is an edit to `.env`, no regeneration. Everything that derives from
 * `--brand-accent` (`--primary`, buttons, focus, the sign-in layouts) follows.
 */

export interface Hsl {
  h: number;
  s: number;
  l: number;
}

const HEX = /^#?([0-9a-f]{6})$/i;

/** The 24-bit RGB value of a hex colour, or `null` when it is not a 6-digit hex. */
function parseHex(hex: string): number | null {
  const digits = HEX.exec(hex.trim())?.[1];
  return digits ? parseInt(digits, 16) : null;
}

export function hexToHsl(hex: string): Hsl | null {
  const value = parseHex(hex);
  if (value === null) return null;
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

const clamp = (value: number) => Math.min(100, Math.max(0, value));
const triple = ({ h, s, l }: Hsl) => `${h} ${clamp(s)}% ${clamp(l)}%`;

/** WCAG relative luminance of an RGB value, 0 (black) to 1 (white). */
function luminance(value: number): number {
  const channel = (shift: number) => {
    const c = ((value >> shift) & 255) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(16) + 0.7152 * channel(8) + 0.0722 * channel(0);
}

/** The `--brand-accent*` tokens for a brand hex; `null` when it is not a valid hex. */
export function brandTokens(hex: string): Record<string, string> | null {
  const value = parseHex(hex);
  const base = hexToHsl(hex);
  if (value === null || !base) return null;
  // White text unless the colour is light enough that dark text reads better.
  const foreground = luminance(value) > 0.45 ? 'var(--brand-gray-950)' : 'var(--color-white)';
  return {
    '--brand-accent': triple(base),
    '--brand-accent-hover': triple({ ...base, l: base.l - 7 }),
    '--brand-accent-active': triple({ ...base, l: base.l - 12 }),
    '--brand-accent-light': triple({ ...base, s: Math.min(base.s, 90), l: 94 }),
    '--primary-foreground': foreground,
    '--btn-default-text': foreground,
  };
}

/** Applies `VITE_BRAND_COLOR` before the first render; a missing or invalid value keeps the CSS defaults. */
export function applyBrandColor(
  hex = import.meta.env.VITE_BRAND_COLOR ?? '',
  root: HTMLElement = document.documentElement
) {
  const tokens = brandTokens(hex);
  if (!tokens) return;
  for (const [name, value] of Object.entries(tokens)) root.style.setProperty(name, value);
}
