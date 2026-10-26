import { describe, expect, it } from 'vitest';
import { applyBrandColor, brandTokens, hexToHsl } from './brandColor';

describe('hexToHsl', () => {
  it('converts a hex to rounded H S L', () => {
    expect(hexToHsl('#3B82F6')).toEqual({ h: 217, s: 91, l: 60 });
    expect(hexToHsl('E30613')).toEqual({ h: 356, s: 95, l: 46 });
  });

  it('rejects what is not a 6-digit hex', () => {
    expect(hexToHsl('red')).toBeNull();
    expect(hexToHsl('#fff')).toBeNull();
    expect(hexToHsl('')).toBeNull();
  });
});

describe('brandTokens', () => {
  it('derives darker hover and active shades', () => {
    const tokens = brandTokens('#E30613')!;
    expect(tokens['--brand-accent']).toBe('356 95% 46%');
    expect(tokens['--brand-accent-hover']).toBe('356 95% 39%');
    expect(tokens['--brand-accent-active']).toBe('356 95% 34%');
  });

  it('uses white text on a dark colour and dark text on a light one', () => {
    expect(brandTokens('#0057A8')!['--primary-foreground']).toBe('var(--color-white)');
    expect(brandTokens('#FFD400')!['--primary-foreground']).toBe('var(--brand-gray-950)');
  });
});

describe('applyBrandColor', () => {
  it('sets the tokens on the root element', () => {
    const root = document.createElement('div');
    applyBrandColor('#0057A8', root);
    expect(root.style.getPropertyValue('--brand-accent')).toBe('209 100% 33%');
  });

  it('leaves the defaults alone for an invalid value', () => {
    const root = document.createElement('div');
    applyBrandColor('not-a-colour', root);
    expect(root.style.getPropertyValue('--brand-accent')).toBe('');
  });
});
