import { SCHOOLWARE_ORIGIN, SCHOOLWARE_PERMISSION } from '../schoolware/agenda-request';

export const BROWSER_ALERTS_KEY = 'schoolwareBrowserAlerts';
export const BROWSER_ORIGINS = [SCHOOLWARE_PERMISSION];
export const BROWSER_PERMISSIONS = { permissions: ['scripting' as const], origins: BROWSER_ORIGINS };
export const MAX_BROWSER_ALERTS = 20;
export interface BrowserAlert {
  id: string; createdAt: string; added: number; changed: number; days: number; test: boolean;
  kind?: 'todo'; pending?: number; targetDay?: string;
}
export interface BrowserAlertsView { ok: boolean; enabled: boolean; entries: BrowserAlert[] }
export const isAlertId = (value: unknown): value is string => typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

export function validateBrowserAlert(value: unknown): BrowserAlert | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const alert = value as Record<string, unknown>;
  const count = (number: unknown): number is number => typeof number === 'number' && Number.isSafeInteger(number) && number >= 0;
  if (Object.hasOwn(alert, 'kind')) {
    if (alert.kind !== 'todo' || !isAlertId(alert.id) || typeof alert.createdAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(alert.createdAt) ||
        !Number.isFinite(Date.parse(alert.createdAt)) || !count(alert.pending) || alert.pending < 1 ||
        alert.added !== 0 || alert.changed !== 0 || alert.days !== 1 || alert.test !== false ||
        typeof alert.targetDay !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(alert.targetDay) ||
        !Number.isFinite(Date.parse(`${alert.targetDay}T00:00:00Z`)) ||
        new Date(`${alert.targetDay}T00:00:00Z`).toISOString().slice(0, 10) !== alert.targetDay) return null;
    return { id: alert.id, createdAt: alert.createdAt, added: 0, changed: 0, days: 1, test: false,
      kind: 'todo', pending: alert.pending, targetDay: alert.targetDay };
  }
  if (Object.hasOwn(alert, 'pending') || Object.hasOwn(alert, 'targetDay')) return null;
  if (!isAlertId(alert.id) || typeof alert.createdAt !== 'string' || !Number.isFinite(Date.parse(alert.createdAt)) ||
      !/^\d{4}-\d{2}-\d{2}T/.test(alert.createdAt) || !count(alert.added) || !count(alert.changed) ||
      !count(alert.days) || alert.days < 1 || alert.days > 30 || typeof alert.test !== 'boolean' ||
      (!alert.test && !alert.added && !alert.changed) || (alert.test && (alert.added !== 0 || alert.changed !== 0))) return null;
  // A projection, not a spread: website scripts receive no profile or item IDs.
  return { id: alert.id, createdAt: alert.createdAt, added: alert.added, changed: alert.changed, days: alert.days, test: alert.test };
}

export function validateBrowserAlertsView(value: unknown): BrowserAlertsView | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const view = value as Record<string, unknown>;
  if (typeof view.ok !== 'boolean' || typeof view.enabled !== 'boolean' || !Array.isArray(view.entries) ||
      view.entries.length > MAX_BROWSER_ALERTS || (!view.enabled && view.entries.length)) return null;
  const entries: BrowserAlert[] = [];
  for (const entry of view.entries) {
    const alert = validateBrowserAlert(entry);
    if (!alert || entries.some((other) => other.id === alert.id)) return null;
    entries.push(alert);
  }
  return { ok: view.ok, enabled: view.enabled, entries };
}

export function browserAlertsText(entries: BrowserAlert[]): string {
  const todos = entries.filter((alert) => alert.kind === 'todo');
  if (todos.length) {
    const todo = todos[0]!;
    const date = new Date(`${todo.targetDay}T12:00:00Z`).toLocaleDateString('nl-BE', { timeZone: 'Europe/Brussels',
      weekday: 'long', day: 'numeric', month: 'long' });
    const text = `To-do: ${todo.pending} open of onafgewerkte taken en toetsen tegen ${date}.`;
    const other = entries.filter((alert) => alert.kind !== 'todo');
    return other.length ? `${text} ${browserAlertsText(other)}` : text;
  }
  const actual = entries.filter((alert) => !alert.test);
  if (!actual.length) return 'Dit is een testmelding in Chrome. Browsermeldingen werken onafhankelijk van Windows-meldingen.';
  const added = actual.reduce((sum, alert) => sum + alert.added, 0);
  const changed = actual.reduce((sum, alert) => sum + alert.changed, 0);
  return `${added} nieuwe of opnieuw zichtbare en ${changed} gewijzigde of niet meer zichtbare agendapunten in ${actual.length} melding(en).`;
}

export function isWebsiteSender(sender: { id?: string; url?: string; tab?: { id?: number | undefined }; frameId?: number }, extensionId: string): boolean {
  if (sender.id !== extensionId || !Number.isSafeInteger(sender.tab?.id) || (sender.tab?.id ?? -1) < 0 || sender.frameId !== 0 || !sender.url) return false;
  try { return new URL(sender.url).origin === SCHOOLWARE_ORIGIN; } catch { return false; }
}
