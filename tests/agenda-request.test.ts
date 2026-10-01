import { describe, expect, it } from 'vitest';
import { validateAgendaRequest } from '../src/schoolware/agenda-request';
import { requestUrl } from './fixtures/agenda-request';
import { isExtensionPage, validateConnectionMessage, validateConnectionState } from '../src/shared/connection';

describe('request boundary', () => {
  it('preserves the supplied agenda list and date coverage', () => {
    const normalized = validateAgendaRequest(requestUrl);
    expect(normalized).not.toBeNull();
    const url = new URL(normalized!);
    expect(url.searchParams.get('AgendaID')).toBe('10,10,20');
    expect(url.searchParams.get('MinTot')).toBe('2026-10-01');
    expect(url.searchParams.get('MaxVan')).toBe('2026-10-31');
    expect(validateAgendaRequest(normalized)).toBe(normalized);
  });

  it.each([
    requestUrl.replace('https:', 'http:'),
    requestUrl.replace('schoolware_siw.ksgwl.be', 'schoolware_siw.ksgwl.be.example.com'),
    requestUrl.replace('AgendaPunt?', 'OtherResource?'),
    requestUrl.replace('https://', 'https://user:password@'),
    `${requestUrl}#fragment`, `${requestUrl}&token=synthetic-secret`,
    `${requestUrl}&AgendaID=40`, requestUrl.replace('&CompletedTaskForLL=30', ''),
    requestUrl.replace('AgendaID=10,10,20', 'AgendaID=10,,20'),
    requestUrl.replace('CompletedTaskForLL=30', 'CompletedTaskForLL=NaN'),
    requestUrl.replace('MinTot=2026-10-01', 'MinTot=2026-02-30'),
    requestUrl.replace('MaxVan=2026-10-31', 'MaxVan=2026-09-30'),
  ])('rejects destinations and parameter shapes outside the verified contract', (value) => {
    expect(validateAgendaRequest(value)).toBeNull();
  });
});

describe('message and state boundary', () => {
  it('accepts checks only after request validation', () => {
    expect(validateConnectionMessage({ type: 'agenda.check', requestUrl })).toEqual({
      type: 'agenda.check', requestUrl: validateAgendaRequest(requestUrl),
    });
    expect(validateConnectionMessage({ type: 'agenda.check', requestUrl, cookie: 'synthetic-secret' })).toBeNull();
    expect(validateConnectionMessage({ type: 'agenda.check', requestUrl: 'https://example.com/' })).toBeNull();
    expect(validateConnectionMessage({ type: 'connection.clear', cookie: 'synthetic-secret' })).toBeNull();
  });

  it('rejects messages from web pages, content scripts or other extensions', () => {
    const id = 'syntheticextension';
    expect(isExtensionPage({ id, url: `chrome-extension://${id}/options.html` }, id)).toBe(true);
    expect(isExtensionPage({ id, url: requestUrl }, id)).toBe(false);
    expect(isExtensionPage({ id: 'otherextension', url: `chrome-extension://${id}/options.html` }, id)).toBe(false);
    expect(isExtensionPage({ id }, id)).toBe(false);
  });

  it('projects stored and received status onto an allowlist', () => {
    const state = { requestUrl, lastCheck: { status: 'success', checkedAt: '2026-10-01T18:00:00.000Z', count: 2,
      rawResponse: 'synthetic-private' }, cookie: 'synthetic-secret' };
    expect(validateConnectionState(state)).toEqual({ requestUrl: validateAgendaRequest(requestUrl),
      lastCheck: { status: 'success', checkedAt: '2026-10-01T18:00:00.000Z', count: 2 } });
    expect(validateConnectionState({ ...state, lastCheck: { ...state.lastCheck, count: -1 } })).toBeNull();
    expect(validateConnectionState({ ...state, lastCheck: { ...state.lastCheck, status: 'unknown' } })).toBeNull();
    expect(validateConnectionState({ ...state, requestUrl: 'https://example.com/' })).toBeNull();
  });

  it('validates category totals while preserving older count-only summaries', () => {
    const base = { requestUrl, lastCheck: { status: 'success', checkedAt: '2026-10-01T18:00:00.000Z', count: 6 } };
    expect(validateConnectionState(base)?.lastCheck).not.toHaveProperty('typeCounts');
    const typeCounts = { tests: 1, assignments: 1, review: 2, other: 2 };
    expect(validateConnectionState({ ...base, lastCheck: { ...base.lastCheck, typeCounts } })?.lastCheck?.typeCounts).toEqual(typeCounts);
    for (const invalid of [null, [], { ...typeCounts, tests: -1 }, { ...typeCounts, tests: 2 },
      { tests: 1, assignments: 1, other: 4 }, { ...typeCounts, review: '2' }]) {
      expect(validateConnectionState({ ...base, lastCheck: { ...base.lastCheck, typeCounts: invalid } })).toBeNull();
    }
    expect(validateConnectionState({ ...base, lastCheck: { ...base.lastCheck, status: 'timeout', count: null, typeCounts } })).toBeNull();
  });
});
