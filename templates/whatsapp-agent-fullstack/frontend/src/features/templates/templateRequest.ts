import type { TemplateRequest, WhatsAppTemplate } from '@/features/whatsapp/types';
import {
  BUTTON_KINDS,
  CATEGORY_OPTIONS,
  type ButtonKind,
  type HeaderFormat,
  type TemplateCategory,
} from './templateRules';
import {
  type DraftButton,
  type TemplateDraft,
  detectVariables,
  emptyDraft,
  exampleKey,
} from './validateTemplate';

/**
 * The draft as the backend takes it (`POST /whatsapp/templates`, `PUT
 * /whatsapp/templates/{id}`). Button examples are keyed by the button's
 * position (`button:<index>`), not by its local id. On an edit, the category
 * goes only when it changed: Meta refuses changing an approved one.
 */
export function toTemplateRequest(
  draft: TemplateDraft,
  originalCategory?: string
): TemplateRequest {
  const examples: Record<string, string> = {};
  for (const variable of detectVariables(draft)) {
    const value = draft.examples[variable.key]?.trim();
    if (!value) continue;
    if (variable.scope === 'button') {
      const index = draft.buttons.findIndex(
        button => exampleKey('button', button.id) === variable.key
      );
      examples[`button:${index}`] = value;
    } else {
      examples[variable.key] = value;
    }
  }
  const header: TemplateRequest['header'] =
    draft.headerFormat === 'NONE'
      ? null
      : draft.headerFormat === 'TEXT'
        ? { format: 'TEXT', text: draft.headerText }
        : { format: draft.headerFormat, handle: draft.headerHandle };
  const keepsCategory = originalCategory !== undefined && originalCategory === draft.category;
  return {
    name: draft.name,
    language: draft.language,
    ...(keepsCategory ? {} : { category: draft.category }),
    parameterFormat: draft.parameterFormat,
    header,
    body: draft.body,
    footer: draft.footer.trim() || null,
    buttons: draft.buttons.map(button => ({
      type: button.type,
      text: button.text,
      ...(button.type === 'URL' ? { url: button.url } : {}),
      ...(button.type === 'PHONE_NUMBER' ? { phone: button.phone } : {}),
      ...(button.type === 'COPY_CODE' ? { code: button.code } : {}),
    })),
    examples,
  };
}

/** The size the backend checks: the whole definition on create, the components on edit. */
export function requestSize(request: TemplateRequest): number {
  return new TextEncoder().encode(JSON.stringify(request)).length;
}

const isCategory = (value: string): value is TemplateCategory =>
  CATEGORY_OPTIONS.some(option => option.value === value);

const isButtonKind = (value: string): value is ButtonKind =>
  (BUTTON_KINDS as readonly string[]).includes(value);

/** An existing template as the creator edits it, with the examples Meta reviewed. */
export function draftFromTemplate(template: WhatsAppTemplate): TemplateDraft {
  const buttons: DraftButton[] = template.buttons.flatMap((button, index) =>
    isButtonKind(button.type)
      ? [
          {
            id: `existing-${index}`,
            type: button.type,
            text: button.text,
            url: button.url ?? '',
            phone: button.phoneNumber ?? '',
            code: button.example ?? '',
          },
        ]
      : []
  );
  const examples: Record<string, string> = {};
  for (const [key, value] of Object.entries(template.examples)) {
    const [scope, name] = key.split(':');
    if (scope === 'button') {
      const button = buttons[Number(name)];
      if (button) examples[exampleKey('button', button.id)] = value;
    } else {
      examples[key] = value;
    }
  }
  const headerFormat: HeaderFormat = template.headerFormat ?? 'NONE';
  return {
    ...emptyDraft(),
    name: template.name,
    category: isCategory(template.category) ? template.category : '',
    language: template.language,
    parameterFormat: template.parameterFormat,
    headerFormat,
    headerText: template.header ?? '',
    headerHandle: template.headerHandle ?? '',
    headerFileName: template.headerHandle ? 'Archivo actual' : '',
    body: template.body,
    footer: template.footer ?? '',
    buttons,
    examples,
  };
}
