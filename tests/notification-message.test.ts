import { describe, expect, it } from 'vitest';
import { notificationTestMessage, validateNotificationTestResult } from '../src/shared/notifications';

describe('notification diagnostics contract', () => {
  it('validates results and rejects malformed or inconsistent replies', () => {
    expect(validateNotificationTestResult({ status: 'accepted', permissionLevel: 'granted', registered: true })).toEqual({
      status: 'accepted', permissionLevel: 'granted', registered: true });
    for (const value of [null, [], { status: 'displayed', permissionLevel: 'granted', registered: true },
      { status: 'blocked', permissionLevel: 'granted', registered: null },
      { status: 'api-error', permissionLevel: 'unknown', registered: true },
      { status: 'accepted', permissionLevel: 'granted', registered: 'yes' }]) {
      expect(validateNotificationTestResult(value)).toBeNull();
    }
  });

  it('never presents Chrome registration as proof of a visible popup', () => {
    const text = notificationTestMessage({ status: 'accepted', permissionLevel: 'granted', registered: true });
    expect(text).toContain('Dit bevestigt niet dat je besturingssysteem de pop-up toont');
    expect(text).toContain('meldingsinstellingen voor Google Chrome');
    expect(notificationTestMessage({ status: 'blocked', permissionLevel: 'denied', registered: null })).toContain('geblokkeerd');
  });
});
