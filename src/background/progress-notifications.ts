import { DEFAULT_PREFERENCES, PREFERENCES_KEY, validateStoredPreferences } from '../shared/preferences';
import type { ActivityReporter } from '../shared/activity';
import type { ProgressSyncRepository } from '../storage/progress-sync';

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

/** Only addressed, still-active requests produce a help notification. */
export async function notifyHelpRequests(repository: ProgressSyncRepository, scopeId: string, record: ActivityReporter): Promise<void> {
  try {
    const stored = await chrome.storage.local.get(PREFERENCES_KEY);
    const prefs = validateStoredPreferences(stored[PREFERENCES_KEY]) ?? DEFAULT_PREFERENCES;
    if (!prefs.notificationsEnabled || !await chrome.permissions.contains({ permissions: ['notifications'] })) return;
    const id = await repository.claimHelpNotifications(scopeId);
    if (!id) return;
    await record('notification.progress', 'started');
    await chrome.notifications.create(`schoolware-watch-help-${id}`, {
      type: 'basic', iconUrl: chrome.runtime.getURL('icons/icon128.png'), title: 'Schoolware Watch',
      message: 'Er is hulp aan jou gevraagd. Open het to-do-overzicht om de hulpvraag te bekijken.',
    });
    await record('notification.progress', 'succeeded', { reason: 'accepted' });
  } catch { await record('notification.progress', 'failed', { reason: 'api-error' }); }
}
