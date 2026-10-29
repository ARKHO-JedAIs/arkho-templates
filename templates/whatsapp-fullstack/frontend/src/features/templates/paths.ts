/**
 * The templates screens' paths, in a module with no imports: the pages link to
 * each other through it. They must not import `section.tsx` for this - the
 * section registry loads that file at startup and it lazy-loads these pages, so
 * the cycle leaves the lazy page `undefined` ("Element type is invalid ... Lazy").
 * Typed as `string`: the router's typed paths only know the static routes.
 */
export const TEMPLATE_PATHS: { list: string; create: string; edit: string } = {
  list: '/settings/templates',
  create: '/settings/templates/new',
  // The router's path syntax: `$metaTemplateId` is a parameter.
  edit: '/settings/templates/$metaTemplateId/edit',
};

/** The edit page of one template. */
export const templateEditPath = (metaTemplateId: string) =>
  TEMPLATE_PATHS.edit.replace('$metaTemplateId', encodeURIComponent(metaTemplateId));
