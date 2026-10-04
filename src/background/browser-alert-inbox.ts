import { BROWSER_ALERTS_KEY, MAX_BROWSER_ALERTS, validateBrowserAlert, type BrowserAlert } from '../shared/browser-alerts';
import { validateAgendaRequest } from '../schoolware/agenda-request';
import { retentionCutoff } from '../storage/history';

export const UNCONNECTED_TEST_SCOPE = 'unconnected-browser-test';
interface StoredAlert extends BrowserAlert { scopeId: string }

function storedAlerts(value: unknown): StoredAlert[] {
  if (!Array.isArray(value)) return [];
  const alerts: StoredAlert[] = [];
  for (const entry of value) {
    const alert = validateBrowserAlert(entry);
    const scopeId: unknown = entry && typeof entry === 'object' ? (entry as Record<string, unknown>).scopeId : null;
    if (alert && (scopeId === UNCONNECTED_TEST_SCOPE || (typeof scopeId === 'string' && validateAgendaRequest(scopeId) === scopeId)) &&
        !alerts.some((other) => other.id === alert.id)) alerts.push({ ...alert, scopeId });
  }
  return alerts;
}

// Only the worker writes this bounded, generic inbox. Serialize its writes
// independently of checks so a preference mutation waiting for a check cannot
// deadlock notification publication. The actual inbox survives worker restarts.
export class BrowserAlertInbox {
  private queue: Promise<void> = Promise.resolve();

  private update(operation: (alerts: StoredAlert[]) => StoredAlert[], retentionDays: number): Promise<StoredAlert[]> {
    const task = this.queue.then(async () => {
      const data = await chrome.storage.local.get(BROWSER_ALERTS_KEY);
      const old: unknown = data[BROWSER_ALERTS_KEY];
      const cutoff = retentionCutoff(new Date().toISOString(), retentionDays);
      const retained = storedAlerts(old).filter((alert) => alert.createdAt >= cutoff);
      const next = operation(retained).slice(0, MAX_BROWSER_ALERTS);
      if (JSON.stringify(old ?? []) !== JSON.stringify(next)) await chrome.storage.local.set({ [BROWSER_ALERTS_KEY]: next });
      return next;
    });
    this.queue = task.then(() => {}, () => {});
    return task;
  }

  async read(scopeId: string, retentionDays: number): Promise<BrowserAlert[]> {
    const alerts = await this.update((entries) => entries, retentionDays);
    return alerts.filter((alert) => alert.scopeId === scopeId).map((alert) => validateBrowserAlert(alert)!);
  }

  async publish(scopeId: string, alert: BrowserAlert, retentionDays: number): Promise<void> {
    if (!validateBrowserAlert(alert) || (scopeId !== UNCONNECTED_TEST_SCOPE && validateAgendaRequest(scopeId) !== scopeId)) throw new Error('Invalid browser alert');
    await this.update((entries) => entries.some((entry) => entry.id === alert.id) ? entries : [{ ...alert, scopeId },
      ...entries.filter((entry) => alert.kind !== 'todo' || entry.scopeId !== scopeId || entry.kind !== 'todo')], retentionDays);
  }

  async dismiss(scopeId: string, retentionDays: number): Promise<void> {
    await this.update((entries) => entries.filter((entry) => entry.scopeId !== scopeId), retentionDays);
  }

  async clear(retentionDays: number): Promise<void> {
    await this.update(() => [], retentionDays);
  }
}
