import { describe, expect, it } from 'vitest';
import { toTemplate } from '@/features/whatsapp/services/mappers';
import { draftFromTemplate, toTemplateRequest } from './templateRequest';
import { variableToken as v } from './templateStatus';
import { emptyDraft, validateTemplate, type TemplateDraft } from './validateTemplate';

const draft = (patch: Partial<TemplateDraft> = {}): TemplateDraft => ({
  ...emptyDraft(),
  name: 'confirmacion_pedido',
  category: 'UTILITY',
  language: 'es',
  headerFormat: 'TEXT',
  headerText: `Pedido ${v('1')}`,
  body: `Hola ${v('1')}, tu pedido llega el ${v('2')}.`,
  footer: '  ',
  buttons: [
    { id: 'a', type: 'QUICK_REPLY', text: 'Ok', url: '', phone: '', code: '' },
    {
      id: 'b',
      type: 'URL',
      text: 'Seguir',
      url: `https://example.com/${v('1')}`,
      phone: '',
      code: '',
    },
  ],
  examples: { 'header:1': 'A-1', 'body:1': 'Ana', 'body:2': 'lunes', 'button:b': 'A-1' },
  ...patch,
});

describe('toTemplateRequest', () => {
  it('builds the backend request, keying button examples by position', () => {
    expect(toTemplateRequest(draft())).toEqual({
      name: 'confirmacion_pedido',
      language: 'es',
      category: 'UTILITY',
      parameterFormat: 'POSITIONAL',
      header: { format: 'TEXT', text: `Pedido ${v('1')}` },
      body: `Hola ${v('1')}, tu pedido llega el ${v('2')}.`,
      footer: null,
      buttons: [
        { type: 'QUICK_REPLY', text: 'Ok' },
        { type: 'URL', text: 'Seguir', url: `https://example.com/${v('1')}` },
      ],
      examples: { 'header:1': 'A-1', 'body:1': 'Ana', 'body:2': 'lunes', 'button:1': 'A-1' },
    });
  });

  it('sends a media header by its handle', () => {
    const request = toTemplateRequest(draft({ headerFormat: 'IMAGE', headerHandle: '4::aW1n' }));
    expect(request.header).toEqual({ format: 'IMAGE', handle: '4::aW1n' });
    expect(request.examples).not.toHaveProperty('header:1');
  });

  it('leaves the category out of an edit that keeps it', () => {
    expect(toTemplateRequest(draft(), 'UTILITY')).not.toHaveProperty('category');
    expect(toTemplateRequest(draft({ category: 'MARKETING' }), 'UTILITY').category).toBe(
      'MARKETING'
    );
  });
});

describe('draftFromTemplate', () => {
  it('prefills the creator with what the template has, round trip included', () => {
    const template = toTemplate({
      name: 'confirmacion_pedido',
      language: 'es',
      category: 'UTILITY',
      status: 'APPROVED',
      header: `Pedido ${v('1')}`,
      headerFormat: 'TEXT',
      body: `Hola ${v('1')}, tu pedido llega el ${v('2')}.`,
      buttons: [
        { type: 'QUICK_REPLY', text: 'Ok' },
        { type: 'URL', text: 'Seguir', url: `https://example.com/${v('1')}` },
        { type: 'PHONE_NUMBER', text: 'Llamar', phoneNumber: '+56911111111' },
      ],
      examples: { 'header:1': 'A-1', 'body:1': 'Ana', 'body:2': 'lunes', 'button:1': 'A-1' },
    })!;
    const prefilled = draftFromTemplate(template);
    expect(prefilled.headerText).toBe(`Pedido ${v('1')}`);
    expect(prefilled.buttons.map(button => button.type)).toEqual([
      'QUICK_REPLY',
      'URL',
      'PHONE_NUMBER',
    ]);
    expect(prefilled.buttons[2]!.phone).toBe('+56911111111');
    expect(validateTemplate(prefilled).valid).toBe(true);
    expect(toTemplateRequest(prefilled, template.category).examples).toEqual(template.examples);
  });

  it('keeps the handle of a media header so it does not need a new upload', () => {
    const template = toTemplate({
      name: 'foto',
      body: 'Mira',
      headerFormat: 'VIDEO',
      headerHandle: '4::dmlk',
    })!;
    const prefilled = draftFromTemplate(template);
    expect(prefilled.headerFormat).toBe('VIDEO');
    expect(prefilled.headerHandle).toBe('4::dmlk');
  });
});
