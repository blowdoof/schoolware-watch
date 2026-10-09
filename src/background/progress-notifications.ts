import { DEFAULT_PREFERENCES, PREFERENCES_KEY, validateStoredPreferences } from '../shared/preferences';
import type { ActivityReporter } from '../shared/activity';

/** Only generic text leaves the local task repository. Notification failure cannot undo a sync. */
export async function notifyProgressChange(id: string, initial: boolean, record: ActivityReporter): Promise<void> {
  try {
    if (initial) {
      await record('notification.progress', 'skipped', { reason: 'unchanged' }); return;
    }
    const stored = await chrome.storage.local.get(PREFERENCES_KEY);
    const prefs = validateStoredPreferences(stored[PREFERENCES_KEY]) ?? DEFAULT_PREFERENCES;
    if (!prefs.notificationsEnabled) {
      await record('notification.progress', 'skipped', { reason: 'disabled' }); return;
    }
    if (!await chrome.permissions.contains({ permissions: ['notifications'] })) {
      await record('notification.progress', 'skipped', { reason: 'permission-required' }); return;
    }
    await record('notification.progress', 'started');
    await chrome.notifications.create(`schoolware-watch-progress-${id}`, {
      type: 'basic', iconUrl: chrome.runtime.getURL('icons/icon128.png'), title: 'Schoolware Watch',
      message: 'Gedeelde taakvoortgang of planning is bijgewerkt. Open het overzicht voor de actuele stand.',
    });
    await record('notification.progress', 'succeeded', { reason: 'accepted' });
  } catch { await record('notification.progress', 'failed', { reason: 'api-error' }); }
}
