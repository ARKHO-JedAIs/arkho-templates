import {
  BUTTON_KINDS,
  BUTTON_TYPE_LABEL,
  BUTTON_TYPE_MAX,
  TEMPLATE_LIMITS as L,
  formatNumber,
  type ButtonKind,
  type HeaderFormat,
  type ParameterFormat,
  type TemplateCategory,
} from './templateRules';
import { variableToken } from './templateStatus';

export interface DraftButton {
  /** Local id, stable while editing; never sent. */
  id: string;
  type: ButtonKind;
  text: string;
  /** URL buttons. May end with one variable. */
  url: string;
  /** Phone buttons. */
  phone: string;
  /** Copy-code buttons: the sample code Meta reviews. */
  code: string;
}

/** A template as the creator holds it while it is being written. */
export interface TemplateDraft {
  name: string;
  category: TemplateCategory | '';
  language: string;
  parameterFormat: ParameterFormat;
  headerFormat: HeaderFormat;
  headerText: string;
  /** Meta's handle of the uploaded sample file of a media header. */
  headerHandle: string;
  /** The sample file's name, to show which one was uploaded. */
  headerFileName: string;
  body: string;
  footer: string;
  buttons: DraftButton[];
  /** Example values, by `DetectedVariable.key`. */
  examples: Record<string, string>;
}

export const emptyDraft = (): TemplateDraft => ({
  name: '',
  category: '',
  language: 'es',
  parameterFormat: 'POSITIONAL',
  headerFormat: 'NONE',
  headerText: '',
  headerHandle: '',
  headerFileName: '',
  body: '',
  footer: '',
  buttons: [],
  examples: {},
});

/* ------------------------------------------------------------------------ */
/* Variables                                                                */
/* ------------------------------------------------------------------------ */

/**
 * Anything between two pairs of braces, valid or not, so a malformed name is
 * reported rather than silently read as text. Escaped braces: a literal pair
 * would be eaten by the generator's token engine.
 */
const TOKEN = /\{\{([^{}]*)\}\}/g;

export interface Token {
  name: string;
  start: number;
  end: number;
}

export function findTokens(text: string): Token[] {
  return [...text.matchAll(TOKEN)].map(match => ({
    name: match[1]!.trim(),
    start: match.index ?? 0,
    end: (match.index ?? 0) + match[0].length,
  }));
}

const distinct = (tokens: Token[]) => [...new Set(tokens.map(token => token.name))];

const POSITIONAL_NAME = /^\d+$/;
const NAMED_NAME = /^[a-z_][a-z0-9_]*$/;

export type VariableScope = 'header' | 'body' | 'button';

export interface DetectedVariable {
  /** Where its example is kept in `TemplateDraft.examples`. */
  key: string;
  scope: VariableScope;
  name: string;
  /** Spanish, for the examples form. */
  label: string;
}

export const exampleKey = (scope: VariableScope, name: string) => `${scope}:${name}`;

/** Every variable the draft uses, once each: header, body, then URL buttons. */
export function detectVariables(draft: TemplateDraft): DetectedVariable[] {
  const found: DetectedVariable[] = [];
  if (draft.headerFormat === 'TEXT') {
    for (const name of distinct(findTokens(draft.headerText))) {
      found.push({
        key: exampleKey('header', name),
        scope: 'header',
        name,
        label: `Encabezado · ${variableToken(name)}`,
      });
    }
  }
  for (const name of distinct(findTokens(draft.body))) {
    found.push({
      key: exampleKey('body', name),
      scope: 'body',
      name,
      label: `Cuerpo · ${variableToken(name)}`,
    });
  }
  draft.buttons.forEach((button, index) => {
    if (button.type !== 'URL') return;
    const [token] = findTokens(button.url);
    if (!token) return;
    found.push({
      key: exampleKey('button', button.id),
      scope: 'button',
      name: token.name,
      label: `Botón ${index + 1} (URL) · ${variableToken(token.name)}`,
    });
  });
  return found;
}

/** The text with each variable replaced by its example, when it has one. */
export function fillExamples(
  text: string,
  examples: Record<string, string>,
  keyOf: (name: string) => string
): string {
  return text.replace(TOKEN, (whole, name: string) => {
    const value = examples[keyOf(name.trim())]?.trim();
    return value ? value : whole;
  });
}

/** The next positional variable for the body: one past the highest in use. */
export function nextPositional(body: string): string {
  const numbers = findTokens(body)
    .map(token => token.name)
    .filter(name => POSITIONAL_NAME.test(name))
    .map(Number);
  return String(numbers.length ? Math.max(...numbers) + 1 : 1);
}

/** What a template name becomes: lowercase, no accents, `_` for separators, nothing else. */
export function normalizeName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
    .replace(/[^a-z0-9_]/g, '');
}

/** A named variable as it may be written: same alphabet as a template name, not starting with a digit. */
export const normalizeVariableName = (value: string) => normalizeName(value).replace(/^\d+/, '');

/* ------------------------------------------------------------------------ */
/* Rules                                                                    */
/* ------------------------------------------------------------------------ */

export type RuleLevel = 'error' | 'warning';

export interface RuleResult {
  id: string;
  /** Errors block submitting; warnings are Meta's recommendations. */
  level: RuleLevel;
  ok: boolean;
  /** The rule, in Spanish, phrased so it reads right whether it passes or not. */
  label: string;
  /** Why it fails, when it does. */
  detail?: string;
}

export interface ValidationResult {
  results: RuleResult[];
  errors: RuleResult[];
  warnings: RuleResult[];
  /** No failing error. The conditions checkbox is the page's concern. */
  valid: boolean;
}

const URL_PATTERN = /^https?:\/\/[^\s/$.?#][^\s]*$/i;
const PHONE_PATTERN = /^\+?\d{6,19}$/;

/** True when the quick replies form one block: all before, or all after, the other buttons. */
export function quickRepliesGrouped(buttons: readonly { type: ButtonKind }[]): boolean {
  let changes = 0;
  for (let index = 1; index < buttons.length; index += 1) {
    const previous = buttons[index - 1]!.type === 'QUICK_REPLY';
    const current = buttons[index]!.type === 'QUICK_REPLY';
    if (previous !== current) changes += 1;
  }
  return changes <= 1;
}

const wordCount = (text: string) =>
  text.split(/\s+/).filter(word => /[\p{L}\p{N}]/u.test(word)).length;

/** Every rule that applies to this draft, passing or failing. Pure: same draft, same answer. */
export function validateTemplate(draft: TemplateDraft): ValidationResult {
  const results: RuleResult[] = [];
  const rule = (id: string, level: RuleLevel, ok: boolean, label: string, detail?: string) =>
    results.push({ id, level, ok, label, ...(ok || !detail ? {} : { detail }) });
  const error = (id: string, ok: boolean, label: string, detail?: string) =>
    rule(id, 'error', ok, label, detail);
  const warning = (id: string, ok: boolean, label: string, detail?: string) =>
    rule(id, 'warning', ok, label, detail);

  const named = draft.parameterFormat === 'NAMED';
  const validName = (name: string) => (named ? NAMED_NAME : POSITIONAL_NAME).test(name);
  const formatHint = named
    ? 'Con nombre: minúsculas, números y _, sin empezar por un número.'
    : 'Por posición: solo números.';

  // Name, category, language.
  error('name-required', draft.name.trim() !== '', 'La plantilla tiene nombre');
  if (draft.name.trim() !== '') {
    error(
      'name-format',
      /^[a-z0-9_]+$/.test(draft.name),
      'El nombre usa solo minúsculas, números y _',
      `Se guardaría como «${normalizeName(draft.name) || '—'}».`
    );
    error(
      'name-length',
      draft.name.length <= L.nameMax,
      `El nombre tiene hasta ${L.nameMax} caracteres`,
      `Tiene ${formatNumber(draft.name.length)}.`
    );
  }
  error('category-required', draft.category !== '', 'Tiene una categoría');
  error('language-required', draft.language.trim() !== '', 'Tiene un idioma');

  // Header.
  if (draft.headerFormat === 'TEXT') {
    const text = draft.headerText;
    const names = distinct(findTokens(text));
    error('header-text-required', text.trim() !== '', 'El encabezado de texto no está vacío');
    error(
      'header-text-length',
      text.length <= L.headerTextMax,
      `El encabezado tiene hasta ${L.headerTextMax} caracteres`,
      `Tiene ${text.length}.`
    );
    error(
      'header-variables-count',
      findTokens(text).length <= L.headerVariablesMax,
      `El encabezado tiene como máximo ${L.headerVariablesMax} variable`,
      `Tiene ${findTokens(text).length}.`
    );
    if (names.length > 0) {
      const ok = names.every(name => (named ? NAMED_NAME.test(name) : name === '1'));
      error(
        'header-variable-format',
        ok,
        'La variable del encabezado tiene el formato elegido',
        named ? formatHint : `Por posición, la variable del encabezado es ${variableToken('1')}.`
      );
    }
  } else if (draft.headerFormat !== 'NONE') {
    error(
      'header-media-handle',
      draft.headerHandle.trim() !== '',
      'El encabezado tiene su archivo de ejemplo',
      'Sube el archivo que Meta revisará con la plantilla.'
    );
  }

  // Body.
  const bodyTokens = findTokens(draft.body);
  const bodyNames = distinct(bodyTokens);
  error('body-required', draft.body.trim() !== '', 'El cuerpo no está vacío');
  error(
    'body-length',
    draft.body.length <= L.bodyMax,
    `El cuerpo tiene hasta ${formatNumber(L.bodyMax)} caracteres`,
    `Tiene ${formatNumber(draft.body.length)}.`
  );
  if (bodyNames.length > 0) {
    const wrong = bodyNames.filter(name => !validName(name));
    error(
      'body-variable-format',
      wrong.length === 0,
      'Las variables del cuerpo tienen el formato elegido',
      `${formatHint} Revisa: ${wrong.map(name => variableToken(name)).join(', ')}.`
    );
    if (!named && wrong.length === 0) {
      const numbers = bodyNames.map(Number).sort((a, b) => a - b);
      const ok = numbers.every((value, index) => value === index + 1);
      error(
        'body-positional-sequence',
        ok,
        'Las variables van numeradas de 1 en adelante, sin saltos',
        `Se esperaba ${numbers.map((_, index) => variableToken(String(index + 1))).join(', ')}.`
      );
    }
    if (named) {
      const repeated = bodyNames.filter(
        name => bodyTokens.filter(token => token.name === name).length > 1
      );
      error(
        'body-named-unique',
        repeated.length === 0,
        'Cada variable con nombre aparece una sola vez',
        `Repetidas: ${repeated.map(name => variableToken(name)).join(', ')}.`
      );
    }
  }

  // Footer.
  if (draft.footer !== '') {
    error(
      'footer-length',
      draft.footer.length <= L.footerMax,
      `El pie tiene hasta ${L.footerMax} caracteres`,
      `Tiene ${draft.footer.length}.`
    );
    error(
      'footer-no-variables',
      findTokens(draft.footer).length === 0,
      'El pie no tiene variables'
    );
  }

  // Buttons.
  const buttons = draft.buttons;
  if (buttons.length > 0) {
    error(
      'buttons-max',
      buttons.length <= L.buttonsMax,
      `Hay como máximo ${L.buttonsMax} botones`,
      `Hay ${buttons.length}.`
    );
    const over = BUTTON_KINDS.filter(
      kind => buttons.filter(button => button.type === kind).length > BUTTON_TYPE_MAX[kind]
    );
    error(
      'buttons-type-limits',
      over.length === 0,
      'Cada tipo de botón respeta su máximo',
      over.map(kind => `${BUTTON_TYPE_LABEL[kind]}: máximo ${BUTTON_TYPE_MAX[kind]}`).join('. ') +
        '.'
    );
    if (buttons.length > 1) {
      error(
        'buttons-grouping',
        quickRepliesGrouped(buttons),
        'Las respuestas rápidas van juntas, sin mezclarse con otros botones',
        'Ordénalas todas antes o todas después de los demás botones.'
      );
    }
    error(
      'buttons-text',
      buttons.every(button => button.text.trim() !== '' && button.text.length <= L.buttonTextMax),
      `Cada botón tiene texto de hasta ${L.buttonTextMax} caracteres`
    );
    const urls = buttons.filter(button => button.type === 'URL');
    if (urls.length > 0) {
      const problems = urls.flatMap(button => urlProblems(button.url));
      error(
        'buttons-url',
        problems.length === 0,
        `Cada botón URL tiene una dirección válida (http o https, hasta ${formatNumber(L.urlMax)} caracteres)`,
        [...new Set(problems)].join(' ')
      );
    }
    const phones = buttons.filter(button => button.type === 'PHONE_NUMBER');
    if (phones.length > 0) {
      error(
        'buttons-phone',
        phones.every(
          button => button.phone.length <= L.phoneMax && PHONE_PATTERN.test(button.phone)
        ),
        `El botón de teléfono tiene un número válido (con código de país, hasta ${L.phoneMax} caracteres)`,
        'Ejemplo: +56912345678.'
      );
    }
    const codes = buttons.filter(button => button.type === 'COPY_CODE');
    if (codes.length > 0) {
      error(
        'buttons-copy-code',
        codes.every(
          button => button.code.trim() !== '' && button.code.length <= L.copyCodeExampleMax
        ),
        `El botón de copiar código tiene un código de ejemplo (hasta ${L.copyCodeExampleMax} caracteres)`
      );
    }
  }

  // Examples.
  const variables = detectVariables(draft);
  if (variables.length > 0) {
    const missing = variables.filter(variable => !draft.examples[variable.key]?.trim());
    error(
      'examples-complete',
      missing.length === 0,
      'Cada variable tiene un valor de ejemplo',
      `Faltan ${missing.length}: ${missing.map(variable => variable.label).join('; ')}.`
    );
  }

  // Meta's recommendations: warnings, never blocking.
  if (bodyTokens.length > 0) {
    const trimmed = draft.body.trim();
    const offset = draft.body.indexOf(trimmed);
    warning(
      'body-starts-with-variable',
      bodyTokens[0]!.start !== offset,
      'El cuerpo no empieza con una variable'
    );
    warning(
      'body-ends-with-variable',
      bodyTokens[bodyTokens.length - 1]!.end !== offset + trimmed.length,
      'El cuerpo no termina con una variable'
    );
    const adjacent = bodyTokens.some(
      (token, index) =>
        index > 0 && draft.body.slice(bodyTokens[index - 1]!.end, token.start).trim() === ''
    );
    warning('body-adjacent-variables', !adjacent, 'No hay dos variables seguidas sin texto');
    const fixedWords = wordCount(draft.body.replace(TOKEN, ' '));
    warning(
      'body-variable-density',
      fixedWords >= bodyTokens.length * L.minWordsPerVariable,
      'El cuerpo tiene suficiente texto para sus variables',
      `Con ${bodyTokens.length} variable(s), se recomiendan al menos ${bodyTokens.length * L.minWordsPerVariable} palabras de texto fijo; hay ${fixedWords}.`
    );
  }

  const errors = results.filter(result => result.level === 'error' && !result.ok);
  const warnings = results.filter(result => result.level === 'warning' && !result.ok);
  return { results, errors, warnings, valid: errors.length === 0 };
}

function urlProblems(url: string): string[] {
  const problems: string[] = [];
  if (!url.trim()) return ['Falta la dirección.'];
  if (url.length > L.urlMax) problems.push(`Máximo ${formatNumber(L.urlMax)} caracteres.`);
  const tokens = findTokens(url);
  if (tokens.length > L.urlVariablesMax) {
    problems.push(`Máximo ${L.urlVariablesMax} variable por URL.`);
  } else if (tokens.length === 1) {
    if (tokens[0]!.end !== url.length) problems.push('La variable va al final de la URL.');
    if (tokens[0]!.name !== '1') problems.push(`La variable de la URL es ${variableToken('1')}.`);
  }
  const base = tokens.length ? url.slice(0, tokens[0]!.start) || url : url;
  if (!URL_PATTERN.test(base)) problems.push('Debe empezar con http:// o https://.');
  return problems;
}
