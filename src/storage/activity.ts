import type { IDBPObjectStore } from 'idb';
import { openHistoryDatabase, HISTORY_DB, type HistoryDatabase } from './database';
import { MAX_ACTIVITY_ENTRIES, validateActivityInput, type ActivityInput,
  type ActivityAction, type ActivityPhase, type ActivityContext, type ActivityData, type ActivityView } from '../shared/activity';

export interface AuditContext { correlationId: string; spanId: string; context: ActivityContext; profileId?: string }
type ActivityStore = IDBPObjectStore<HistoryDatabase, ('activity' | 'settings' | 'scopes' | 'sync')[], 'activity', 'readwrite'>;

export function activityInput(trace: AuditContext, action: ActivityAction, phase: ActivityPhase, data: ActivityData = {},
  extras: { timestamp?: string; itemId?: string } = {}): ActivityInput {
  const input = validateActivityInput({ ...trace, id: crypto.randomUUID(), timestamp: extras.timestamp ?? new Date().toISOString(),
    action, phase, data, ...(extras.itemId ? { itemId: extras.itemId } : {}) });
  if (!input) throw new Error('Invalid activity metadata');
  return input;
}

export async function appendActivity(store: ActivityStore, input: ActivityInput): Promise<void> {
  const safe = validateActivityInput(input);
  if (!safe) throw new Error('Invalid activity metadata');
  await store.add(safe);
}

export async function pruneActivity(store: ActivityStore, cutoff: string, cap = MAX_ACTIVITY_ENTRIES): Promise<void> {
  let expired = await store.index('timestamp').openCursor(IDBKeyRange.upperBound(cutoff, true));
  while (expired) { await expired.delete(); expired = await expired.continue(); }
  let excess = Math.max(0, await store.count() - cap);
  let cursor = excess ? await store.openCursor() : null;
  while (cursor && excess-- > 0) { await cursor.delete(); cursor = await cursor.continue(); }
}

export class ActivityRepository {
  constructor(private readonly name = HISTORY_DB) {}
  async append(input: ActivityInput): Promise<void> {
    const db = await openHistoryDatabase(this.name);
    try {
      const tx = db.transaction(['activity', 'settings'], 'readwrite');
      const done = tx.done; void done.catch(() => {});
      try {
        const days = await tx.objectStore('settings').get('retentionDays') ?? 90;
        await appendActivity(tx.objectStore('activity'), input);
        await pruneActivity(tx.objectStore('activity'), new Date(Date.parse(input.timestamp) - days * 86400000).toISOString());
        await done;
      } catch (error) { try { tx.abort(); } catch { /* Completed. */ } await done.catch(() => {}); throw error; }
    } finally { db.close(); }
  }
  async read(limit = 500, filter: { correlationId?: string; itemId?: string } = {}, now = new Date().toISOString()): Promise<ActivityView> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_ACTIVITY_ENTRIES) throw new Error('Invalid activity limit');
    const db = await openHistoryDatabase(this.name);
    try {
      const tx = db.transaction(['activity', 'settings'], 'readwrite');
      const done = tx.done; void done.catch(() => {});
      const retentionDays = await tx.objectStore('settings').get('retentionDays') ?? 90;
      const store = tx.objectStore('activity');
      await pruneActivity(store, new Date(Date.parse(now) - retentionDays * 86400000).toISOString());
      const raw = filter.correlationId ? await store.index('correlationId').getAll(filter.correlationId) :
        filter.itemId ? await store.index('itemId').getAll(filter.itemId) : await store.getAll();
      const matching = raw.filter((entry) => !filter.itemId || entry.itemId === filter.itemId);
      const entries = matching.flatMap((entry) => {
        const safe = validateActivityInput(entry);
        return safe && entry.sequence && Number.isSafeInteger(entry.sequence) ? [{ ...safe, sequence: entry.sequence }] : [];
      }).sort((a, b) => b.sequence - a.sequence);
      await done;
      return { ok: true, healthy: entries.length === matching.length, total: entries.length, retentionDays, entries: entries.slice(0, limit) };
    } finally { db.close(); }
  }
  async clear(): Promise<void> {
    const db = await openHistoryDatabase(this.name);
    try { const tx = db.transaction('activity', 'readwrite'); await tx.store.clear(); await tx.done; } finally { db.close(); }
  }
}
