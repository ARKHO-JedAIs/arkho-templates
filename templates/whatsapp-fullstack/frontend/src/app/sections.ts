import type { FunctionComponent } from 'react';
import type { LucideIcon } from 'lucide-react';

/**
 * One optional area of the app: a route, its sidebar entry, and who may see it.
 *
 * A section declares itself by exporting `section` from
 * `src/features/<name>/section.tsx`. Nothing imports those files by name.
 */
export interface AppSection {
  /** Route path, e.g. `/chat`. Must be unique across sections. */
  path: string;
  /** Sidebar label. */
  label: string;
  icon: LucideIcon;
  /**
   * Loads the page, lazily.
   *
   * A function, not the component itself, and that distinction carries the whole
   * code-splitting story: the `import()` inside it is where Rollup cuts the graph
   * and emits a separate chunk. Importing the page statically at the top of
   * `section.tsx` "for the type" quietly undoes that - build green, lint green,
   * bundle monolithic again - so don't.
   *
   * `FunctionComponent`, not `ComponentType`: the latter admits class components,
   * which have no call signature, and `lazyRouteComponent`'s conditional type
   * then collapses to `never`.
   */
  load: () => Promise<{ default: FunctionComponent }>;
  /** Restrict both the route and the sidebar entry to admins. */
  requiresAdmin?: boolean;
  /** Sidebar ordering; lower comes first. Defaults to 100. */
  order?: number;
}

/** Lower `order` first; ties broken by label so the list never shuffles. */
export function sortSections(list: AppSection[]): AppSection[] {
  return [...list].sort(
    (a, b) => (a.order ?? 100) - (b.order ?? 100) || a.label.localeCompare(b.label)
  );
}

/**
 * Every section present in this build, discovered from the filesystem.
 *
 * `import.meta.glob` is resolved by Vite at build time by scanning the
 * directory, which is the whole point: a section that was not generated leaves
 * no import behind to break. Deleting `src/features/chat/` removes the route,
 * the sidebar entry and the code, with no edit anywhere else. A plain
 * `import ... from './features/chat/ChatPage'` could not do that - it would fail
 * the build the moment the folder was gone.
 *
 * `eager: true` is deliberate and stays: these modules are metadata only, and
 * the sidebar and home screen need every label and icon immediately. The pages
 * themselves are behind `load`.
 */
const modules = import.meta.glob<{ section: AppSection }>('../features/*/section.tsx', {
  eager: true,
});

export const sections: AppSection[] = sortSections(
  Object.values(modules)
    .map(module => module.section)
    .filter(Boolean)
);
