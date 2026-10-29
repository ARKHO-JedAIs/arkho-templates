import { describe, expect, it } from 'vitest';
import { normalizeCognitoDomain, parseSsoProviders } from './sso';

describe('parseSsoProviders', () => {
  it('reads the comma list the generator writes, spaces included', () => {
    expect(parseSsoProviders('microsoft, google', false)).toEqual(['microsoft', 'google']);
  });

  it('keeps a fixed order and drops unknown or repeated names', () => {
    expect(parseSsoProviders('Google,github,google', false)).toEqual(['google']);
  });

  it('is empty when nothing is listed', () => {
    expect(parseSsoProviders('', false)).toEqual([]);
    expect(parseSsoProviders(undefined, false)).toEqual([]);
  });

  it('is always empty under mock sign-in', () => {
    expect(parseSsoProviders('microsoft,google', true)).toEqual([]);
  });
});

describe('normalizeCognitoDomain', () => {
  it('accepts the CognitoDomainUrl output as is', () => {
    expect(normalizeCognitoDomain('https://acme-dev.auth.us-east-1.amazoncognito.com/')).toBe(
      'acme-dev.auth.us-east-1.amazoncognito.com'
    );
  });
});
