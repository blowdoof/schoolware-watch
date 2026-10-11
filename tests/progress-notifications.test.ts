import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { notifyProgressChange } from '../src/background/progress-notifications';
import { DEFAULT_PREFERENCES, PREFERENCES_KEY } from '../src/shared/preferences';
import type { ActivityReporter } from '../src/shared/activity';

const id = '12345678-1234-1234-1234-123456789abc';
const create = vi.fn();
const report = vi.fn<ActivityReporter>();
const get = vi.fn();
const contains = vi.fn();
beforeEach(() => {
  vi.resetAllMocks(); create.mockResolvedValue('accepted'); report.mockResolvedValue(undefined);
  get.mockResolvedValue({ [PREFERENCES_KEY]: { ...DEFAULT_PREFERENCES, notificationsEnabled: true } });
  contains.mockResolvedValue(true);
  vi.stubGlobal('chrome', {
    storage: { local: { get } }, permissions: { contains },
    notifications: { create }, runtime: { getURL: (path: string) => `chrome-extension://synthetic/${path}` },
  });
});
afterEach(() => vi.unstubAllGlobals());
describe('received progress notifications', () => {
  it('uses generic text and records delivery without task or participant content', async () => {
    await notifyProgressChange(id, false, report);
    expect(create).toHaveBeenCalledWith(`schoolware-watch-progress-${id}`, expect.objectContaining({
      message: 'Gedeelde taakvoortgang of planning is bijgewerkt. Open het overzicht voor de actuele stand.',
    }));
    expect(report).toHaveBeenCalledWith('notification.progress', 'succeeded', { reason: 'accepted' });
  });
  it('keeps the initial download silent', async () => {
    await notifyProgressChange(id, true, report);
    expect(create).not.toHaveBeenCalled();
    expect(report).toHaveBeenCalledWith('notification.progress', 'skipped', { reason: 'unchanged' });
  });
  it('respects disabled notifications', async () => {
    get.mockResolvedValue({ [PREFERENCES_KEY]: DEFAULT_PREFERENCES });
    await notifyProgressChange(id, false, report);
    expect(create).not.toHaveBeenCalled();
    expect(report).toHaveBeenCalledWith('notification.progress', 'skipped', { reason: 'disabled' });
  });
  it('respects missing permission', async () => {
    contains.mockResolvedValue(false);
    await notifyProgressChange(id, false, report);
    expect(create).not.toHaveBeenCalled();
    expect(report).toHaveBeenCalledWith('notification.progress', 'skipped', { reason: 'permission-required' });
  });
  it('logs API failure without rejecting the applied synchronization', async () => {
    create.mockRejectedValue(new Error('Synthetic failure'));
    await expect(notifyProgressChange(id, false, report)).resolves.toBeUndefined();
    expect(report).toHaveBeenCalledWith('notification.progress', 'failed', { reason: 'api-error' });
  });
});
