import { describe, expect, it } from 'vitest';
import { TEMPLATE_LIMITS } from './templateRules';
import { variableToken as v } from './templateStatus';
import {
  type DraftButton,
  type TemplateDraft,
  detectVariables,
  emptyDraft,
  fillExamples,
  nextPositional,
  normalizeName,
  quickRepliesGrouped,
  validateTemplate,
} from './validateTemplate';

// WhatsApp variables are built with `v` (variableToken): a literal pair of
// braces in this file would be replaced by the generator's token engine.

/** A draft that passes every rule; each test breaks one thing. */
function valid(partial: Partial<TemplateDraft> = {}): TemplateDraft {
  return {
    ...emptyDraft(),
    name: 'confirmacion_pedido',
    category: 'UTILITY',
    language: 'es',
    body: `Hola ${v('1')}, tu pedido llega el ${v('2')} entre las nueve y las trece horas.`,
    examples: { 'body:1': 'Camila', 'body:2': 'jueves' },
    ...partial,
  };
}

let buttonId = 0;
function button(type: DraftButton['type'], partial: Partial<DraftButton> = {}): DraftButton {
  buttonId += 1;
  return {
    id: `b${buttonId}`,
    type,
    text: 'Ver más',
    url: type === 'URL' ? 'https://example.com/pedido' : '',
    phone: type === 'PHONE_NUMBER' ? '+56912345678' : '',
    code: type === 'COPY_CODE' ? 'ABC123' : '',
    ...partial,
  };
}

const failing = (draft: TemplateDraft) =>
  validateTemplate(draft)
    .results.filter(result => !result.ok)
    .map(result => result.id);

const rule = (draft: TemplateDraft, id: string) =>
  validateTemplate(draft).results.find(result => result.id === id);

describe('validateTemplate', () => {
  it('accepts a complete draft with no errors or warnings', () => {
    const result = validateTemplate(valid());
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it('requires name, category, language and body', () => {
    const ids = failing({ ...emptyDraft(), language: '' });
    expect(ids).toEqual(
      expect.arrayContaining([
        'name-required',
        'category-required',
        'language-required',
        'body-required',
      ])
    );
  });

  describe('name', () => {
    it('accepts lowercase, digits and underscores only', () => {
      expect(failing(valid({ name: 'Pedido Listo' }))).toContain('name-format');
      expect(failing(valid({ name: 'pedido-listo' }))).toContain('name-format');
      expect(failing(valid({ name: 'pedido_listo_2' }))).not.toContain('name-format');
    });

    it(`allows up to ${TEMPLATE_LIMITS.nameMax} characters`, () => {
      expect(failing(valid({ name: 'a'.repeat(TEMPLATE_LIMITS.nameMax) }))).toEqual([]);
      expect(failing(valid({ name: 'a'.repeat(TEMPLATE_LIMITS.nameMax + 1) }))).toContain(
        'name-length'
      );
    });

    it('normalises what was typed into a valid name', () => {
      expect(normalizeName('Confirmación de Pedido-2')).toBe('confirmacion_de_pedido_2');
    });
  });

  describe('body', () => {
    it(`allows up to ${TEMPLATE_LIMITS.bodyMax} characters`, () => {
      const filler = 'texto '.repeat(400);
      const atLimit = valid({ body: filler.slice(0, TEMPLATE_LIMITS.bodyMax), examples: {} });
      expect(failing(atLimit)).not.toContain('body-length');
      const over = valid({ body: filler.slice(0, TEMPLATE_LIMITS.bodyMax + 1), examples: {} });
      expect(failing(over)).toContain('body-length');
    });

    it('requires positional variables numbered 1..n with no gaps', () => {
      const gap = valid({
        body: `Hola ${v('1')}, tu pedido llega el ${v('3')} entre las nueve y las trece.`,
        examples: { 'body:1': 'a', 'body:3': 'b' },
      });
      expect(failing(gap)).toContain('body-positional-sequence');

      const fromTwo = valid({
        body: `Hola ${v('2')}, tu pedido está listo para retirar en la tienda.`,
        examples: { 'body:2': 'a' },
      });
      expect(failing(fromTwo)).toContain('body-positional-sequence');

      const unordered = valid({
        body: `Llega el ${v('2')} para ti, ${v('1')}, entre las nueve y las trece horas.`,
        examples: { 'body:1': 'a', 'body:2': 'b' },
      });
      expect(failing(unordered)).not.toContain('body-positional-sequence');
    });

    it('rejects named variables in positional format and numbers in named format', () => {
      const namedInPositional = valid({
        body: `Hola ${v('nombre')}, tu pedido está listo para retirar en la tienda.`,
        examples: { 'body:nombre': 'Camila' },
      });
      expect(failing(namedInPositional)).toContain('body-variable-format');

      const numberInNamed = valid({ parameterFormat: 'NAMED' });
      expect(failing(numberInNamed)).toContain('body-variable-format');
    });

    it('requires named variables in lowercase with underscores, each used once', () => {
      const ok = valid({
        parameterFormat: 'NAMED',
        body: `Hola ${v('nombre')}, tu pedido ${v('numero_pedido')} está listo para retirar hoy.`,
        examples: { 'body:nombre': 'Camila', 'body:numero_pedido': '4821' },
      });
      expect(failing(ok)).toEqual([]);

      const upper = valid({
        parameterFormat: 'NAMED',
        body: `Hola ${v('Nombre')}, tu pedido está listo para retirar en la tienda.`,
        examples: { 'body:Nombre': 'Camila' },
      });
      expect(failing(upper)).toContain('body-variable-format');

      const repeated = valid({
        parameterFormat: 'NAMED',
        body: `Hola ${v('nombre')}, tu pedido está listo. Gracias por preferirnos, ${v('nombre')}, vuelve pronto.`,
        examples: { 'body:nombre': 'Camila' },
      });
      expect(failing(repeated)).toContain('body-named-unique');
    });
  });

  describe('header', () => {
    it(`allows text up to ${TEMPLATE_LIMITS.headerTextMax} characters`, () => {
      const at = valid({
        headerFormat: 'TEXT',
        headerText: 'a'.repeat(TEMPLATE_LIMITS.headerTextMax),
      });
      expect(failing(at)).toEqual([]);
      const over = valid({
        headerFormat: 'TEXT',
        headerText: 'a'.repeat(TEMPLATE_LIMITS.headerTextMax + 1),
      });
      expect(failing(over)).toContain('header-text-length');
    });

    it('requires text when the header is a text header', () => {
      expect(failing(valid({ headerFormat: 'TEXT', headerText: ' ' }))).toContain(
        'header-text-required'
      );
    });

    it('allows at most one variable, and it is the first one', () => {
      const one = valid({
        headerFormat: 'TEXT',
        headerText: `Pedido ${v('1')}`,
        examples: { 'body:1': 'a', 'body:2': 'b', 'header:1': '4821' },
      });
      expect(failing(one)).toEqual([]);

      const two = valid({ headerFormat: 'TEXT', headerText: `Pedido ${v('1')} ${v('2')}` });
      expect(failing(two)).toContain('header-variables-count');

      const second = valid({
        headerFormat: 'TEXT',
        headerText: `Pedido ${v('2')}`,
        examples: { 'body:1': 'a', 'body:2': 'b', 'header:2': '4821' },
      });
      expect(failing(second)).toContain('header-variable-format');
    });

    it('ignores the header text when the header is media', () => {
      const media = valid({
        headerFormat: 'IMAGE',
        headerHandle: '4::aW1n',
        headerText: `${v('1')} ${v('2')}`,
      });
      expect(failing(media)).toEqual([]);
    });
  });

  describe('footer', () => {
    it(`allows up to ${TEMPLATE_LIMITS.footerMax} characters`, () => {
      expect(failing(valid({ footer: 'a'.repeat(TEMPLATE_LIMITS.footerMax) }))).toEqual([]);
      expect(failing(valid({ footer: 'a'.repeat(TEMPLATE_LIMITS.footerMax + 1) }))).toContain(
        'footer-length'
      );
    });

    it('rejects variables', () => {
      expect(failing(valid({ footer: `Hasta pronto ${v('1')}` }))).toContain('footer-no-variables');
    });
  });

  describe('buttons', () => {
    it(`allows up to ${TEMPLATE_LIMITS.buttonsMax} buttons`, () => {
      const ten = Array.from({ length: 10 }, () => button('QUICK_REPLY'));
      expect(failing(valid({ buttons: ten }))).toEqual([]);
      const eleven = Array.from({ length: 11 }, () => button('QUICK_REPLY'));
      expect(failing(valid({ buttons: eleven }))).toEqual(
        expect.arrayContaining(['buttons-max', 'buttons-type-limits'])
      );
    });

    it('enforces the maximum of each type', () => {
      expect(failing(valid({ buttons: [button('URL'), button('URL'), button('URL')] }))).toContain(
        'buttons-type-limits'
      );
      expect(
        failing(valid({ buttons: [button('PHONE_NUMBER'), button('PHONE_NUMBER')] }))
      ).toContain('buttons-type-limits');
      expect(failing(valid({ buttons: [button('COPY_CODE'), button('COPY_CODE')] }))).toContain(
        'buttons-type-limits'
      );
      expect(
        failing(valid({ buttons: [button('URL'), button('URL'), button('PHONE_NUMBER')] }))
      ).toEqual([]);
    });

    it('rejects quick replies interleaved with other types', () => {
      const interleaved = [button('QUICK_REPLY'), button('URL'), button('QUICK_REPLY')];
      expect(failing(valid({ buttons: interleaved }))).toContain('buttons-grouping');
      expect(quickRepliesGrouped([button('URL'), button('QUICK_REPLY'), button('URL')])).toBe(
        false
      );
      expect(
        quickRepliesGrouped([button('QUICK_REPLY'), button('QUICK_REPLY'), button('URL')])
      ).toBe(true);
      expect(
        quickRepliesGrouped([button('URL'), button('PHONE_NUMBER'), button('QUICK_REPLY')])
      ).toBe(true);
    });

    it(`limits labels to ${TEMPLATE_LIMITS.buttonTextMax} characters and requires one`, () => {
      const long = button('QUICK_REPLY', { text: 'a'.repeat(TEMPLATE_LIMITS.buttonTextMax + 1) });
      expect(failing(valid({ buttons: [long] }))).toContain('buttons-text');
      expect(failing(valid({ buttons: [button('QUICK_REPLY', { text: '' })] }))).toContain(
        'buttons-text'
      );
    });

    it('validates URLs: scheme, length and one variable at the end', () => {
      const bad = (url: string) => failing(valid({ buttons: [button('URL', { url })] }));
      expect(bad('example.com')).toContain('buttons-url');
      expect(bad(`https://example.com/${'a'.repeat(TEMPLATE_LIMITS.urlMax)}`)).toContain(
        'buttons-url'
      );
      expect(bad(`https://example.com/${v('1')}/detalle`)).toContain('buttons-url');
      expect(bad(`https://example.com/${v('1')}${v('2')}`)).toContain('buttons-url');

      const withVariable = button('URL', { url: `https://example.com/pedido/${v('1')}` });
      const draft = valid({ buttons: [withVariable] });
      expect(failing(draft)).toEqual(['examples-complete']);
      draft.examples[`button:${withVariable.id}`] = '4821';
      expect(failing(draft)).toEqual([]);
    });

    it(`validates the phone number (up to ${TEMPLATE_LIMITS.phoneMax} characters)`, () => {
      const phone = (value: string) =>
        failing(valid({ buttons: [button('PHONE_NUMBER', { phone: value })] }));
      expect(phone('+56912345678')).toEqual([]);
      expect(phone('llámanos')).toContain('buttons-phone');
      expect(phone(`+${'1'.repeat(TEMPLATE_LIMITS.phoneMax)}`)).toContain('buttons-phone');
    });
  });

  describe('examples', () => {
    it('requires an example for every variable', () => {
      const draft = valid({ examples: { 'body:1': 'Camila', 'body:2': '  ' } });
      const result = rule(draft, 'examples-complete');
      expect(result?.ok).toBe(false);
      expect(result?.detail).toContain('Faltan 1');
    });

    it('lists header, body and URL button variables once each', () => {
      const url = button('URL', { url: `https://example.com/${v('1')}` });
      const draft = valid({
        headerFormat: 'TEXT',
        headerText: `Pedido ${v('1')}`,
        body: `Hola ${v('1')}, hola otra vez ${v('1')}, llega el ${v('2')}.`,
        buttons: [url],
      });
      expect(detectVariables(draft).map(variable => variable.key)).toEqual([
        'header:1',
        'body:1',
        'body:2',
        `button:${url.id}`,
      ]);
    });

    it('substitutes examples where present and keeps the variable otherwise', () => {
      const text = `Hola ${v('1')}, llega el ${v('2')}`;
      expect(fillExamples(text, { 'body:1': 'Camila' }, name => `body:${name}`)).toBe(
        `Hola Camila, llega el ${v('2')}`
      );
    });

    it('offers the next positional variable', () => {
      expect(nextPositional('Hola')).toBe('1');
      expect(nextPositional(`Hola ${v('1')} y ${v('3')}`)).toBe('4');
    });
  });

  describe("Meta's recommendations (warnings, never blocking)", () => {
    const warningIds = (draft: TemplateDraft) =>
      validateTemplate(draft).warnings.map(warning => warning.id);

    it('warns when the body starts or ends with a variable', () => {
      const draft = valid({
        body: `${v('1')}, tu pedido está listo para retirar en la tienda el ${v('2')}`,
      });
      const result = validateTemplate(draft);
      expect(warningIds(draft)).toEqual(
        expect.arrayContaining(['body-starts-with-variable', 'body-ends-with-variable'])
      );
      expect(result.valid).toBe(true);
    });

    it('ignores surrounding whitespace when looking at the start and end', () => {
      const draft = valid({
        body: `  Hola ${v('1')}, tu pedido llega el ${v('2')} entre las nueve y las trece.  `,
      });
      expect(warningIds(draft)).toEqual([]);
    });

    it('warns about two variables with no text between them', () => {
      const draft = valid({
        body: `Hola ${v('1')} ${v('2')}, tu pedido está listo para retirar en la tienda.`,
      });
      expect(warningIds(draft)).toContain('body-adjacent-variables');
      expect(validateTemplate(draft).valid).toBe(true);
    });

    it('warns about too many variables for a short text', () => {
      const draft = valid({ body: `Hola ${v('1')} y ${v('2')}.` });
      expect(warningIds(draft)).toContain('body-variable-density');
    });
  });
});

describe('media header sample', () => {
  it('needs the uploaded sample of an image, video or document header', () => {
    const ids = (draft: TemplateDraft) => validateTemplate(draft).errors.map(result => result.id);
    expect(ids(valid({ headerFormat: 'IMAGE' }))).toContain('header-media-handle');
    expect(ids(valid({ headerFormat: 'DOCUMENT', headerHandle: '4::cGRm' }))).not.toContain(
      'header-media-handle'
    );
  });
});
