import { describe, expect, it } from 'vitest';
import {
  brandVariables,
  contrast,
  hexToHsl,
  scaleColors,
  secondaryOf,
  type Hsl,
} from './brandPalette';

const parse = (value = ''): Hsl => {
  const [h, s, l] = value.replace(/%/g, '').split(' ').map(Number);
  return { h: h ?? 0, s: s ?? 0, l: l ?? 0 };
};
const WHITE = { h: 0, s: 0, l: 100 };
const INK = { h: 210, s: 11, l: 8 };

describe('hexToHsl', () => {
  it('converts a hex to rounded H S L', () => {
    expect(hexToHsl('#3B82F6')).toEqual({ h: 217, s: 91, l: 60 });
    expect(hexToHsl('E30613')).toEqual({ h: 356, s: 95, l: 46 });
  });

  it('rejects what is not a 6-digit hex', () => {
    expect(hexToHsl('red')).toBeNull();
    expect(hexToHsl('#fff')).toBeNull();
    expect(hexToHsl('')).toBeNull();
    expect(hexToHsl('brand_color')).toBeNull();
  });
});

describe('brandVariables', () => {
  it('turns the primary into the accent hue and its states', () => {
    const vars = brandVariables({ primary: '#E30613' });
    expect(vars['--brand-accent']).toBe('356 95% 46%');
    expect(vars['--brand-accent-500']).toBe('356 95% 46%');
    expect(vars['--brand-accent-light']).toBe('356 90% 94%');
  });

  it('builds a 50-950 scale that goes from light to dark', () => {
    const vars = brandVariables({ primary: '#0057A8' });
    const steps = ['50', '100', '200', '300', '400', '500', '600', '700', '800', '900', '950'];
    const lightness = steps.map(step => parse(vars[`--brand-accent-${step}`]).l);
    expect([...lightness].sort((a, b) => b - a)).toEqual(lightness);
  });

  it('uses white text on a dark colour and dark text on a light one', () => {
    expect(brandVariables({ primary: '#0057A8' })['--brand-accent-foreground']).toBe(
      'var(--color-white)'
    );
    expect(brandVariables({ primary: '#F7A619' })['--brand-accent-foreground']).toBe(
      'var(--brand-gray-950)'
    );
  });

  it('keeps hover and active readable against their text', () => {
    for (const primary of ['#F7A619', '#FFD400', '#3B82F6', '#E30613', '#22C55E']) {
      const vars = brandVariables({ primary });
      const text = vars['--brand-accent-foreground'] === 'var(--color-white)' ? WHITE : INK;
      for (const state of ['hover', 'active']) {
        expect(contrast(parse(vars[`--brand-accent-${state}`]), text)).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('uses the configured secondary, or derives a dark shade of the primary', () => {
    expect(brandVariables({ primary: '#E30613', secondary: '#1E293B' })['--brand-navy']).toBe(
      '217 33% 17%'
    );
    expect(secondaryOf({ h: 356, s: 95, l: 46 }, '')).toEqual({ h: 356, s: 30, l: 24 });
  });

  it('falls back to the default blue when the primary is not a hex', () => {
    expect(brandVariables({ primary: 'nope' })['--brand-accent']).toBe('217 91% 60%');
  });
});

describe('scaleColors', () => {
  it('points every Tailwind step at its variable', () => {
    expect(scaleColors('brand-accent')['100']).toBe('hsl(var(--brand-accent-100))');
  });
});
