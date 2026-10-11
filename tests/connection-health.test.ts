import { describe, expect, it } from 'vitest';
import { agendaStatus, connectionHealth, sharingStatus, summaryStatus } from '../src/ui/ConnectionNotice';
import { validateConnectionState, type ConnectionState } from '../src/shared/connection';
import { requestUrl } from './fixtures/agenda-request';

describe('connection health', () => {
  it('reports agenda and sharing health independently, including disabled and unconfirmed sharing', () => {
    const connection: ConnectionState = { requestUrl, lastCheck: { status: 'success', checkedAt: '2026-10-11T08:00:00Z', count: 1 } };
    const sync = { ok: true, enabled: true, pending: 0, error: false, lastSuccessAt: '2026-10-11T08:00:00Z' };
    expect(agendaStatus(connection, false)).toBe('ok');
    expect(sharingStatus({ ...sync, error: true }, false)).toBe('issue');
    expect(agendaStatus({ ...connection, lastCheck: { ...connection.lastCheck!, status: 'network-error' } }, false)).toBe('issue');
    expect(sharingStatus(sync, false)).toBe('ok');
    expect(sharingStatus({ ...sync, enabled: false }, false)).toBe('unknown');
    for (const change of [{ pending: 1 }, { receiving: true }, { registrationPending: true }, { lastSuccessAt: null }])
      expect(sharingStatus({ ...sync, ...change }, false)).toBe('unknown');
    expect(sharingStatus({ ...sync, checking: true }, false)).toBe('busy');
    expect(sharingStatus(sync, true)).toBe('issue');
    expect(agendaStatus(connection, true)).toBe('issue');
  });
  it('never confirms pending, partially received or failed shared changes as synchronized', () => {
    const connection: ConnectionState = { requestUrl, lastCheck: { status: 'success', checkedAt: '2026-10-11T08:00:00Z', count: 1 } };
    const sync = { ok: true, enabled: true, pending: 0, error: false, lastSuccessAt: '2026-10-11T08:00:00Z' };
    expect(summaryStatus(connection, sync, false)).toBe('ok');
    for (const change of [{ pending: 1 }, { receiving: true }, { registrationPending: true }, { lastSuccessAt: null }])
      expect(summaryStatus(connection, { ...sync, ...change }, false)).toBe('unknown');
    for (const change of [{ error: true }, { blocked: true }, { membersError: true }])
      expect(summaryStatus(connection, { ...sync, ...change }, false)).toBe('issue');
    expect(summaryStatus(connection, { ...sync, checking: true }, false)).toBe('busy');
    expect(summaryStatus({ ...connection, lastCheck: { ...connection.lastCheck!, status: 'busy' } }, sync, false)).toBe('busy');
    expect(summaryStatus({ ...connection, lastCheck: { ...connection.lastCheck!, status: 'network-error' } }, sync, false)).toBe('issue');
    expect(summaryStatus(connection, sync, true)).toBe('issue');
    expect(summaryStatus({ requestUrl: null, lastCheck: null }, null, false)).toBe('unknown');
  });
  it('distinguishes missing connection, login, permission and transient failure', () => {
    const state: ConnectionState = { requestUrl, lastCheck: null };
    expect(connectionHealth({ ...state, requestUrl: null })).toContain('niet gekoppeld');
    expect(connectionHealth(state)).toContain('nog geen controle');
    for (const status of ['session-required', 'redirected'] as const) {
      expect(connectionHealth({ ...state, lastCheck: { status, checkedAt: '2026-10-05T10:00:00Z', count: null } })).toContain('Opnieuw aanmelden');
    }
    expect(connectionHealth({ ...state, lastCheck: { status: 'permission-required', checkedAt: '2026-10-05T10:00:00Z', count: null } })).toContain('Toegang');
    expect(connectionHealth({ ...state, lastCheck: { status: 'network-error', checkedAt: '2026-10-05T10:00:00Z', count: null } })).not.toContain('aanmelden');
  });
  it('validates the independently retained successful-check timestamp', () => {
    const state = { requestUrl, lastCheck: null, lastSuccessAt: '2026-10-05T10:00:00Z' };
    expect(validateConnectionState(state)).toMatchObject({ lastCheck: null, lastSuccessAt: state.lastSuccessAt });
    expect(validateConnectionState({ ...state, lastSuccessAt: 'invalid' })).toBeNull();
    expect(validateConnectionState({ ...state, lastSuccessAt: 123 })).toBeNull();
  });
});
