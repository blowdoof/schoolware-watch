import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { openDB } from 'idb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { compareObservations } from '../src/domain/observations';
import { HistoryRepository, openHistoryDatabase } from '../src/storage/history';
import { ActivityRepository, activityInput, pruneActivity, type AuditContext } from '../src/storage/activity';
import { createTasksView, validateTasksView } from '../src/shared/tasks';
import { validateActivityInput, validateActivityView } from '../src/shared/activity';
import { validateConnectionMessage } from '../src/shared/connection';
import { TaskControls } from '../src/ui/TaskControls';
import { isPastTask } from '../src/domain/tasks';
import { check, point } from './fixtures/observations';

const name = 'synthetic-activity-and-tasks';
const history = new HistoryRepository(name);
const activity = new ActivityRepository(name);
const audit = (): AuditContext => ({ correlationId: crypto.randomUUID(), spanId: crypto.randomUUID(), context: 'dashboard' });
beforeEach(() => { vi.stubGlobal('indexedDB', new IDBFactory()); vi.setSystemTime(new Date('2026-10-02T08:00:00Z')); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('local activity and task progress', () => {
  it('hides cancelled and hidden tasks without deleting progress, and rejects editing their status', async () => {
    const first = await history.record(check());
    const id = first.items[0]!.localId!;
    await history.setTaskStatus(first.scopeId, id, 'done', audit());
    for (const [index, flags] of [{ cancelled: true }, { hidden: true }].entries()) {
      const unavailable = await history.record(check({ checkId: `unavailable-${index}`,
        points: [{ ...point, snapshot: { ...point.snapshot, ...flags } }] }));
      expect(createTasksView(unavailable).entries).toEqual([]);
      expect(unavailable.items[0]!.taskStatus).toBe('done');
      expect(unavailable.events.at(-1)!.kind).toBe('changed');
      await expect(history.setTaskStatus(first.scopeId, id, 'open', audit())).rejects.toThrow('Task unavailable');
    }
    const restored = await history.record(check({ checkId: 'restored' }));
    expect(createTasksView(restored).entries[0]).toMatchObject({ id, status: 'in-progress' });
  });

  it('rolls back automatic reopening, events, notification details and audit entries together on an audit failure', async () => {
    const first = await history.record(check());
    await history.setTaskStatus(first.scopeId, first.items[0]!.localId!, 'done', audit());
    const before = (await history.read(first.scopeId)).scope!;
    const logs = await activity.read();
    const input = check({ checkId: crypto.randomUUID(), points: [{ ...point,
      snapshot: { ...point.snapshot, instructions: 'Synthetic extra work' } }],
      notificationSelection: { days: 3, categories: ['assignments'] } });
    await expect(history.record(input, undefined, { ...audit(), correlationId: 'invalid' })).rejects.toThrow();
    expect((await history.read(first.scopeId)).scope).toEqual(before);
    expect(await activity.read()).toEqual(logs);
    const next = await history.record(input);
    expect(next.items[0]!.taskStatus).toBe('in-progress');
    expect(next.events.at(-1)!.taskReopened).toBe(true);
    expect(next.checks.at(-1)!.notificationDetails!.lessons[0]!.items[0]!.taskReopened).toBe(true);
    await history.setTaskStatus(first.scopeId, first.items[0]!.localId!, 'done', audit());
    const retry = await history.record(input);
    expect(retry.items[0]!.taskStatus).toBe('done');
    expect((await activity.read()).entries.filter((entry) => entry.data.reason === 'source-changed')).toHaveLength(1);
  });

  it('hides elapsed planning without completing tasks or removing their history and audit records', async () => {
    const trace = audit();
    const first = await history.record(check({ checkId: trace.correlationId }), undefined, trace);
    const beforeLogs = await activity.read();
    const now = new Date('2026-10-05T07:50:00Z'); // 09:50 in Brussels.
    const view = createTasksView(first);
    expect(view.entries.filter((task) => !isPastTask(task.snapshot.endsAt, now))).toEqual([]);
    expect(view.entries.filter((task) => isPastTask(task.snapshot.endsAt, now))).toHaveLength(1);
    expect((await history.read(first.scopeId)).scope).toEqual(first);
    expect(first.items[0]!.taskStatus).toBe('open');
    expect(await activity.read()).toEqual(beforeLogs);
  });

  it('uses the Brussels end time including today and daylight saving offsets', () => {
    expect(isPastTask('2026-10-02 09:59:59', new Date('2026-10-02T08:00:00Z'))).toBe(true);
    expect(isPastTask('2026-10-02 10:00:00', new Date('2026-10-02T08:00:00Z'))).toBe(true);
    expect(isPastTask('2026-10-02 10:00:01', new Date('2026-10-02T08:00:00Z'))).toBe(false);
    expect(isPastTask('2026-10-03 09:00:00', new Date('2026-10-02T08:00:00Z'))).toBe(false);
    expect(isPastTask('2026-12-01 09:00:00', new Date('2026-12-01T08:00:00Z'))).toBe(true);
  });

  it('migrates a real version-1 database without altering source history, and does not invent historical logs', async () => {
    const legacy = compareObservations(null, check());
    const old = await openDB(name, 1, { upgrade(db) { db.createObjectStore('scopes', { keyPath: 'scopeId' }); db.createObjectStore('settings'); } });
    await old.put('scopes', legacy);
    await old.put('settings', 30, 'retentionDays');
    old.close();
    const next = await history.read(legacy.scopeId);
    expect(next.retentionDays).toBe(30);
    expect(next.scope).toMatchObject({ baselineAt: legacy.baselineAt, lastSuccessAt: legacy.lastSuccessAt,
      events: legacy.events, checks: legacy.checks, items: [{ snapshot: point.snapshot, taskStatus: 'open' }] });
    expect(next.scope!.localId).toMatch(/^[0-9a-f-]{36}$/);
    expect(next.scope!.items[0]!.localId).toMatch(/^[0-9a-f-]{36}$/);
    expect((await new HistoryRepository(name).read(legacy.scopeId)).scope).toEqual(next.scope);
    expect((await activity.read()).entries).toEqual([]);
  });

  it('reopens completed tasks atomically with source changes, audit records and notification details, while retries preserve progress', async () => {
    const root = audit();
    const input = check({ checkId: root.correlationId });
    const first = await history.record(input, undefined, root);
    const itemId = first.items[0]!.localId!;
    const baselineLogs = await activity.read();
    expect(baselineLogs.entries.map((entry) => entry.action)).toEqual(['check', 'observation.baseline']);
    expect(baselineLogs.entries.every((entry) => entry.correlationId === root.correlationId)).toBe(true);
    expect(baselineLogs.entries.every((entry) => entry.profileId === first.localId)).toBe(true);
    await history.setTaskStatus(first.scopeId, itemId, 'in-progress', audit());
    vi.setSystemTime(new Date('2026-10-02T09:00:00Z'));
    await history.setTaskStatus(first.scopeId, itemId, 'done', audit());
    const after = (await history.read(first.scopeId)).scope!;
    expect(after.items[0]).toMatchObject({ taskStatus: 'done', taskUpdatedAt: '2026-10-02T09:00:00.000Z' });
    expect(after.events).toEqual(first.events);
    const repeated = await history.record(input, undefined, root);
    expect(repeated.items[0]!.taskStatus).toBe('done');
    expect((await activity.read()).entries.filter((entry) => entry.action === 'observation.baseline')).toHaveLength(1);
    const nextTrace = audit();
    await history.record(check({ checkId: nextTrace.correlationId, observedAt: '2026-10-02T09:00:00.000Z',
      points: [{ ...point, snapshot: { ...point.snapshot, title: 'Synthetic revised task' } }],
      notificationSelection: { days: 3, categories: ['assignments'] } }), undefined, nextTrace);
    const restarted = (await new HistoryRepository(name).read(first.scopeId)).scope!;
    expect(restarted.items[0]).toMatchObject({ localId: itemId, taskStatus: 'in-progress' });
    expect(restarted.checks.at(-1)!.notificationDetails!.lessons[0]!.items[0]!.itemId).toBe(itemId);
    const filtered = await activity.read(500, { itemId });
    expect(filtered.entries.filter((entry) => entry.action === 'task.status').map((entry) => entry.data)).toEqual([
      { from: 'done', to: 'in-progress', reason: 'source-changed' },
      { from: 'in-progress', to: 'done' }, { from: 'open', to: 'in-progress' },
    ]);
    expect(validateActivityView(filtered)).toEqual(filtered);
    const view = createTasksView(restarted);
    expect(validateTasksView(view)).toEqual(view);
    expect(view.entries[0]).toMatchObject({ id: itemId, status: 'in-progress' });
    const encoded = JSON.stringify(filtered);
    for (const privateValue of [point.sourceKey, input.scopeId, point.snapshot.title, point.snapshot.instructions, 'Synthetic revised task']) {
      expect(encoded).not.toContain(privateValue);
    }
  });

  it('rejects other profiles, unavailable items and malformed audit metadata, rolling back the task and its log together', async () => {
    const first = await history.record(check());
    const itemId = first.items[0]!.localId!;
    await history.record(check({ scopeId: 'different-profile' }));
    const before = await activity.read();
    await expect(history.setTaskStatus('different-profile', itemId, 'done', audit())).rejects.toThrow();
    await expect(history.setTaskStatus(first.scopeId, itemId, 'done', { ...audit(), correlationId: 'not-an-opaque-id' })).rejects.toThrow();
    expect((await history.read(first.scopeId)).scope).toEqual(first);
    expect(await activity.read()).toEqual(before);
    await expect(history.record(check({ checkId: 'invalid-audit', points: [{ ...point, snapshot: { ...point.snapshot, title: 'Synthetic bad update' } }] }),
      undefined, { ...audit(), correlationId: 'not-an-opaque-id' })).rejects.toThrow();
    expect((await history.read(first.scopeId)).scope).toEqual(first);
    expect(await activity.read()).toEqual(before);
  });

  it('records repeated status requests as skipped, and reopens reappearing tasks with the same local identity', async () => {
    const first = await history.record(check({ complete: true, identityVerified: true }));
    const id = first.items[0]!.localId!;
    await history.setTaskStatus(first.scopeId, id, 'done', audit());
    await history.setTaskStatus(first.scopeId, id, 'done', audit());
    const disappeared = await history.record(check({ checkId: 'gone', points: [], complete: true, identityVerified: true }));
    expect(disappeared.items[0]!.present).toBe(false);
    expect(createTasksView(disappeared).entries).toEqual([]);
    await expect(history.setTaskStatus(first.scopeId, id, 'open', audit())).rejects.toThrow();
    const next = await history.record(check({ checkId: 'returned', complete: true, identityVerified: true }));
    expect(createTasksView(next).entries[0]).toMatchObject({ id, status: 'in-progress' });
    expect((await activity.read()).entries.filter((entry) => entry.action === 'task.status' && entry.phase === 'skipped')).toHaveLength(1);
  });

  it('prunes logs with retention and capacity, exports metadata projections, and clears profile-linked correlations only', async () => {
    const firstTrace = audit();
    const first = await history.record(check({ checkId: firstTrace.correlationId }), undefined, firstTrace);
    const other = await history.record(check({ scopeId: 'different-profile' }));
    await activity.append(activityInput(firstTrace, 'request', 'succeeded')); // A root row without profile metadata.
    await history.clearScope(first.scopeId);
    expect((await activity.read()).entries.some((entry) => entry.correlationId === firstTrace.correlationId)).toBe(false);
    expect((await history.read(other.scopeId)).scope).toEqual(other);
    const db = await openHistoryDatabase(name);
    const tx = db.transaction(['activity', 'settings'], 'readwrite');
    await pruneActivity(tx.objectStore('activity'), '2026-09-01T00:00:00.000Z', 1);
    await tx.done; db.close();
    expect((await activity.read()).total).toBe(1);
    await history.setRetention(30, '2026-11-15T08:00:00Z');
    expect((await activity.read(500, {}, '2026-11-15T08:00:00Z')).total).toBe(0);
    await activity.append(activityInput(audit(), 'worker.started', 'info'));
    await activity.clear(); expect((await activity.read()).total).toBe(0);
    await activity.append(activityInput(audit(), 'worker.started', 'info'));
    await history.clearAll(); expect((await activity.read()).total).toBe(0);
  });

  it('validates message and log allowlists instead of accepting source data, arbitrary error strings or external destinations', () => {
    const id = crypto.randomUUID();
    const safe = activityInput(audit(), 'task.status', 'succeeded', { from: 'open', to: 'done' });
    const projected = validateActivityInput({ ...safe, requestUrl: 'https://example.test/private', studentId: 123,
      data: { ...safe.data, title: 'Synthetic private title', cookie: 'synthetic-secret' } });
    expect(projected).toEqual(safe);
    expect(validateActivityInput({ ...safe, data: { reason: 'synthetic-secret-error' } })).toBeNull();
    expect(validateActivityInput({ ...safe, profileId: 'student-123' })).toBeNull();
    expect(validateConnectionMessage({ type: 'tasks.update', itemId: id, status: 'done' })).toEqual({ type: 'tasks.update', itemId: id, status: 'done' });
    expect(validateConnectionMessage({ type: 'tasks.update', itemId: id, status: 'complete' })).toBeNull();
    expect(validateConnectionMessage({ type: 'tasks.update', itemId: id, status: 'done', scopeId: 'other-profile' })).toBeNull();
    expect(validateConnectionMessage({ type: 'tasks.updateMany', itemIds: [id], status: 'done' })).toEqual({ type: 'tasks.updateMany', itemIds: [id], status: 'done' });
    for (const itemIds of [[], [id, id], ['invalid'], Array.from({ length: 5001 }, () => crypto.randomUUID())]) {
      expect(validateConnectionMessage({ type: 'tasks.updateMany', itemIds, status: 'done' })).toBeNull();
    }
    expect(validateConnectionMessage({ type: 'tasks.updateMany', itemIds: [id], status: 'done', scopeId: 'other-profile' })).toBeNull();
    expect(validateConnectionMessage({ type: 'tasks.updateMany', itemIds: [id], status: 'complete' })).toBeNull();
    expect(validateConnectionMessage({ type: 'activity.read', correlationId: id })).toEqual({ type: 'activity.read', correlationId: id });
    expect(validateConnectionMessage({ type: 'activity.read', limit: 999999 })).toBeNull();
    expect(validateConnectionMessage({ type: 'activity.read', requestUrl: 'https://example.test/' })).toBeNull();
    expect(validateConnectionMessage({ type: 'browser.alerts.rendered', alertIds: [id, id] })).toBeNull();
    expect(validateTasksView({ ok: true, entries: [{ id, status: 'done' }] })).toBeNull();
  });

  it('renders busy/done controls as mutually exclusive checkboxes with readable status labels', () => {
    for (const status of ['open', 'in-progress', 'done'] as const) {
      const html = renderToStaticMarkup(<TaskControls status={status} disabled={false} onChange={() => {}} />);
      expect((html.match(/checked=""/g) ?? []).length).toBe(status === 'open' ? 0 : 1);
      expect(html).toContain('Bezig'); expect(html).toContain('Klaar');
    }
    expect(renderToStaticMarkup(<TaskControls status="done" disabled onChange={() => {}} />)).toContain('disabled=""');
  });
});
