import type { ConnectionState } from './connection';
import { validateStoredPreferences, type PreferencesView } from './preferences';

export const SETUP_KEY = 'schoolwareSetupComplete';
export type SetupStep = 'connection' | 'preferences' | 'sharing';
/** Upgrades must preserve configured installations without the new marker. */
export function setupAlreadyConfigured(marker: unknown, connection: ConnectionState, storedPreferences: unknown): boolean {
  return marker === true || (marker === undefined && Boolean(connection.requestUrl && validateStoredPreferences(storedPreferences)));
}
/** Optional sharing is never required for a complete local setup. */
export function requiredSetupStep(connection: ConnectionState, hostPermission: boolean,
  preferences: PreferencesView, completed: boolean): SetupStep | null {
  if (!connection.requestUrl || !hostPermission || (!completed && !connection.lastCheck) || (!completed && connection.lastCheck?.status !== 'success') ||
      ['session-required', 'redirected', 'invalid-response', 'invalid-request', 'permission-required'].includes(connection.lastCheck?.status ?? '')) return 'connection';
  if ((preferences.preferences.notificationsEnabled && !preferences.notificationPermission) ||
      (preferences.preferences.browserNotificationsEnabled && !preferences.browserPermission)) return 'preferences';
  return completed ? null : 'preferences';
}
