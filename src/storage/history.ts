import { compareObservations, pruneHistory, type CheckInput, type HistoryScope } from '../domain/observations';
import { openHistoryDatabase, ensureLocalIdentity, HISTORY_DB } from './database';
import { activityInput, appendActivity, pruneActivity, type AuditContext } from './activity';
import { isAlertId } from '../shared/browser-alerts';
import { isTaskCategory, isTaskStatus, type TaskStatus } from '../domain/tasks';
import { progressVersion, progressVersionText, progressItemKey } from '../domain/progress-sync';
import { isHelpRecipients } from '../shared/task-help';
import { SYNC_STATE_KEY } from '../shared/progress-sync';
import { MAX_TASK_UPDATES, createTasksView } from '../shared/tasks';
import { todoReminderSelection } from '../domain/todo';
import type { Category } from '../domain/observations';
import { brusselsWallTime } from '../domain/notification-window';
import { agendaProfileKey, validateAgendaRequest } from '../schoolware/agenda-request';
import { validateSpecialDay, MAX_SPECIAL_DAYS, isDay, type SpecialDay } from '../domain/special-days';
import { planningOperations, planningResource, sharedSpecialDay, type PlanningValue } from '../shared/planning-sync';
import type { SyncState } from '../shared/progress-sync';
import { packingIdentityMigration } from '../shared/schoolbag';

function queuePlanning(state: SyncState | undefined, scopeId: string, value: PlanningValue): void {
  if (state?.scopeId !== scopeId) return;
  const resource = planningResource(value);
  state.planningOutbox = [...(state.planningOutbox ?? []).filter((operation) => operation.resource !== resource), ...planningOperations(value)];
}

export { HISTORY_DB, HISTORY_VERSION, openHistoryDatabase } from './database';

export const RETENTION_DAYS = [30, 90, 180, 365] as const;
export const DEFAULT_RETENTION = 90;

export function retentionCutoff(now: string, days: number): string {
  return new Date(Date.parse(now) - days * 86400000).toISOString();
}

export class HistoryRepository {
  constructor(private readonly name = HISTORY_DB) {}

  /** Reuse legacy scope keys so old progress, local IDs and history stay intact. */
  async resolveProfileLink(requestUrl: string): Promise<string> {
    const validated = validateAgendaRequest(requestUrl);
    const profile = agendaProfileKey(requestUrl);
    if (!validated || !profile) throw new Error('Invalid profile');
    const db = await openHistoryDatabase(this.name);
    try {
      const tx = db.transaction(['scopes', 'sync', 'settings'], 'readonly');
      const days = await tx.objectStore('settings').get('retentionDays') ?? DEFAULT_RETENTION;
      const cutoff = retentionCutoff(new Date().toISOString(), days);
      const candidates = (await tx.objectStore('scopes').getAll()).filter((scope) => scope.lastSuccessAt >= cutoff && agendaProfileKey(scope.scopeId) === profile);
      const sync = await tx.objectStore('sync').get(SYNC_STATE_KEY);
      await tx.done;
      return candidates.find((scope) => scope.scopeId === sync?.scopeId)?.scopeId ??
        candidates.sort((a, b) => (a.baselineAt ?? a.lastSuccessAt).localeCompare(b.baselineAt ?? b.lastSuccessAt) || a.scopeId.localeCompare(b.scopeId))[0]?.scopeId ?? validated;
    } finally { db.close(); }
  }

  async record(input: CheckInput, signal?: AbortSignal, audit?: AuditContext): Promise<HistoryScope> {
    const versions = new Map(await Promise.all(input.points.map(async (point) => [point.sourceKey, await progressVersion(point.snapshot)] as const)));
    const db = await openHistoryDatabase(this.name);
    try {
      const tx = db.transaction(['scopes', 'settings', 'activity', 'sync'], 'readwrite');
      const aborted = () => { try { tx.abort(); } catch { /* Already completed. */ } };
      signal?.addEventListener('abort', aborted, { once: true });
      // Always observe tx.done, including a synchronous comparison error.
      const done = tx.done;
      void done.catch(() => {});
      try {
        if (signal?.aborted) throw new Error('Observation cancelled');
        const retention = await tx.objectStore('settings').get('retentionDays') ?? DEFAULT_RETENTION;
        const cutoff = retentionCutoff(input.observedAt, retention);
        const scopes = tx.objectStore('scopes');
        // Clean up all scopes so old profiles cannot remain hidden indefinitely.
        const retained = await scopes.getAll();
        let previous: HistoryScope | null = null;
        for (const scope of retained) {
          const pruned = pruneHistory(scope, cutoff);
          if (!pruned) {
            await scopes.delete(scope.scopeId);
            if ((await tx.objectStore('sync').get(SYNC_STATE_KEY))?.scopeId === scope.scopeId) await tx.objectStore('sync').delete(SYNC_STATE_KEY);
          }
          else { const migrated = ensureLocalIdentity(pruned); await scopes.put(migrated); if (scope.scopeId === input.scopeId) previous = migrated; }
        }
        const oldItems = new Map(previous?.items.map((item) => [item.sourceKey, item]) ?? []);
        const next = ensureLocalIdentity(compareObservations(previous, { ...input, points: input.points.map((point) =>
          ({ ...point, localId: oldItems.get(point.sourceKey)?.localId ?? crypto.randomUUID() })) }));
        await scopes.put(next);
        const sync = await tx.objectStore('sync').get(SYNC_STATE_KEY);
        if (sync?.scopeId === input.scopeId && !previous?.checks.some((check) => check.checkId === input.checkId)) {
          for (const event of next.events.filter((event) => event.taskReopened &&
            event.id === JSON.stringify([input.checkId, event.sourceKey, event.kind]))) {
            sync.outbox = sync.outbox.filter((operation) => operation.sourceKey !== event.sourceKey);
            sync.outbox.push({ id: crypto.randomUUID(), sourceKey: event.sourceKey,
              version: versions.get(event.sourceKey)!, status: 'in-progress', kind: 'reopen' });
          }
          await tx.objectStore('sync').put(sync, SYNC_STATE_KEY);
        }
        if (!previous?.checks.some((check) => check.checkId === input.checkId)) {
          const trace = { ...(audit ?? { correlationId: isAlertId(input.checkId) ? input.checkId : crypto.randomUUID(),
            spanId: crypto.randomUUID(), context: 'worker' as const }), profileId: next.localId! };
          const items = new Map(next.items.map((item) => [item.sourceKey, item]));
          for (const event of next.events.filter((entry) => entry.id === JSON.stringify([input.checkId, entry.sourceKey, entry.kind]))) {
            await appendActivity(tx.objectStore('activity'), activityInput(trace, `observation.${event.kind}`, 'succeeded',
              { fields: event.fields }, { timestamp: input.observedAt, itemId: items.get(event.sourceKey)!.localId! }));
            if (event.taskReopened) {
              await appendActivity(tx.objectStore('activity'), activityInput(trace, 'task.status', 'succeeded',
                { from: 'done', to: 'in-progress', reason: 'source-changed' },
                { timestamp: input.observedAt, itemId: items.get(event.sourceKey)!.localId! }));
            }
          }
          await appendActivity(tx.objectStore('activity'), activityInput(trace, 'check', 'succeeded',
            { count: next.items.length, added: next.checks.at(-1)!.counts.observed, changed: next.checks.at(-1)!.counts.changed },
            { timestamp: input.observedAt }));
        }
        await pruneActivity(tx.objectStore('activity'), cutoff);
        if (signal?.aborted) throw new Error('Observation cancelled');
        await done;
        return next;
      } catch (error) {
        aborted();
        await done.catch(() => {});
        throw error;
      } finally { signal?.removeEventListener('abort', aborted); }
    } finally { db.close(); }
  }

  async read(scopeId: string | null, now = new Date().toISOString()): Promise<{ scope: HistoryScope | null; retentionDays: number }> {
    const db = await openHistoryDatabase(this.name);
    try {
      const tx = db.transaction(['scopes', 'settings', 'sync'], 'readwrite');
      const done = tx.done;
      void done.catch(() => {});
      const retentionDays = await tx.objectStore('settings').get('retentionDays') ?? DEFAULT_RETENTION;
      const cutoff = retentionCutoff(now, retentionDays);
      let scope: HistoryScope | null = null;
      for (const old of await tx.objectStore('scopes').getAll()) {
        const pruned = pruneHistory(old, cutoff);
        if (pruned) { const migrated = ensureLocalIdentity(pruned); await tx.objectStore('scopes').put(migrated); if (old.scopeId === scopeId) scope = migrated; }
        else {
          await tx.objectStore('scopes').delete(old.scopeId);
          if ((await tx.objectStore('sync').get(SYNC_STATE_KEY))?.scopeId === old.scopeId) await tx.objectStore('sync').delete(SYNC_STATE_KEY);
        }
      }
      const sync = await tx.objectStore('sync').get(SYNC_STATE_KEY);
      if (sync && !await tx.objectStore('scopes').get(sync.scopeId)) await tx.objectStore('sync').delete(SYNC_STATE_KEY);
      await done;
      return { scope, retentionDays };
    } finally { db.close(); }
  }

  async setRetention(days: number, now = new Date().toISOString()): Promise<void> {
    if (!(RETENTION_DAYS as readonly number[]).includes(days)) throw new Error('Invalid retention');
    const db = await openHistoryDatabase(this.name);
    try {
      const tx = db.transaction(['scopes', 'settings', 'activity', 'sync'], 'readwrite');
      const done = tx.done;
      void done.catch(() => {});
      await tx.objectStore('settings').put(days, 'retentionDays');
      const cutoff = retentionCutoff(now, days);
      for (const scope of await tx.objectStore('scopes').getAll()) {
        const pruned = pruneHistory(scope, cutoff);
        if (pruned) await tx.objectStore('scopes').put(pruned);
        else await tx.objectStore('scopes').delete(scope.scopeId);
      }
      const sync = await tx.objectStore('sync').get(SYNC_STATE_KEY);
      if (sync && !await tx.objectStore('scopes').get(sync.scopeId)) await tx.objectStore('sync').delete(SYNC_STATE_KEY);
      await pruneActivity(tx.objectStore('activity'), cutoff);
      await done;
    } finally { db.close(); }
  }

  async clearScope(scopeId: string): Promise<void> {
    const db = await openHistoryDatabase(this.name);
    try {
      const tx = db.transaction(['scopes', 'activity', 'sync'], 'readwrite');
      const sync = await tx.objectStore('sync').get(SYNC_STATE_KEY);
      if (sync?.scopeId === scopeId) await tx.objectStore('sync').delete(SYNC_STATE_KEY);
      const scope = await tx.objectStore('scopes').get(scopeId);
      if (scope?.localId) {
        const entries = await tx.objectStore('activity').getAll();
        const correlations = new Set(entries.filter((entry) => entry.profileId === scope.localId).map((entry) => entry.correlationId));
        for (const entry of entries) if (entry.profileId === scope.localId || correlations.has(entry.correlationId)) {
          await tx.objectStore('activity').delete(entry.sequence!);
        }
      }
      await tx.objectStore('scopes').delete(scopeId);
      await tx.done;
    } finally { db.close(); }
  }

  async setTaskStatus(scopeId: string, itemId: string, status: TaskStatus, trace: AuditContext): Promise<void> {
    await this.setTaskStatuses(scopeId, [itemId], status, trace);
  }

  /** Optimistic revisions prevent stale popup/dashboard writes from losing checklist edits. */
  async saveSpecialDay(scopeId: string, entry: SpecialDay): Promise<void> {
    const validated = validateSpecialDay(entry);
    if (!validated) throw new Error('Invalid special day');
    await this.editSpecialDays(scopeId, (entries, state) => {
      const previous = entries.find((item) => item.id === validated.id);
      if ((previous?.revision ?? 0) !== validated.revision || (!previous && validated.revision !== 0) ||
          entries.some((item) => item.day === validated.day && item.id !== validated.id)) throw new Error('Special day changed');
      const next = entries.filter((item) => item.id !== validated.id);
      if (previous && previous.day !== validated.day) queuePlanning(state, scopeId, { type: 'special-day-move', previousDay: previous.day, entry: sharedSpecialDay(validated) });
      else if (!previous || JSON.stringify(sharedSpecialDay(previous)) !== JSON.stringify(sharedSpecialDay(validated)))
        queuePlanning(state, scopeId, { type: 'special-day', day: validated.day, entry: sharedSpecialDay(validated) });
      for (const point of validated.checklist) {
        if (previous?.checklist.find((item) => item.id === point.id)?.done !== point.done)
          queuePlanning(state, scopeId, { type: 'checklist', eventId: validated.id, pointId: point.id, done: point.done });
      }
      next.push({ ...validated, revision: validated.revision + 1 });
      if (next.length > MAX_SPECIAL_DAYS) throw new Error('Special day limit');
      return next.sort((a, b) => a.day.localeCompare(b.day));
    });
  }

  async deleteSpecialDay(scopeId: string, id: string, revision: number): Promise<void> {
    if (!isAlertId(id) || !Number.isSafeInteger(revision) || revision < 1) throw new Error('Invalid special day deletion');
    await this.editSpecialDays(scopeId, (entries, state) => {
      if (!entries.some((item) => item.id === id && item.revision === revision)) throw new Error('Special day changed');
      queuePlanning(state, scopeId, { type: 'special-day', day: entries.find((item) => item.id === id)!.day, entry: null });
      return entries.filter((item) => item.id !== id);
    });
  }

  private async editSpecialDays(scopeId: string, edit: (entries: SpecialDay[], state: SyncState | undefined) => SpecialDay[]): Promise<void> {
    const db = await openHistoryDatabase(this.name);
    try {
      const tx = db.transaction(['scopes', 'sync'], 'readwrite');
      const done = tx.done; void done.catch(() => {});
      try {
        const scope = await tx.objectStore('scopes').get(scopeId);
        if (!scope) throw new Error('Profile unavailable');
        const state = await tx.objectStore('sync').get(SYNC_STATE_KEY);
        const previous = scope.specialDays ?? [];
        scope.specialDays = edit(scope.specialDays ?? [], state);
        const clock = Math.max(scope.specialDayRevision ?? 0, ...previous.map((entry) => entry.revision), 0) + 1;
        if (!Number.isSafeInteger(clock)) throw new Error('Special day revision exhausted');
        for (const entry of scope.specialDays) if (JSON.stringify(entry) !== JSON.stringify(previous.find((old) => old.id === entry.id))) entry.revision = clock;
        scope.specialDayRevision = clock;
        await tx.objectStore('scopes').put(scope);
        if (state?.scopeId === scopeId) await tx.objectStore('sync').put(state, SYNC_STATE_KEY);
        await done;
      } catch (error) { try { tx.abort(); } catch { /* Already completed. */ } await done.catch(() => {}); throw error; }
    } finally { db.close(); }
  }

  async migratePackingIdentity(scopeId: string): Promise<void> {
    const db = await openHistoryDatabase(this.name);
    try {
      const before = await db.get('scopes', scopeId);
      if (!before || before.packingIdentityVersion === 1) return;
      const mapping = await packingIdentityMigration(before, new Date());
      const tx = db.transaction('scopes', 'readwrite');
      const done = tx.done; void done.catch(() => {});
      try {
        const current = await tx.store.get(scopeId);
        if (!current || JSON.stringify(current) !== JSON.stringify(before)) throw new Error('Packing view changed');
        current.schoolbagChoices = (current.schoolbagChoices ?? []).flatMap((choice) => {
          const id = mapping.get(choice.id); return id ? [{ ...choice, id }] : [];
        });
        current.packingIdentityVersion = 1;
        await tx.store.put(current); await done;
      } catch (error) { try { tx.abort(); } catch { /* Completed. */ } await done.catch(() => {}); throw error; }
    } finally { db.close(); }
  }

  async claimSpecialDayReminder(scopeId: string, key: string, now: string): Promise<boolean> {
    const db = await openHistoryDatabase(this.name);
    try {
      const tx = db.transaction('scopes', 'readwrite');
      const done = tx.done; void done.catch(() => {});
      try {
        const scope = await tx.store.get(scopeId);
        if (!scope || scope.specialDayReminders?.some((entry) => entry.key === key)) { await done; return false; }
        scope.specialDayReminders = [...(scope.specialDayReminders ?? []).filter((entry) => entry.claimedAt >= retentionCutoff(now, DEFAULT_RETENTION)), { key, claimedAt: now }];
        await tx.store.put(scope); await done; return true;
      } catch (error) { try { tx.abort(); } catch { /* Already completed. */ } await done.catch(() => {}); throw error; }
    } finally { db.close(); }
  }

  async setPackingChoice(scopeId: string, id: string, day: string, state: 'packed' | 'hidden' | 'open'): Promise<void> {
    if (!/^[a-f0-9]{64}$/.test(id) || !isDay(day) || !['packed', 'hidden', 'open'].includes(state)) throw new Error('Invalid packing choice');
    const db = await openHistoryDatabase(this.name);
    try {
      const tx = db.transaction(['scopes', 'sync'], 'readwrite');
      const done = tx.done;
      void done.catch(() => {});
      try {
        const scope = await tx.objectStore('scopes').get(scopeId);
        if (!scope) throw new Error('Profile unavailable');
        const choices = (scope.schoolbagChoices ?? []).filter((choice) => choice.id !== id && choice.day >= brusselsWallTime(new Date()).slice(0, 10));
        if (state !== 'open') choices.push({ id, day, state });
        if (choices.length > 5000) throw new Error('Packing choice limit');
        scope.schoolbagChoices = choices;
        const sync = await tx.objectStore('sync').get(SYNC_STATE_KEY);
        queuePlanning(sync, scopeId, { type: 'packing', id, day, state });
        await tx.objectStore('scopes').put(scope);
        if (sync?.scopeId === scopeId) await tx.objectStore('sync').put(sync, SYNC_STATE_KEY);
        await done;
      } catch (error) { try { tx.abort(); } catch { /* Already completed. */ } await done.catch(() => {}); throw error; }
    } finally { db.close(); }
  }

  async setTaskHelp(scopeId: string, itemId: string, needed: boolean, recipients: string[]): Promise<void> {
    if (!isAlertId(itemId) || typeof needed !== 'boolean' || !isHelpRecipients(recipients) || (!needed && recipients.length)) throw new Error('Invalid help update');
    const db = await openHistoryDatabase(this.name);
    try {
      const before = await db.get('scopes', scopeId);
      const item = before?.items.find((entry) => entry.localId === itemId);
      if (!item) throw new Error('Task unavailable');
      const state = await db.get('sync', SYNC_STATE_KEY);
      const sharing = state?.scopeId === scopeId ? state : undefined;
      const key = sharing ? await progressItemKey(sharing.key, item.sourceKey, new URL(scopeId).origin) : null;
      const tx = db.transaction(['scopes', 'sync'], 'readwrite');
      const done = tx.done; void done.catch(() => {});
      try {
        const scope = await tx.objectStore('scopes').get(scopeId);
        const current = await tx.objectStore('sync').get(SYNC_STATE_KEY);
        const active = current?.scopeId === scopeId ? current : undefined;
        if (active?.connectionId !== sharing?.connectionId || active?.key !== sharing?.key) throw new Error('Connection changed');
        if (recipients.some((id) => !active?.members?.some((member) => member.id === id && id !== active.connectionId))) throw new Error('Recipient unavailable');
        const entry = scope?.items.find((entry) => entry.localId === itemId && entry.present && !entry.snapshot.hidden && !entry.snapshot.cancelled && isTaskCategory(entry.category));
        if (!entry || entry.sourceKey !== item.sourceKey) throw new Error('Task unavailable');
        const sorted = [...recipients].sort();
        if ((entry.taskHelp?.needed ?? false) !== needed || JSON.stringify(entry.taskHelp?.recipients ?? []) !== JSON.stringify(sorted)) {
          entry.taskHelp = { needed, recipients: sorted, requestId: crypto.randomUUID() };
          if (active && key) {
            queuePlanning(active, scopeId, { type: 'help', item: key, help: entry.taskHelp });
            await tx.objectStore('sync').put(active, SYNC_STATE_KEY);
          }
          await tx.objectStore('scopes').put(scope!);
        }
        await done;
      } catch (error) { try { tx.abort(); } catch { /* Completed. */ } await done.catch(() => {}); throw error; }
    } finally { db.close(); }
  }

  async setTaskStatuses(scopeId: string, itemIds: string[], status: TaskStatus, trace: AuditContext): Promise<void> {
    if (!itemIds.length || itemIds.length > MAX_TASK_UPDATES || !itemIds.every(isAlertId) ||
        new Set(itemIds).size !== itemIds.length || !isTaskStatus(status)) throw new Error('Invalid task update');
    const db = await openHistoryDatabase(this.name);
    try {
      const previous = await db.get('scopes', scopeId);
      const prepared = await Promise.all(itemIds.map(async (itemId) => {
        const before = previous?.items.find((item) => item.localId === itemId);
        if (!before) throw new Error('Task unavailable');
        return { itemId, snapshot: before.snapshot, version: await progressVersion(before.snapshot) };
      }));
      const tx = db.transaction(['scopes', 'settings', 'activity', 'sync'], 'readwrite');
      const done = tx.done; void done.catch(() => {});
      try {
        const scope = await tx.objectStore('scopes').get(scopeId);
        if (!scope?.localId) throw new Error('Task unavailable');
        const timestamp = new Date().toISOString();
        const sync = await tx.objectStore('sync').get(SYNC_STATE_KEY);
        let changed = false;
        for (const { itemId, snapshot, version } of prepared) {
          const item = scope.items.find((entry) => entry.localId === itemId && entry.present &&
            !entry.snapshot.hidden && !entry.snapshot.cancelled && isTaskCategory(entry.category));
          if (!item) throw new Error('Task unavailable');
          if (progressVersionText(snapshot) !== progressVersionText(item.snapshot)) throw new Error('Task changed');
          const from = item.taskStatus ?? 'open';
          if (from !== status) { item.taskStatus = status; item.taskUpdatedAt = timestamp; changed = true; }
          if (from !== status && sync?.scopeId === scopeId) {
            // Coalesce unsent edits without replacing an operation in flight.
            sync.outbox = sync.outbox.filter((operation) => operation.sourceKey !== item.sourceKey);
            sync.outbox.push({ id: crypto.randomUUID(), sourceKey: item.sourceKey, version, status, kind: 'manual' });
          }
          await appendActivity(tx.objectStore('activity'), activityInput({ ...trace, profileId: scope.localId }, 'task.status',
            from === status ? 'skipped' : 'succeeded', { from, to: status, ...(from === status ? { reason: 'unchanged' as const } : {}) }, { itemId, timestamp }));
        }
        if (changed) {
          await tx.objectStore('scopes').put(scope);
          if (sync?.scopeId === scopeId) await tx.objectStore('sync').put(sync, SYNC_STATE_KEY);
        }
        const retention = await tx.objectStore('settings').get('retentionDays') ?? DEFAULT_RETENTION;
        await pruneActivity(tx.objectStore('activity'), retentionCutoff(timestamp, retention));
        await done;
      } catch (error) { try { tx.abort(); } catch { /* Completed. */ } await done.catch(() => {}); throw error; }
    } finally { db.close(); }
  }

  // Claim before calling the external notification API: a worker interruption
  // may lose a notification, but cannot display the same check twice.
  async claimNotification(scopeId: string, checkId: string, now: string): Promise<boolean> {
    const db = await openHistoryDatabase(this.name);
    try {
      const tx = db.transaction('scopes', 'readwrite');
      const scope = await tx.store.get(scopeId);
      const check = scope?.checks.find((entry) => entry.checkId === checkId);
      if (!scope || !check || check.notificationClaimedAt) { await tx.done; return false; }
      check.notificationClaimedAt = now;
      await tx.store.put(scope);
      await tx.done;
      return true;
    } finally { db.close(); }
  }

  async claimTodoReminder(scopeId: string, now: Date, categories: Category[], channels: { browser: boolean; system: boolean }) {
    const db = await openHistoryDatabase(this.name);
    try {
      const tx = db.transaction('scopes', 'readwrite');
      const scope = await tx.store.get(scopeId);
      const selection = scope ? todoReminderSelection(createTasksView(scope), now, categories) : null;
      if (!scope || !selection) { await tx.done; return null; }
      const state = scope.todoReminder?.day === selection.day ? scope.todoReminder : { id: crypto.randomUUID(), day: selection.day };
      const browser = channels.browser && !state.browserClaimedAt;
      const system = channels.system && !state.systemClaimedAt;
      if (browser) state.browserClaimedAt = now.toISOString();
      if (system) state.systemClaimedAt = now.toISOString();
      scope.todoReminder = state;
      await tx.store.put(scope);
      await tx.done;
      return { ...selection, id: state.id, browser, system };
    } finally { db.close(); }
  }

  async clearAll(): Promise<void> {
    const db = await openHistoryDatabase(this.name);
    try {
      const tx = db.transaction(['scopes', 'settings', 'activity', 'sync'], 'readwrite');
      await tx.objectStore('sync').clear();
      await Promise.all([tx.objectStore('scopes').clear(), tx.objectStore('settings').clear(), tx.objectStore('activity').clear()]);
      await tx.done;
    } finally { db.close(); }
  }
}
