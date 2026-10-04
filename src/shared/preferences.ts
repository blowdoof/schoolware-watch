import type { Category } from '../domain/observations';

export const PREFERENCES_KEY = 'schoolwarePreferences';
export interface Preferences {
  monitoringEnabled: boolean; intervalMinutes: number;
  notificationsEnabled: boolean; notificationDays: number; notificationCategories: Category[];
  browserNotificationsEnabled: boolean;
  todoRemindersEnabled: boolean;
  newColor: string; changedColor: string;
}
export const DEFAULT_PREFERENCES: Preferences = {
  monitoringEnabled: true, intervalMinutes: 15, notificationsEnabled: false,
  notificationDays: 3, notificationCategories: ['tests', 'assignments'],
  browserNotificationsEnabled: false,
  todoRemindersEnabled: true,
  newColor: '#15803d', changedColor: '#b45309',
};

export function validatePreferences(value: unknown): Preferences | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const prefs = value as Record<string, unknown>;
  const keys = Object.keys(DEFAULT_PREFERENCES);
  if (Object.keys(prefs).length !== keys.length || !keys.every((key) => Object.hasOwn(prefs, key)) ||
      typeof prefs.monitoringEnabled !== 'boolean' || typeof prefs.notificationsEnabled !== 'boolean' ||
      typeof prefs.browserNotificationsEnabled !== 'boolean' || typeof prefs.todoRemindersEnabled !== 'boolean' ||
      ![5, 15, 30, 60].includes(prefs.intervalMinutes as number) ||
      typeof prefs.notificationDays !== 'number' || !Number.isInteger(prefs.notificationDays) || prefs.notificationDays < 1 || prefs.notificationDays > 30 ||
      typeof prefs.newColor !== 'string' || !/^#[0-9a-f]{6}$/i.test(prefs.newColor) ||
      typeof prefs.changedColor !== 'string' || !/^#[0-9a-f]{6}$/i.test(prefs.changedColor) ||
      !Array.isArray(prefs.notificationCategories) || !prefs.notificationCategories.length ||
      !prefs.notificationCategories.every((category) => ['tests', 'assignments', 'review', 'other'].includes(category)) ||
      new Set(prefs.notificationCategories).size !== prefs.notificationCategories.length) return null;
  return { monitoringEnabled: prefs.monitoringEnabled, intervalMinutes: prefs.intervalMinutes as number,
    notificationsEnabled: prefs.notificationsEnabled, notificationDays: prefs.notificationDays,
    notificationCategories: [...prefs.notificationCategories] as Category[], browserNotificationsEnabled: prefs.browserNotificationsEnabled,
    todoRemindersEnabled: prefs.todoRemindersEnabled,
    newColor: prefs.newColor, changedColor: prefs.changedColor };
}

export function validateStoredPreferences(value: unknown): Preferences | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return validatePreferences({
      ...(!Object.hasOwn(value, 'browserNotificationsEnabled') ? { browserNotificationsEnabled: false } : {}),
      ...(!Object.hasOwn(value, 'todoRemindersEnabled') ? { todoRemindersEnabled: true } : {}), ...value,
    });
  }
  return validatePreferences(value);
}

export interface PreferencesView {
  ok: boolean; preferences: Preferences; notificationPermission: boolean; browserPermission: boolean;
  monitoringScheduled: boolean; nextCheckAt: string | null; retryAt: string | null;
}
export function validatePreferencesView(value: unknown): PreferencesView | null {
  if (!value || typeof value !== 'object') return null;
  const data = value as Record<string, unknown>;
  const preferences = validatePreferences(data.preferences);
  const timestamp = (value: unknown) => value === null || (typeof value === 'string' && Number.isFinite(Date.parse(value)));
  if (!preferences || typeof data.ok !== 'boolean' || typeof data.notificationPermission !== 'boolean' ||
      typeof data.browserPermission !== 'boolean' ||
      typeof data.monitoringScheduled !== 'boolean' || !timestamp(data.nextCheckAt) || !timestamp(data.retryAt)) return null;
  return { ok: data.ok, preferences, notificationPermission: data.notificationPermission, browserPermission: data.browserPermission,
    monitoringScheduled: data.monitoringScheduled, nextCheckAt: data.nextCheckAt as string | null, retryAt: data.retryAt as string | null };
}
