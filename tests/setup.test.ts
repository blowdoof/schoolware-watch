import { describe, expect, it } from 'vitest';
import { requiredSetupStep, setupAlreadyConfigured } from '../src/shared/setup';
import { EMPTY_CONNECTION, type ConnectionState } from '../src/shared/connection';
import { DEFAULT_PREFERENCES, type PreferencesView } from '../src/shared/preferences';
import { isSchoolwarePage, schoolwareOrigin, schoolwarePermission, validateAgendaRequest } from '../src/schoolware/agenda-request';
import { progressItemKey } from '../src/domain/progress-sync';
import { classifyAgendaType } from '../src/schoolware/agenda-types';
import { requestUrl } from './fixtures/agenda-request';

const connected: ConnectionState = { requestUrl, lastCheck: { status: 'success', count: 2, checkedAt: '2026-10-05T08:00:00Z' } };
const preferences: PreferencesView = { ok: true, preferences: DEFAULT_PREFERENCES,
  notificationPermission: false, browserPermission: false, monitoringScheduled: true, nextCheckAt: null, retryAt: null };

describe('guided setup and recovery', () => {
  it('recognizes a configured installation from before the setup marker existed', () => {
    expect(setupAlreadyConfigured(undefined, connected, DEFAULT_PREFERENCES)).toBe(true);
    expect(requiredSetupStep(connected, true, preferences, setupAlreadyConfigured(undefined, connected, DEFAULT_PREFERENCES))).toBeNull();
    expect(setupAlreadyConfigured(undefined, EMPTY_CONNECTION, DEFAULT_PREFERENCES)).toBe(false);
    expect(setupAlreadyConfigured(undefined, connected, undefined)).toBe(false);
    expect(setupAlreadyConfigured(false, connected, DEFAULT_PREFERENCES)).toBe(false);
    expect(setupAlreadyConfigured(undefined, connected, { invalid: true })).toBe(false);
  });
  it('requires a successful first connection before proceeding', () => {
    expect(requiredSetupStep(EMPTY_CONNECTION, false, preferences, false)).toBe('connection');
    expect(requiredSetupStep(connected, false, preferences, false)).toBe('connection');
    expect(requiredSetupStep({ ...connected, lastCheck: null }, true, preferences, false)).toBe('connection');
    expect(requiredSetupStep({ ...connected, lastCheck: { ...connected.lastCheck!, status: 'network-error', count: null } }, true, preferences, false)).toBe('connection');
    expect(requiredSetupStep(connected, true, preferences, false)).toBe('preferences');
  });
  it('does not require optional sharing or optional notifications', () => {
    expect(requiredSetupStep(connected, true, preferences, true)).toBeNull();
    expect(requiredSetupStep({ ...connected, lastCheck: null }, true, preferences, true)).toBeNull();
  });
  it('returns to the relevant step when access or an enabled notification permission is lost', () => {
    expect(requiredSetupStep(connected, false, preferences, true)).toBe('connection');
    expect(requiredSetupStep({ ...connected, lastCheck: { ...connected.lastCheck!, status: 'session-required', count: null } }, true, preferences, true)).toBe('connection');
    for (const flag of ['notificationsEnabled', 'browserNotificationsEnabled'] as const) {
      expect(requiredSetupStep(connected, true, { ...preferences, preferences: { ...DEFAULT_PREFERENCES, [flag]: true } }, true)).toBe('preferences');
    }
  });
});

describe('user-selected installation boundaries', () => {
  it('normalizes a public HTTPS website and requests only its exact origin', () => {
    const url = requestUrl.replace('schoolware_siw.ksgwl.be', 'synthetic.schoolware.be');
    expect(schoolwareOrigin(url)).toBe('https://synthetic.schoolware.be');
    expect(schoolwarePermission(url)).toBe('https://synthetic.schoolware.be/*');
    expect(new URL(validateAgendaRequest(url)!).origin).toBe('https://synthetic.schoolware.be');
    expect(isSchoolwarePage('https://synthetic.schoolware.be/')).toBe(true);
    expect(isSchoolwarePage('https://synthetic-school.example/webouders/start.html')).toBe(true);
    expect(isSchoolwarePage('https://unrelated.example/news')).toBe(false);
    expect(classifyAgendaType('https://synthetic.schoolware.be', 1001)).toBe('assignments');
  });
  it.each(['http://school.example', 'https://user:secret@school.example', 'https://localhost',
    'https://127.0.0.1', 'https://[::1]', 'https://school.local', 'https://school.example:8443'])('rejects unsafe installation addresses: %s', (value) => {
    expect(schoolwareOrigin(value)).toBeNull();
  });
  it('keeps existing encrypted progress keys and separates identical source IDs across installations', async () => {
    const key = 'ab'.repeat(32);
    const legacy = await progressItemKey(key, 'synthetic-source');
    expect(await progressItemKey(key, 'synthetic-source', 'https://schoolware_siw.ksgwl.be')).toBe(legacy);
    expect(await progressItemKey(key, 'synthetic-source', 'https://synthetic.schoolware.be')).not.toBe(legacy);
  });
});
