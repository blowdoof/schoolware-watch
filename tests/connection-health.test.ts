import { describe, expect, it } from 'vitest';
import { connectionHealth } from '../src/ui/ConnectionNotice';
import { validateConnectionState, type ConnectionState } from '../src/shared/connection';
import { requestUrl } from './fixtures/agenda-request';

describe('connection health', () => {
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
