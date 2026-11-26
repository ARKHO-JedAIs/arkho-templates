import { describe, expect, it } from 'vitest';
import type { PollyVoice } from './types';
import { engineFor, engineLabel, genderLabel, groupVoices } from './types';

const voice = (id: string, languageName: string, engines: string[]): PollyVoice => ({
  id,
  name: id,
  gender: 'Female',
  languageCode: 'es-US',
  languageName,
  engines,
});

describe('voice settings helpers', () => {
  it('groups the voices by accent keeping the backend order', () => {
    const groups = groupVoices([
      voice('Lupe', 'Español (EE.UU.)', ['neural']),
      voice('Pedro', 'Español (EE.UU.)', ['neural']),
      voice('Mia', 'Español (México)', ['neural']),
    ]);
    expect(groups.map(group => [group.label, group.voices.map(v => v.id)])).toEqual([
      ['Español (EE.UU.)', ['Lupe', 'Pedro']],
      ['Español (México)', ['Mia']],
    ]);
  });

  it('keeps the engine when the new voice has it, else takes its best one', () => {
    expect(engineFor(voice('Lupe', 'x', ['neural', 'generative']), 'generative')).toBe(
      'generative'
    );
    expect(engineFor(voice('Pedro', 'x', ['neural']), 'generative')).toBe('neural');
    expect(engineFor(undefined, 'neural')).toBe('neural');
  });

  it('labels engines and genders in Spanish', () => {
    expect(engineLabel('standard')).toMatch(/^Estándar/);
    expect(engineLabel('other')).toBe('other');
    expect(genderLabel('Male')).toBe('Masculina');
  });
});
