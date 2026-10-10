import { openHistoryDatabase, HISTORY_DB } from './database';
import { SYNC_STATE_KEY, parsePairingCode, normalizeSyncLabel, type SyncState, type SyncView, type SyncMember } from '../shared/progress-sync';
import { progressItemKey, progressVersion, progressVersionText } from '../domain/progress-sync';
import { hasAgendaMarker, isTaskCategory } from '../domain/tasks';
import type { TaskStatus } from '../domain/tasks';
import { activityInput, appendActivity, type AuditContext } from './activity';
import { HistoryRepository, DEFAULT_RETENTION, retentionCutoff } from './history';
import { planningOperations, sharedSpecialDay, planningResource, assemblePlanning, type PlanningFragment, type PlanningValue } from '../shared/planning-sync';
import { applySharedPlanning } from '../domain/shared-planning';
import { brusselsWallTime } from '../domain/notification-window';
import { APP_VERSION, SYNC_PROTOCOL, type SyncCompatibility, type StoreUpdate } from '../shared/sync-compatibility';

export class ProgressSyncRepository {
  constructor(private readonly name = HISTORY_DB) {}
  async read(): Promise<SyncState | undefined> {
    const db = await openHistoryDatabase(this.name);
    try { return await db.get('sync', SYNC_STATE_KEY); } finally { db.close(); }
  }
  async view(): Promise<SyncView> {
    const state = await this.read();
    return { ok: true, enabled: Boolean(state), pending: (state?.outbox.length ?? 0) + (state?.planningOutbox?.length ?? 0),
      lastSuccessAt: state?.lastSuccessAt ?? null, error: state?.error ?? false,
      ...(state?.compatibility ? { compatibility: state.compatibility } : {}), ...(state?.storeUpdate ? { storeUpdate: state.storeUpdate } : {}),
      ...(state?.planningRemote ? { devices: Object.values(state.planningRemote).flatMap(({ value }) => value.type === 'device-version' ? [{
        id: value.deviceId, version: value.version, protocol: value.protocol, reportedAt: value.reportedAt, self: value.deviceId === state.connectionId,
        ...(state.members?.find((member) => member.id === value.deviceId)?.label ? { label: state.members.find((member) => member.id === value.deviceId)!.label } : {}),
      }] : []) } : {}),
      ...(state?.displayName ? { displayName: state.displayName, membersError: state.membersError ?? false,
        members: (state.members ?? []).map((member) => ({ ...member, self: member.id === state.connectionId })) } : {}),
      ...(state?.registrationPending ? { registrationPending: true } : {}), ...(state?.blocked ? { blocked: true } : {}) };
  }
  async setCompatibility(expected: SyncState, compatibility: SyncCompatibility): Promise<boolean> {
    return this.setClientStatus(expected, { compatibility });
  }
  async setStoreUpdate(expected: SyncState, storeUpdate: StoreUpdate): Promise<boolean> {
    return this.setClientStatus(expected, { storeUpdate });
  }
  private async setClientStatus(expected: SyncState, patch: { compatibility?: SyncCompatibility; storeUpdate?: StoreUpdate }): Promise<boolean> {
    const db = await openHistoryDatabase(this.name);
    try {
      const tx = db.transaction('sync', 'readwrite');
      const state = await tx.store.get(SYNC_STATE_KEY);
      const accepted = state?.connectionId === expected.connectionId && state?.key === expected.key && state?.token === expected.token;
      if (state && accepted) await tx.store.put({ ...state, ...patch }, SYNC_STATE_KEY);
      await tx.done; return accepted;
    } finally { db.close(); }
  }
  async announceVersion(expected: SyncState): Promise<void> {
    const db = await openHistoryDatabase(this.name);
    try {
      const tx = db.transaction('sync', 'readwrite');
      const state = await tx.store.get(SYNC_STATE_KEY);
      const marker = `${APP_VERSION}:${SYNC_PROTOCOL}`;
      if (state?.connectionId === expected.connectionId && state.token === expected.token && state.key === expected.key && state.deviceVersionAnnounced !== marker) {
        state.planningOutbox ??= [];
        state.planningOutbox.push(...planningOperations({ type: 'device-version', deviceId: state.connectionId, version: APP_VERSION, protocol: SYNC_PROTOCOL, reportedAt: new Date().toISOString() }));
        state.deviceVersionAnnounced = marker;
        await tx.store.put(state, SYNC_STATE_KEY);
      }
      await tx.done;
    } finally { db.close(); }
  }
  async preparePlanning(scopeId: string): Promise<void> {
    const history = new HistoryRepository(this.name);
    await history.read(scopeId);
    await history.migratePackingIdentity(scopeId);
    const snapshot = (await history.read(scopeId)).scope;
    const expected = await this.read();
    if (!expected || expected.scopeId !== scopeId || expected.planningInitialized) return;
    const helpSeeds = await Promise.all((snapshot?.items ?? []).filter((item) => item.taskHelp?.needed && isTaskCategory(item.category))
      .map(async (item) => ({ sourceKey: item.sourceKey, requestId: item.taskHelp!.requestId,
        value: { type: 'help' as const, item: await progressItemKey(expected.key, item.sourceKey, new URL(scopeId).origin),
          help: { ...item.taskHelp!, recipients: [] } } })));
    const db = await openHistoryDatabase(this.name);
    try {
      const tx = db.transaction(['scopes', 'sync'], 'readwrite');
      const done = tx.done; void done.catch(() => {});
      try {
        const state = await tx.objectStore('sync').get(SYNC_STATE_KEY);
        const scope = await tx.objectStore('scopes').get(scopeId);
        if (state?.scopeId === scopeId && state.connectionId === expected?.connectionId && scope && !state.planningInitialized) {
          const values: PlanningValue[] = (scope.specialDays ?? []).flatMap((entry) => [
            { type: 'special-day' as const, day: entry.day, entry: sharedSpecialDay(entry) },
            ...entry.checklist.map((point) => ({ type: 'checklist' as const, eventId: entry.id, pointId: point.id, done: point.done })),
          ]);
          values.push(...(scope.schoolbagChoices ?? []).map((choice) => ({ type: 'packing' as const, ...choice })));
          values.push(...helpSeeds.filter((seed) => scope.items.some((item) => item.sourceKey === seed.sourceKey && item.taskHelp?.requestId === seed.requestId)).map((seed) => seed.value));
          state.planningOutbox ??= [];
          for (const value of values) if (!state.planningOutbox.some((operation) => operation.resource === planningResource(value)))
            state.planningOutbox.push(...planningOperations(value, true));
          state.planningInitialized = true;
          await tx.objectStore('sync').put(state, SYNC_STATE_KEY);
        }
        await done;
      } catch (error) { try { tx.abort(); } catch { /* Completed. */ } await done.catch(() => {}); throw error; }
    } finally { db.close(); }
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
    remote: Record<string, { version: string; status: TaskStatus; revision: number; kind: 'manual' | 'reopen' }>, head = cursor,
    planning: { fragment: PlanningFragment; revision: number }[] = []): Promise<boolean> {
    const db = await openHistoryDatabase(this.name);
    try {
      const tx = db.transaction('sync', 'readwrite');
      const done = tx.done; void done.catch(() => {});
      try {
        const current = await tx.store.get(SYNC_STATE_KEY);
        let accepted = false;
        if (current && current.connectionId === expected.connectionId && current.token === expected.token && current.key === expected.key && current.scopeId === expected.scopeId) {
          current.outbox = current.outbox.filter((op) => !acknowledged.includes(op.id));
          if (current.planningOutbox) current.planningOutbox = current.planningOutbox.filter((op) => !acknowledged.includes(op.id));
          for (const { fragment, revision } of planning) {
            current.planningParts ??= {}; current.planningRemote ??= {};
            const assembly = current.planningParts[fragment.batch] ?? { count: fragment.count, parts: {}, revision };
            if (assembly.count !== fragment.count || (assembly.parts[fragment.index] !== undefined && assembly.parts[fragment.index] !== fragment.data)) throw new Error('Invalid planning fragments');
            assembly.parts[fragment.index] = fragment.data;
            assembly.revision = Math.max(assembly.revision, revision);
            current.planningParts[fragment.batch] = assembly;
            if (Object.keys(assembly.parts).length === assembly.count) {
              const assembled = assemblePlanning(assembly);
              const values: PlanningValue[] = assembled.value.type === 'special-day-move' ? [
                { type: 'special-day', day: assembled.value.previousDay, entry: null },
                { type: 'special-day', day: assembled.value.entry.day, entry: assembled.value.entry },
              ] : [assembled.value];
              for (const value of values) {
                const key = planningResource(value);
                const previous = current.planningRemote[key];
                if (!previous || (previous.seed && !assembled.seed) || (previous.seed === assembled.seed && previous.revision < assembly.revision))
                  current.planningRemote[key] = { value, seed: assembled.seed, revision: assembly.revision };
              }
              delete current.planningParts[fragment.batch];
            }
          }
          if (current.planningParts) current.planningParts = Object.fromEntries(Object.entries(current.planningParts).sort((a, b) => b[1].revision - a[1].revision).slice(0, 128));
          if (current.planningRemote && Object.keys(current.planningRemote).length > 20000) throw new Error('Planning cache limit');
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
        await done; return accepted;
      } catch (error) { try { tx.abort(); } catch { /* Completed. */ } await done.catch(() => {}); throw error; }
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
        if (httpStatus === 426) state.compatibility = { checkedAt: new Date().toISOString(), policy: state.compatibility?.policy ?? null, issue: 'update-required' };
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
        return { sourceKey: item.sourceKey, text: progressVersionText(item.snapshot), remoteKey: `${key}.${version}`, helpKey: `help:${key}` };
      }));
      const tx = db.transaction(['scopes', 'sync', 'activity', 'settings'], 'readwrite');
      const done = tx.done; void done.catch(() => {});
      try {
        const current = await tx.objectStore('sync').get(SYNC_STATE_KEY);
        const scope = await tx.objectStore('scopes').get(scopeId);
        let changed = false;
        if (current?.connectionId === state.connectionId && current.token === state.token && current.key === state.key && current.scopeId === scopeId && scope) {
          const now = new Date();
          const retention = await tx.objectStore('settings').get('retentionDays') ?? DEFAULT_RETENTION;
          if (applySharedPlanning(scope, current, retentionCutoff(now.toISOString(), retention), brusselsWallTime(now).slice(0, 10))) changed = true;
          let ordinaryChanged = changed;
          for (const match of matches) {
            const item = scope.items.find((item) => item.sourceKey === match.sourceKey);
            const help = current.planningRemote?.[match.helpKey]?.value;
            if (item?.present && !item.snapshot.hidden && !item.snapshot.cancelled && help?.type === 'help' &&
                !current.planningOutbox?.some((operation) => operation.resource === match.helpKey) && JSON.stringify(item.taskHelp) !== JSON.stringify(help.help)) {
              item.taskHelp = structuredClone(help.help); changed = true;
            }
            const remote = current.remote[match.remoteKey];
            if (!item || !remote || !item.present || item.snapshot.hidden || item.snapshot.cancelled ||
                progressVersionText(item.snapshot) !== match.text || current.outbox.some((op) => op.sourceKey === match.sourceKey)) continue;
            if ((item.taskStatus ?? 'open') !== remote.status) {
              const previous = item.taskStatus ?? 'open';
              item.taskStatus = remote.status; item.taskUpdatedAt = new Date().toISOString(); changed = true; ordinaryChanged = true;
              if (audit) await appendActivity(tx.objectStore('activity'), activityInput({ ...audit, ...(scope.localId ? { profileId: scope.localId } : {}) },
                'task.status', 'succeeded', { from: previous, to: remote.status, reason: 'remote-sync' },
                { timestamp: item.taskUpdatedAt, ...(item.localId ? { itemId: item.localId } : {}) }));
            }
          }
          if (changed) await tx.objectStore('scopes').put(scope);
          current.hasAppliedRemote = true;
          current.lastApplyOrdinaryChanged = ordinaryChanged;
          await tx.objectStore('sync').put(current, SYNC_STATE_KEY);
        }
        await done; return changed;
      } catch (error) { try { tx.abort(); } catch { /* Completed. */ } await done.catch(() => {}); throw error; }
    } finally { db.close(); }
  }

  /** Claim before external delivery so worker restarts cannot repeat a request. */
  async claimHelpNotifications(scopeId: string): Promise<string | null> {
    const db = await openHistoryDatabase(this.name);
    try {
      const tx = db.transaction('sync', 'readwrite');
      const state = await tx.store.get(SYNC_STATE_KEY);
      let first: string | null = null;
      if (state?.scopeId === scopeId && state.cursor === state.head && !state.blocked) {
        state.helpNotificationClaims ??= {};
        for (const [resource, record] of Object.entries(state.planningRemote ?? {})) {
          const value = record.value;
          if (value.type !== 'help' || !value.help.needed || !value.help.recipients.includes(state.connectionId) ||
              state.planningOutbox?.some((operation) => operation.resource === resource) ||
              state.helpNotificationClaims[resource] === value.help.requestId) continue;
          state.helpNotificationClaims[resource] = value.help.requestId;
          first ??= value.help.requestId;
        }
        if (first) await tx.store.put(state, SYNC_STATE_KEY);
      }
      await tx.done; return first;
    } finally { db.close(); }
  }
}
