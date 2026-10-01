import { describe, expect, it } from 'vitest';
import fixture from './fixtures/synthetic-agenda.json';
import { parseAgendaResponse, validateAgendaResponse } from '../src/schoolware/agenda-response';

const first = fixture.data[0]!;

describe('Schoolware response validation', () => {
  it('preserves large IDs, unknown types, repeated source IDs and offsetless dates', () => {
    const result = validateAgendaResponse(fixture);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('Synthetic fixture should validate');
    expect(result.points).toHaveLength(2);
    expect(result.points[0]?.ID).toBe(41000000001);
    expect(result.points[0]?.Van).toBe('2026-10-01 09:00:00');
    expect(result.points[0]?.GeldigVan).toBe('2026-09-01 00:00:00');
    expect(result.points[1]?.TypePunt).toBe(9876);
    expect(result.points[0]?.UniekAgendaPuntID).toBe(result.points[1]?.UniekAgendaPuntID);
    expect(result.points[0]).not.toHaveProperty('OrigineelPuntID');
    expect(result.points[1]?.OrigineelPuntID).toBe(400);
    expect(result.completeness).toBe('unverified');
  });

  it('drops extra personal fields and does not generate observation timestamps', () => {
    const result = validateAgendaResponse(fixture);
    if (!result.ok) throw new Error('Synthetic fixture should validate');
    for (const point of result.points) {
      expect(point).not.toHaveProperty('AgendaOmschrijving');
      expect(point).not.toHaveProperty('PersoneelNaam');
      expect(point).not.toHaveProperty('Commentaar');
      expect(point).not.toHaveProperty('firstSeenAt');
      expect(point).not.toHaveProperty('createdAt');
    }
  });

  it('never turns API failure or malformed envelopes into empty agendas', () => {
    expect(validateAgendaResponse({ success: false, data: [] })).toEqual({ ok: false, reason: 'api-failure' });
    for (const value of [null, [], {}, { success: 'true', data: [] }, { success: true, data: {} }]) {
      expect(validateAgendaResponse(value)).toEqual({ ok: false, reason: 'invalid-response' });
    }
  });

  it('keeps even a valid empty response incomplete until coverage is verified', () => {
    expect(validateAgendaResponse({ success: true, data: [], total: 0 })).toEqual({
      ok: true, points: [], completeness: 'unverified',
    });
  });

  it.each([
    ['ID', '41000000001'], ['ID', Number.MAX_SAFE_INTEGER + 1], ['ID', 1.5],
    ['AgendaID', -1], ['UniekAgendaPuntID', null], ['TypePunt', undefined],
    ['Titel', null], ['OrigineelPuntID', null], ['HerhaaldAgendaPuntID', '300'],
    ['Van', '2026-02-30 09:00:00'], ['Tot', '2026-10-01 24:00:00'],
    ['GeldigVan', ''], ['Herhaling', false], ['Verborgen', 'false'], ['Vervalt', 0],
  ])('rejects an invalid %s without returning the valid preceding item', (field, value) => {
    const result = validateAgendaResponse({ success: true, data: [first, { ...first, [field]: value }] });
    expect(result).toEqual({ ok: false, reason: 'invalid-item', index: 1, field });
    expect(result).not.toHaveProperty('points');
  });

  it('rejects null array entries', () => {
    expect(validateAgendaResponse({ success: true, data: [null] })).toEqual({
      ok: false, reason: 'invalid-item', index: 0, field: null,
    });
  });

  it('reports invalid JSON or login HTML without exposing input', () => {
    for (const text of ['{"synthetic-secret":', '<html>Login required</html>']) {
      expect(parseAgendaResponse(text)).toEqual({ ok: false, reason: 'invalid-json' });
    }
    expect(parseAgendaResponse(JSON.stringify(fixture))).toEqual(validateAgendaResponse(fixture));
  });

  it('validates leap days without interpreting the source timezone', () => {
    expect(validateAgendaResponse({ success: true, data: [{ ...first, Van: '2028-02-29 09:00:00' }] }).ok).toBe(true);
    expect(validateAgendaResponse({ success: true, data: [{ ...first, Van: '2026-02-29 09:00:00' }] }).ok).toBe(false);
  });
});
