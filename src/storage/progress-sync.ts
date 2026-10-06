import { openHistoryDatabase, HISTORY_DB } from './database';
import { SYNC_STATE_KEY, parsePairingCode, normalizeSyncLabel, type SyncState, type SyncView, type SyncMember } from '../shared/progress-sync';
import { progressItemKey, progressVersion, progressVersionText } from '../domain/progress-sync';
import { hasAgendaMarker, isTaskCategory } from '../domain/tasks';
import type { TaskStatus } from '../domain/tasks';
import { activityInput, appendActivity, type AuditContext } from './activity';

export class ProgressSyncRepository {
  constructor(private readonly name = HISTORY_DB) {}
  async read(): Promise<SyncState | undefined> {
    const db = await openHistoryDatabase(this.name);
    try { return await db.get('sync', SYNC_STATE_KEY); } finally { db.close(); }
  }
  async view(): Promise<SyncView> {
    const state = await this.read();
    return { ok: true, enabled: Boolean(state), pending: state?.outbox.length ?? 0,
      lastSuccessAt: state?.lastSuccessAt ?? null, error: state?.error ?? false,
      ...(state?.displayName ? { displayName: state.displayName, membersError: state.membersError ?? false,
        members: (state.members ?? []).map((member) => ({ ...member, self: member.id === state.connectionId })) } : {}),
      ...(state?.registrationPending ? { registrationPending: true } : {}), ...(state?.blocked ? { blocked: true } : {}) };
  }
  async connect(scopeId: string, code: string, seed: boolean, register = false, label?: string): Promise<void> {
    const pair = parsePairingCode(code);
    if (!pair) throw new Error('Invalid pairing');
    if (label !== undefined && normalizeSyncLabel(label) !== label) throw new Error('Invalid label');
    const db = await openHistoryDatabase(this.name);
    try {
      const scope = await db.get('scopes', scopeId);
      if (!scope) throw new Error('Check agenda first');
      const outbox = seed ? await Promise.all(scope.items.filter((item) => item.present && isTaskCategory(item.category) && hasAgendaMarker(item.snapshot.typePunt) &&
        !item.snapshot.hidden && !item.snapshot.cancelled && item.taskStatus && item.taskStatus !== 'open').map(async (item) =>
        ({ id: crypto.randomUUID(), sourceKey: item.sourceKey, version: await progressVersion(item.snapshot), status: item.taskStatus!, kind: 'manual' as const }))) : [];
      const tx = db.transaction(['sync', 'scopes'], 'readwrite');
      const current = await tx.objectStore('scopes').get(scopeId);
      if (await tx.objectStore('sync').get(SYNC_STATE_KEY) || !current || JSON.stringify(current) !== JSON.stringify(scope)) {
        tx.abort(); await tx.done.catch(() => {}); throw new Error('Connection changed');
      }
      await tx.objectStore('sync').put({ connectionId: crypto.randomUUID(), scopeId, ...pair, cursor: 0, head: 0, outbox, remote: {}, lastSuccessAt: null, error: false,
        ...(register ? { registrationPending: true } : {}), ...(label ? { displayName: label, members: [] } : {}) }, SYNC_STATE_KEY);
      await tx.done;
    } finally { db.close(); }
  }
  async disconnect(): Promise<void> {
    const db = await openHistoryDatabase(this.name);
    try { await db.delete('sync', SYNC_STATE_KEY); } finally { db.close(); }
  }
  async setDisplayName(label: string): Promise<void> {
    if (normalizeSyncLabel(label) !== label) throw new Error('Invalid label');
    const db = await openHistoryDatabase(this.name);
    try {
      const tx = db.transaction('sync', 'readwrite');
      const state = await tx.store.get(SYNC_STATE_KEY);
      if (!state) { tx.abort(); await tx.done.catch(() => {}); throw new Error('Not connected'); }
      state.displayName = label;
      await tx.store.put(state, SYNC_STATE_KEY); await tx.done;
    } finally { db.close(); }
  }
  async commitMembers(expected: SyncState, members: SyncMember[] | null): Promise<boolean> {
    const db = await openHistoryDatabase(this.name);
    try {
      const tx = db.transaction('sync', 'readwrite');
      const current = await tx.store.get(SYNC_STATE_KEY);
      let changed = false;
      if (current?.connectionId === expected.connectionId && current.token === expected.token && current.key === expected.key && current.displayName === expected.displayName) {
        changed = current.membersError !== (members === null) || (members !== null && JSON.stringify(current.members) !== JSON.stringify(members));
        current.membersError = members === null;
        if (members !== null) current.members = members;
        await tx.store.put(current, SYNC_STATE_KEY);
      }
      await tx.done; return changed;
    } finally { db.close(); }
  }
  async registered(expected: SyncState): Promise<boolean> {
    const db = await openHistoryDatabase(this.name);
    try {
      const tx = db.transaction('sync', 'readwrite');
      const current = await tx.store.get(SYNC_STATE_KEY);
      let accepted = false;
      if (current?.connectionId === expected.connectionId && current.token === expected.token && current.key === expected.key) {
        delete current.registrationPending;
        await tx.store.put(current, SYNC_STATE_KEY);
        accepted = true;
      }
      await tx.done; return accepted;
    } finally { db.close(); }
  }
  async commit(expected: SyncState, acknowledged: string[], cursor: number,
    remote: Record<string, { version: string; status: TaskStatus; revision: number; kind: 'manual' | 'reopen' }>, head = cursor): Promise<boolean> {
    const db = await openHistoryDatabase(this.name);
    try {
      const tx = db.transaction('sync', 'readwrite');
      const current = await tx.store.get(SYNC_STATE_KEY);
      let accepted = false;
      if (current && current.connectionId === expected.connectionId && current.token === expected.token && current.key === expected.key && current.scopeId === expected.scopeId) {
        current.outbox = current.outbox.filter((op) => !acknowledged.includes(op.id));
        current.cursor = Math.max(current.cursor, cursor);
        current.head = Math.max(current.head, head);
        for (const [key, value] of Object.entries(remote)) {
          const previous = current.remote[key];
          if (!previous || (previous.kind !== 'manual' && value.kind === 'manual') ||
              (previous.kind === value.kind && previous.revision < value.revision)) current.remote[key] = value;
        }
        // Bound the cache, including operations for points not locally visible yet.
        current.remote = Object.fromEntries(Object.entries(current.remote).sort((a, b) => b[1].revision - a[1].revision).slice(0, 20000));
        current.lastSuccessAt = new Date().toISOString(); current.error = false;
        await tx.store.put(current, SYNC_STATE_KEY);
        accepted = true;
      }
      await tx.done; return accepted;
    } finally { db.close(); }
  }
  async resume(): Promise<void> {
    const db = await openHistoryDatabase(this.name);
    try {
      const tx = db.transaction('sync', 'readwrite');
      const state = await tx.store.get(SYNC_STATE_KEY);
      if (state) { delete state.blocked; await tx.store.put(state, SYNC_STATE_KEY); }
      await tx.done;
    } finally { db.close(); }
  }
  async failed(expected: SyncState, httpStatus?: number): Promise<void> {
    const db = await openHistoryDatabase(this.name);
    try {
      const tx = db.transaction('sync', 'readwrite'); const state = await tx.store.get(SYNC_STATE_KEY);
      if (state?.connectionId === expected.connectionId && state.token === expected.token && state.key === expected.key) {
        state.error = true;
        if (httpStatus !== undefined && [401, 403, 409].includes(httpStatus)) state.blocked = true;
        await tx.store.put(state, SYNC_STATE_KEY);
      }
      await tx.done;
    } finally { db.close(); }
  }
  async apply(scopeId: string, audit?: AuditContext): Promise<boolean> {
    const db = await openHistoryDatabase(this.name);
    try {
      const state = await db.get('sync', SYNC_STATE_KEY);
      const before = await db.get('scopes', scopeId);
      if (!state || state.scopeId !== scopeId || !before || state.cursor < state.head) return false;
      const matches = await Promise.all(before.items.filter((item) => item.present && isTaskCategory(item.category) && hasAgendaMarker(item.snapshot.typePunt) &&
        !item.snapshot.hidden && !item.snapshot.cancelled).map(async (item) => {
        const version = await progressVersion(item.snapshot); const key = await progressItemKey(state.key, item.sourceKey, new URL(state.scopeId).origin);
        return { sourceKey: item.sourceKey, text: progressVersionText(item.snapshot), remoteKey: `${key}.${version}` };
      }));
      const tx = db.transaction(['scopes', 'sync', 'activity'], 'readwrite');
      const done = tx.done; void done.catch(() => {});
      try {
        const current = await tx.objectStore('sync').get(SYNC_STATE_KEY);
        const scope = await tx.objectStore('scopes').get(scopeId);
        let changed = false;
        if (current?.connectionId === state.connectionId && current.token === state.token && current.key === state.key && current.scopeId === scopeId && scope) {
          for (const match of matches) {
            const item = scope.items.find((item) => item.sourceKey === match.sourceKey);
            const remote = current.remote[match.remoteKey];
            if (!item || !remote || !item.present || item.snapshot.hidden || item.snapshot.cancelled ||
                progressVersionText(item.snapshot) !== match.text || current.outbox.some((op) => op.sourceKey === match.sourceKey)) continue;
            if ((item.taskStatus ?? 'open') !== remote.status) {
              const previous = item.taskStatus ?? 'open';
              item.taskStatus = remote.status; item.taskUpdatedAt = new Date().toISOString(); changed = true;
              if (audit) await appendActivity(tx.objectStore('activity'), activityInput({ ...audit, ...(scope.localId ? { profileId: scope.localId } : {}) },
                'task.status', 'succeeded', { from: previous, to: remote.status, reason: 'remote-sync' },
                { timestamp: item.taskUpdatedAt, ...(item.localId ? { itemId: item.localId } : {}) }));
            }
          }
          if (changed) await tx.objectStore('scopes').put(scope);
          current.hasAppliedRemote = true;
          await tx.objectStore('sync').put(current, SYNC_STATE_KEY);
        }
        await done; return changed;
      } catch (error) { try { tx.abort(); } catch { /* Completed. */ } await done.catch(() => {}); throw error; }
    } finally { db.close(); }
  }
}
