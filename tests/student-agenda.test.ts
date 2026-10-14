import { describe, expect, it } from 'vitest';
import { agendaProfileKey, isSchoolwarePage, validateAgendaRequest } from '../src/schoolware/agenda-request';
import { monitoringRequest, requestCoverage } from '../src/schoolware/monitoring-request';
import { createObservationInput } from '../src/schoolware/observation-input';
import { validateAgendaResponse } from '../src/schoolware/agenda-response';
import { progressItemKey, progressVersion } from '../src/domain/progress-sync';
import fixture from './fixtures/synthetic-agenda.json';
import { requestUrl } from './fixtures/agenda-request';

export const studentRequestUrl = 'https://schoolware_siw.ksgwl.be/webleerling/bin/server.fcgi/REST/AgendaPunt/?_dc=123456789&MaxVan=2026-10-31T00%3A00%3A00&MinTot=2026-10-01T00%3A00%3A00&Agenda=10%2C20&NietMappen=20&MapAgendasOp=10&page=1&start=0&limit=0';

describe('student agenda integration contract', () => {
  it('accepts only the observed student request and removes the transient cache buster', () => {
    const normalized = validateAgendaRequest(studentRequestUrl)!;
    expect(normalized).not.toBeNull();
    expect(new URL(normalized).searchParams.has('_dc')).toBe(false);
    expect(validateAgendaRequest(normalized)).toBe(normalized);
    expect(validateAgendaRequest(studentRequestUrl.replace('AgendaPunt/', 'AgendaPunt'))).toBe(normalized);
    expect(isSchoolwarePage('https://synthetic-school.example/webleerling/start.html#!fn=llagenda')).toBe(true);
  });
  it.each(['&token=secret', '&Agenda=30', '&_dc=456'])('rejects extra or duplicated parameters: %s', (suffix) => {
    expect(validateAgendaRequest(studentRequestUrl + suffix)).toBeNull();
  });
  it.each([
    ['page=1', 'page=2'], ['start=0', 'start=20'], ['limit=0', 'limit=20'],
    ['NietMappen=20', 'NietMappen=NaN'], ['MapAgendasOp=10', 'MapAgendasOp=0'],
    ['2026-10-31T', '2026-02-30T'], ['00%3A00%3A00', '12%3A00%3A00'],
    ['AgendaPunt/', 'OtherResource/'], ['https:', 'http:'],
  ])('fails closed for unsupported student request variants', (from, to) => {
    expect(validateAgendaRequest(studentRequestUrl.replace(from, to))).toBeNull();
  });
  it('refreshes date coverage without changing student selection or profile identity', () => {
    const updated = monitoringRequest(studentRequestUrl, new Date('2026-10-11T12:00:00Z'), 3);
    expect(requestCoverage(updated)).toEqual({ minTot: '2026-10-04', maxVan: '2026-10-26' });
    expect(new URL(updated).searchParams.get('MinTot')).toBe('2026-10-04T00:00:00');
    expect(agendaProfileKey(updated)).toBe(agendaProfileKey(studentRequestUrl));
    expect(agendaProfileKey(studentRequestUrl.replace('Agenda=10%2C20', 'Agenda=10%2C30'))).not.toBe(agendaProfileKey(updated));
    expect(agendaProfileKey(updated)).not.toBe(agendaProfileKey(requestUrl));
  });
  it('preserves shared task keys and content versions across separate parent/student scopes', async () => {
    const response = validateAgendaResponse(fixture);
    if (!response.ok) throw new Error('Invalid synthetic response');
    const parent = createObservationInput(requestUrl, response.points, 'parent', '2026-10-11T12:00:00Z');
    const student = createObservationInput(studentRequestUrl, response.points, 'student', '2026-10-11T12:00:00Z');
    expect(student.scopeId).not.toBe(parent.scopeId);
    expect(student.complete).toBe(false);
    for (const [index, point] of student.points.entries()) {
      const other = parent.points[index]!;
      expect(await progressItemKey('a'.repeat(64), point.sourceKey)).toBe(await progressItemKey('a'.repeat(64), other.sourceKey));
      expect(await progressVersion(point.snapshot)).toBe(await progressVersion(other.snapshot));
    }
  });
});
