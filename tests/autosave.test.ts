import { afterEach, describe, expect, it, vi } from 'vitest';
import { savePreferences } from '../src/ui/autosave';
import { DEFAULT_PREFERENCES } from '../src/shared/preferences';

afterEach(() => vi.unstubAllGlobals());

describe('immediate setting handoff', () => {
  it('hands off a reversal before an earlier worker reply resolves', async () => {
    const pending: { resolve: (value: unknown) => void }[] = [];
    const sendMessage = vi.fn<(message: unknown) => Promise<unknown>>(() => new Promise((resolve) => pending.push({ resolve })));
    vi.stubGlobal('chrome', { runtime: { sendMessage } });
    const enabled = { ...DEFAULT_PREFERENCES, notificationsEnabled: true };
    const disabled = { ...enabled, notificationsEnabled: false };
    const first = savePreferences(enabled);
    const last = savePreferences(disabled);
    expect(sendMessage.mock.calls).toEqual([
      [{ type: 'preferences.save', preferences: enabled }],
      [{ type: 'preferences.save', preferences: disabled }],
    ]);
    const reply = { ok: true, notificationPermission: false, browserPermission: false,
      monitoringScheduled: false, nextCheckAt: null, retryAt: null };
    pending[1]!.resolve({ ...reply, preferences: disabled });
    await expect(last).resolves.toMatchObject({ preferences: disabled });
    pending[0]!.resolve({ ...reply, preferences: enabled });
    await first;
  });

  it('reports a rejected write without blocking the next edit', async () => {
    const reply = { ok: true, preferences: DEFAULT_PREFERENCES, notificationPermission: false,
      browserPermission: false, monitoringScheduled: false, nextCheckAt: null, retryAt: null };
    vi.stubGlobal('chrome', { runtime: { sendMessage: vi.fn()
      .mockResolvedValueOnce({ ok: false }).mockResolvedValueOnce(reply) } });
    await expect(savePreferences(DEFAULT_PREFERENCES)).rejects.toThrow('Preferences unavailable');
    await expect(savePreferences(DEFAULT_PREFERENCES)).resolves.toEqual(reply);
  });
});
