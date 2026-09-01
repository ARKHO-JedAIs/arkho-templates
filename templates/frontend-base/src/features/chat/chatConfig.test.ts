import { describe, expect, it } from 'vitest';
import { parseCapabilities } from './chatConfig';

// Colocated inside the chat feature on purpose: a test living in src/test/ that
// imported from here would break `tsc -b` and `vitest run` in every project
// generated without the chat section. Sitting here, it is removed with the folder.
describe('parseCapabilities', () => {
  it('reads a comma-separated list', () => {
    expect(parseCapabilities('voice,images')).toEqual(new Set(['voice', 'images']));
  });

  it('tolerates whitespace and casing from a hand-edited .env', () => {
    expect(parseCapabilities(' Voice ,  IMAGES ')).toEqual(new Set(['voice', 'images']));
  });

  it('drops empty entries', () => {
    expect(parseCapabilities('voice,,')).toEqual(new Set(['voice']));
  });

  // A text-only chat is a valid build, not a misconfiguration.
  it('treats empty and missing as no extras', () => {
    expect(parseCapabilities('')).toEqual(new Set());
    expect(parseCapabilities(undefined)).toEqual(new Set());
  });
});
