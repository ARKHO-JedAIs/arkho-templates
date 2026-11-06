/** `2026-11-06T16:30:00+00:00` -> `06-11-26, 13:30` in the browser's time zone. */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '';
  return new Date(iso).toLocaleString('es-CL', { dateStyle: 'short', timeStyle: 'short' });
}
