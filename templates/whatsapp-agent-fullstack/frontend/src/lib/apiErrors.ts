/**
 * Error messages for the people using the web, never for developers.
 *
 * The backend answers `{ error: { code, message } }` with a technical English
 * `message`: it is meant for the logs, so the
 * screens never show it. They show the text for the error `code` when there
 * is one the user can act on, else a plain message for the HTTP status.
 */

export interface ApiErrorBody {
  error?: { code?: string; message?: string };
}

const TRY_AGAIN = 'Intenta nuevamente en unos minutos.';

/** Codes whose cause the user can fix or should know about, in their words. */
const BY_CODE: Record<string, string> = {
  MODEL_UNAVAILABLE:
    'Ese modelo no está habilitado en la cuenta de AWS. Habilítalo en Bedrock o elige otro.',
  TOO_LONG: 'Las instrucciones son demasiado largas. Acórtalas un poco.',
  NOT_APPLIED: 'La versión se guardó pero no se aplicó al agente. Publica de nuevo.',
  NO_DRAFT: 'No hay un borrador para publicar.',
  USER_EXISTS: 'Ya existe un usuario con ese correo.',
  SELF_CHANGE: 'No puedes hacer ese cambio sobre tu propia cuenta.',
  ROLE_NOT_ALLOWED: 'No puedes asignar ese rol.',
  TEMPLATE_INVALID: 'La plantilla no cumple las reglas de WhatsApp. Revisa los puntos marcados.',
  SOCIAL_MESSAGING_ERROR: `No pudimos conectarnos con WhatsApp. ${TRY_AGAIN}`,
};

const BY_STATUS: Record<number, string> = {
  401: 'Tu sesión expiró. Vuelve a iniciar sesión para continuar.',
  403: 'Tu perfil no permite hacer esto.',
  404: 'No encontramos lo que buscas. Recarga la página e intenta nuevamente.',
  409: 'Alguien más hizo cambios mientras tanto. Recarga la página e intenta nuevamente.',
  400: 'Revisa los datos ingresados e intenta nuevamente.',
  422: 'Revisa los datos ingresados e intenta nuevamente.',
  429: 'Hay muchas solicitudes en este momento. Espera un momento e intenta nuevamente.',
};

/** What to tell the user about a failed response; `action` names what failed ("No se pudo cargar el uso"). */
export function friendlyError(status: number, body: ApiErrorBody | null, action: string): string {
  const code = body?.error?.code ?? '';
  if (BY_CODE[code]) return BY_CODE[code];
  if (BY_STATUS[status]) return BY_STATUS[status];
  return `${action}: ocurrió un error interno. ${TRY_AGAIN}`;
}

/** The request never reached the backend (offline, DNS, CORS). */
export const NETWORK_ERROR = 'No pudimos conectarnos. Revisa tu conexión e intenta nuevamente.';

/** `fetch`, with a network failure turned into a message for the user. */
export async function fetchOrFail(input: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(input, init);
  } catch {
    throw new Error(NETWORK_ERROR);
  }
}
