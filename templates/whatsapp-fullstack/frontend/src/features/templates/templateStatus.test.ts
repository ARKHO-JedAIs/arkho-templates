import { describe, expect, it } from 'vitest';
import { toTemplate } from '@/features/whatsapp/services/mappers';
import type { WhatsAppTemplate } from '@/features/whatsapp/types';
import {
  STATUS_META,
  STATUS_ORDER,
  countByStatus,
  filterTemplates,
  hasPending,
  reviewOutcomes,
  statusMeta,
  variableToken,
} from './templateStatus';

const template = (name: string, status: string, body = '', category = 'UTILITY') =>
  toTemplate({ name, status, body, category }) as WhatsAppTemplate;

const list = [
  template('recordatorio_cita', 'APPROVED', 'Te recordamos tu cita'),
  template('promocion', 'PENDING', 'Descuento en la tienda', 'MARKETING'),
  template('codigo', 'REJECTED', 'Tu código de verificación', 'AUTHENTICATION'),
  template('reactivacion', 'PAUSED', 'Te extrañamos', 'MARKETING'),
];

const names = (items: WhatsAppTemplate[]) => items.map(item => item.name);

describe('filterTemplates', () => {
  it('filters by review status', () => {
    expect(names(filterTemplates(list, '', 'PENDING'))).toEqual(['promocion']);
    expect(names(filterTemplates(list, '', 'DISABLED'))).toEqual([]);
    expect(filterTemplates(list, '', 'all')).toHaveLength(4);
  });

  it('searches name, body and category, ignoring case and accents', () => {
    expect(names(filterTemplates(list, 'CODIGO', 'all'))).toEqual(['codigo']);
    expect(names(filterTemplates(list, 'extranamos', 'all'))).toEqual(['reactivacion']);
    expect(names(filterTemplates(list, 'marketing', 'all'))).toEqual(['promocion', 'reactivacion']);
    expect(names(filterTemplates(list, 'autenticación', 'all'))).toEqual(['codigo']);
  });

  it('combines search and status', () => {
    expect(names(filterTemplates(list, 'marketing', 'PAUSED'))).toEqual(['reactivacion']);
  });
});

describe('countByStatus', () => {
  it('counts every known state, zero included', () => {
    expect(countByStatus([...list, template('raro', 'IN_APPEAL')])).toEqual({
      all: 5,
      APPROVED: 1,
      PENDING: 1,
      REJECTED: 1,
      PAUSED: 1,
      DISABLED: 0,
    });
  });
});

describe('statusMeta', () => {
  it('gives every known state a label and an icon, not just a colour', () => {
    for (const status of STATUS_ORDER) {
      expect(statusMeta(status).label).toBe(STATUS_META[status].label);
      expect(statusMeta(status).icon).toBeTruthy();
    }
    expect(statusMeta('APPROVED').label).toBe('Aprobada');
    expect(statusMeta('PENDING').label).toBe('En revisión');
  });

  it('shows an unknown state as Meta sent it', () => {
    expect(statusMeta('IN_APPEAL').label).toBe('IN_APPEAL');
  });
});

describe('variableToken', () => {
  it('writes the variable the way WhatsApp does', () => {
    expect(variableToken('1')).toBe('{'.repeat(2) + '1' + '}'.repeat(2));
  });
});

describe('review polling', () => {
  it('polls only while something is in review', () => {
    expect(hasPending(list)).toBe(true);
    expect(hasPending(list.filter(item => item.status !== 'PENDING'))).toBe(false);
  });

  it('reports the templates that left review approved or rejected', () => {
    const before = [
      template('a', 'PENDING'),
      template('b', 'PENDING'),
      template('c', 'PENDING'),
      template('d', 'APPROVED'),
    ];
    const after = [
      template('a', 'APPROVED'),
      template('b', 'REJECTED'),
      template('c', 'PENDING'),
      template('d', 'APPROVED'),
      template('e', 'APPROVED'),
    ];
    expect(reviewOutcomes(before, after).map(outcome => [outcome.name, outcome.status])).toEqual([
      ['a', 'APPROVED'],
      ['b', 'REJECTED'],
    ]);
  });
});
