/**
 * Safely parses a fetch Response body as JSON, returning null instead of
 * throwing when the body isn't JSON at all (e.g. `VITE_API_GATEWAY_URL` is
 * misconfigured and the request lands on the dev server's own SPA fallback,
 * which answers 200 with `index.html` - `response.json()` would otherwise
 * throw a raw "Unexpected token '<' ... is not valid JSON" SyntaxError that
 * leaks straight into the UI instead of a friendly error message).
 */
export async function parseJsonBody<T>(response: Response): Promise<T | null> {
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    return null;
  }
  try {
    return (await response.json()) as T;
  } catch {
    return null;
  }
}
