import { describe, expect, it } from 'vitest';
import type { LucideIcon } from 'lucide-react';
import { sections, sortSections, type AppSection } from './sections';

function fixture(partial: Partial<AppSection> & Pick<AppSection, 'path' | 'label'>): AppSection {
  return {
    icon: (() => null) as unknown as LucideIcon,
    load: async () => ({ default: () => null }),
    ...partial,
  };
}

describe('sortSections', () => {
  it('puts lower order first', () => {
    const sorted = sortSections([
      fixture({ path: '/b', label: 'B', order: 90 }),
      fixture({ path: '/a', label: 'A', order: 10 }),
    ]);
    expect(sorted.map(s => s.path)).toEqual(['/a', '/b']);
  });

  it('defaults a missing order to 100', () => {
    const sorted = sortSections([
      fixture({ path: '/none', label: 'None' }),
      fixture({ path: '/low', label: 'Low', order: 50 }),
    ]);
    expect(sorted.map(s => s.path)).toEqual(['/low', '/none']);
  });

  it('breaks ties by label so the sidebar never shuffles', () => {
    const sorted = sortSections([
      fixture({ path: '/z', label: 'Zeta', order: 10 }),
      fixture({ path: '/a', label: 'Alfa', order: 10 }),
    ]);
    expect(sorted.map(s => s.label)).toEqual(['Alfa', 'Zeta']);
  });

  it('does not mutate its input', () => {
    const input = [
      fixture({ path: '/b', label: 'B', order: 90 }),
      fixture({ path: '/a', label: 'A', order: 10 }),
    ];
    sortSections(input);
    expect(input.map(s => s.path)).toEqual(['/b', '/a']);
  });
});

// Invariants over whatever sections this build actually has. Deliberately never
// asserts that any exist: a project generated with neither chat nor users admin
// is a valid build with an empty registry.
describe('the section registry', () => {
  it('gives every section an absolute path', () => {
    for (const section of sections) {
      expect(section.path.startsWith('/')).toBe(true);
    }
  });

  // Two sections on the same path collide in the router with no build error and
  // a confusing runtime result. This is the only place that catches it.
  it('has no duplicate paths', () => {
    const paths = sections.map(s => s.path);
    expect(new Set(paths).size).toBe(paths.length);
  });

  // Guards the code-splitting invariant: `load` must stay a function, because a
  // section that imports its page statically silently rebuilds the monolith.
  it('exposes load as a function on every section', () => {
    for (const section of sections) {
      expect(typeof section.load).toBe('function');
    }
  });
});
