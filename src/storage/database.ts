import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { HistoryScope } from '../domain/observations';
import type { ActivityInput } from '../shared/activity';
import type { SyncState } from '../shared/progress-sync';

export const HISTORY_DB = 'schoolware-watch-history';
export const HISTORY_VERSION = 3;
export interface HistoryDatabase extends DBSchema {
  scopes: { key: string; value: HistoryScope };
  settings: { key: string; value: number };
  sync: { key: string; value: SyncState };
  activity: { key: number; value: ActivityInput & { sequence?: number };
    indexes: { timestamp: string; profileId: string; correlationId: string; itemId: string } };
}

export function ensureLocalIdentity(scope: HistoryScope): HistoryScope {
  return { ...scope, localId: scope.localId ?? crypto.randomUUID(), items: scope.items.map((item) =>
    ({ ...item, localId: item.localId ?? crypto.randomUUID(), taskStatus: item.taskStatus ?? 'open' })) };
}

export async function openHistoryDatabase(name = HISTORY_DB): Promise<IDBPDatabase<HistoryDatabase>> {
  return openDB<HistoryDatabase>(name, HISTORY_VERSION, {
    upgrade(db, oldVersion, _newVersion, tx) {
      if (oldVersion < 3) db.createObjectStore('sync');
      if (oldVersion < 1) { db.createObjectStore('scopes', { keyPath: 'scopeId' }); db.createObjectStore('settings'); }
      if (oldVersion < 2) {
        const activity = db.createObjectStore('activity', { keyPath: 'sequence', autoIncrement: true });
        for (const key of ['timestamp', 'profileId', 'correlationId', 'itemId'] as const) activity.createIndex(key, key);
        // Upgrade only local metadata. Source snapshots, events, baseline and
        // observation timestamps stay intact. Failure aborts the whole migration.
        void (async () => {
          let cursor = await tx.objectStore('scopes').openCursor();
          while (cursor) { await cursor.update(ensureLocalIdentity(cursor.value)); cursor = await cursor.continue(); }
        })().catch(() => { tx.abort(); });
      }
    },
    blocking() { /* Every repository closes its short-lived connection. */ },
  });
}
