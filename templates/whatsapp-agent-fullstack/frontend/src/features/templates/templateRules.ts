/**
 * Meta's rules for creating a WhatsApp message template, as data.
 *
 * The conditions panel and the validator both read this module, so every
 * number lives in one place: change a limit here and both follow.
 */

export type TemplateCategory = 'UTILITY' | 'MARKETING' | 'AUTHENTICATION';
export type ParameterFormat = 'POSITIONAL' | 'NAMED';
export type HeaderFormat = 'NONE' | 'TEXT' | 'IMAGE' | 'VIDEO' | 'DOCUMENT';
export type ButtonKind = 'QUICK_REPLY' | 'URL' | 'PHONE_NUMBER' | 'COPY_CODE';

export const TEMPLATE_LIMITS = {
  nameMax: 512,
  headerTextMax: 60,
  headerVariablesMax: 1,
  bodyMax: 1024,
  footerMax: 60,
  buttonsMax: 10,
  buttonTextMax: 25,
  urlMax: 2000,
  urlVariablesMax: 1,
  phoneMax: 20,
  copyCodeExampleMax: 20,
  templatesPerAccountUnverified: 250,
  templatesPerAccountVerified: 6000,
  templatesPerHour: 100,
  reviewHours: 24,
  deletedNameDays: 30,
  archiveAfterMonths: 12,
  /** End User Messaging Social: the whole definition on create, the components on edit. */
  createDefinitionMaxBytes: 6000,
  editComponentsMaxChars: 3000,
  /** Meta: an approved template can be edited this often. */
  approvedEditsPer30Days: 10,
  approvedEditsPer24Hours: 1,
  /**
   * A heuristic, not a published number: Meta rejects bodies with "too many
   * variables for the message length" without saying where the line is. Below
   * this many words of fixed text per variable, the validator warns.
   */
  minWordsPerVariable: 3,
} as const;

/** How many buttons of each type a template may carry. */
export const BUTTON_TYPE_MAX: Record<ButtonKind, number> = {
  QUICK_REPLY: 10,
  URL: 2,
  PHONE_NUMBER: 1,
  COPY_CODE: 1,
};

export const BUTTON_TYPE_LABEL: Record<ButtonKind, string> = {
  QUICK_REPLY: 'Respuesta rápida',
  URL: 'URL',
  PHONE_NUMBER: 'Teléfono',
  COPY_CODE: 'Copiar código',
};

export const BUTTON_KINDS: readonly ButtonKind[] = [
  'QUICK_REPLY',
  'URL',
  'PHONE_NUMBER',
  'COPY_CODE',
];

export const CATEGORY_OPTIONS: { value: TemplateCategory; label: string; hint: string }[] = [
  {
    value: 'UTILITY',
    label: 'Utilidad',
    hint: 'Confirma o actualiza algo que el cliente pidió: un pedido, una cita, un pago.',
  },
  {
    value: 'MARKETING',
    label: 'Marketing',
    hint: 'Promociones, ofertas, novedades o mensajes para atraer o reactivar clientes.',
  },
  {
    value: 'AUTHENTICATION',
    label: 'Autenticación',
    hint: 'Códigos de un solo uso para verificar la identidad del cliente.',
  },
];

export const LANGUAGE_OPTIONS: { value: string; label: string }[] = [
  { value: 'es', label: 'Español (es)' },
  { value: 'es_CL', label: 'Español de Chile (es_CL)' },
  { value: 'es_PE', label: 'Español de Perú (es_PE)' },
  { value: 'es_MX', label: 'Español de México (es_MX)' },
  { value: 'es_AR', label: 'Español de Argentina (es_AR)' },
  { value: 'en_US', label: 'Inglés de EE. UU. (en_US)' },
  { value: 'pt_BR', label: 'Portugués de Brasil (pt_BR)' },
];

export const HEADER_OPTIONS: { value: HeaderFormat; label: string }[] = [
  { value: 'NONE', label: 'Ninguno' },
  { value: 'TEXT', label: 'Texto' },
  { value: 'IMAGE', label: 'Imagen' },
  { value: 'VIDEO', label: 'Video' },
  { value: 'DOCUMENT', label: 'Documento' },
];

/** `6000` -> `6.000`. Spanish locales skip the separator below 10.000, which reads inconsistently here. */
export const formatNumber = (value: number) => String(value).replace(/\B(?=(\d{3})+(?!\d))/g, '.');

const L = TEMPLATE_LIMITS;
const n = formatNumber;

/** What the conditions panel lists: hard limits Meta enforces. */
export const TEMPLATE_CONDITIONS: readonly string[] = [
  `Hasta ${n(L.templatesPerAccountUnverified)} plantillas por cuenta de WhatsApp Business (WABA) si la empresa no está verificada, y ${n(L.templatesPerAccountVerified)} si está verificada.`,
  `Máximo ${n(L.templatesPerHour)} plantillas creadas por hora.`,
  'Cada idioma cuenta como una plantilla aparte.',
  `Meta revisa cada plantilla automáticamente; la revisión puede tardar hasta ${L.reviewHours} horas.`,
  'La categoría es obligatoria y define el costo de cada envío.',
  `Encabezado opcional: texto de hasta ${L.headerTextMax} caracteres con máximo ${L.headerVariablesMax} variable, o una imagen, un video o un documento.`,
  `Cuerpo obligatorio, de hasta ${n(L.bodyMax)} caracteres.`,
  `Pie opcional, de hasta ${L.footerMax} caracteres y sin variables.`,
  `Hasta ${L.buttonsMax} botones: respuesta rápida (hasta ${BUTTON_TYPE_MAX.QUICK_REPLY}), URL (hasta ${BUTTON_TYPE_MAX.URL}), teléfono (${BUTTON_TYPE_MAX.PHONE_NUMBER}) y copiar código (${BUTTON_TYPE_MAX.COPY_CODE}). Texto de hasta ${L.buttonTextMax} caracteres; las respuestas rápidas van juntas, sin mezclarse con los otros tipos.`,
  'Cada variable necesita un valor de ejemplo.',
];

/** Meta's recommendations: not enforced here, but they can get a template rejected. */
export const TEMPLATE_RECOMMENDATIONS: readonly string[] = [
  'No empieces ni termines el cuerpo con una variable.',
  'No pongas dos variables seguidas sin texto entre ellas.',
  'No abuses de las variables en textos cortos.',
  `Si eliminas una plantilla aprobada, no puedes crear otra con el mismo nombre por ${L.deletedNameDays} días.`,
  `Las plantillas sin uso por ${L.archiveAfterMonths} meses se archivan.`,
];

/**
 * Meta's rules for editing a template ("Template management", verified): what
 * the conditions panel lists while editing.
 */
export const EDIT_CONDITIONS: readonly string[] = [
  'Solo se pueden editar plantillas aprobadas, rechazadas o pausadas.',
  `Una plantilla aprobada se puede editar hasta ${L.approvedEditsPer30Days} veces en 30 días, y ${L.approvedEditsPer24Hours} vez cada 24 horas. Las rechazadas o pausadas, sin límite.`,
  'El nombre y el idioma no se pueden cambiar; tampoco la categoría de una plantilla aprobada.',
  'La edición reemplaza todos los componentes y la plantilla vuelve a revisión.',
  `Los componentes editados no pueden superar ${n(L.editComponentsMaxChars)} caracteres.`,
];

/**
 * What the template could not confirm in Meta's or AWS's documentation:
 * shown as warnings, not as rules.
 */
export const EDIT_WARNINGS: readonly string[] = [
  'Mientras Meta revisa la edición, la plantilla puede no poder enviarse.',
  'Cambiar el formato de variables (por posición o con nombre) de una plantilla existente puede ser rechazado.',
];
