import { describe, expect, it } from 'vitest';
import { normalizeCognitoDomain, parseSsoProviders } from './sso';

describe('parseSsoProviders', () => {
  it('reads the comma list the generator writes, spaces included', () => {
    expect(parseSsoProviders('microsoft, google')).toEqual(['microsoft', 'google']);
  });

  it('keeps a fixed order and drops unknown or repeated names', () => {
    expect(parseSsoProviders('Google,github,google')).toEqual(['google']);
  });

  it('is empty when nothing is listed', () => {
    expect(parseSsoProviders('')).toEqual([]);
    expect(parseSsoProviders(undefined)).toEqual([]);
  });

  it('is the same list under mock sign-in: the buttons are a preview there too', () => {
    expect(parseSsoProviders('microsoft,google')).toEqual(['microsoft', 'google']);
  });
});

describe('normalizeCognitoDomain', () => {
  it('accepts the CognitoDomainUrl output as is', () => {
    expect(normalizeCognitoDomain('https://acme-dev.auth.us-east-1.amazoncognito.com/')).toBe(
      'acme-dev.auth.us-east-1.amazoncognito.com'
    );
  });
});
