import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { HistoryRepository } from '../src/storage/history';
import { ProgressSyncRepository } from '../src/storage/progress-sync';
import { openHistoryDatabase } from '../src/storage/database';
import { progressSync, synchronizeProgress } from '../src/background/progress-sync';
import { createTasksView, validateTasksView } from '../src/shared/tasks';
import { isActionStamp, isTaskReview, boundedReviews, type TaskReview } from '../src/shared/participation';
import { progressItemKey, progressVersion } from '../src/domain/progress-sync';
import { planningResource } from '../src/shared/planning-sync';
import { validatePlanningValue, planningOperations, assemblePlanning } from '../src/shared/planning-sync';
import { validateConnectionMessage } from '../src/shared/connection';
import { decryptProgress, encryptProgress } from '../src/domain/progress-sync';
import { TaskParticipation } from '../src/ui/TaskParticipation';
import { check, point } from './fixtures/observations';
import { specialDay } from './fixtures/special-days';

const history = new HistoryRepository();
const code = `sw1.${'a'.repeat(64)}.${'b'.repeat(64)}`;
const audit = { correlationId: crypto.randomUUID(), spanId: crypto.randomUUID(), context: 'dashboard' as const };
beforeEach(() => {
  vi.setSystemTime(new Date('2026-10-02T08:00:00Z'));
  vi.stubGlobal('indexedDB', new IDBFactory());
  vi.stubGlobal('chrome', { permissions: { contains: vi.fn().mockResolvedValue(true) }, storage: { local: { get: vi.fn().mockResolvedValue({}) } } });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });
async function taskView(scopeId: string) {
  const view = createTasksView((await history.read(scopeId)).scope, await progressSync.read());
  expect(validateTasksView(view)).toEqual(view);
  return view.entries[0]!;
}
function syntheticTransport() {
  const operations: { id: string; iv: string; ciphertext: string; revision: number }[] = [];
  const members = new Map<string, object>();
  vi.stubGlobal('fetch', vi.fn(async (_url: unknown, options: RequestInit) => {
    expect(options.body).not.toContain(point.sourceKey); expect(options.body).not.toContain(point.snapshot.title);
    expect(options.body).not.toContain('Synthetic parent');
    const body = JSON.parse(options.body as string);
    if (body.action === 'compatibility') return Response.json({ ok: true, policy: { minimumProtocol: 3, maximumProtocol: 3, minimumVersion: '0.4.0', latestVersion: null } });
    if (body.action === 'members') {
      members.set(body.device.id, { ...body.device, lastSeenAt: '2026-10-02T08:00:00.000Z' });
      return Response.json({ ok: true, members: [...members.values()] });
    }
    expect(body.action).toBe('exchange');
    for (const op of body.operations) if (!operations.some((old) => old.id === op.id)) operations.push({ ...op, revision: operations.length + 1 });
    return Response.json({ ok: true, acknowledged: body.operations.map((op: { id: string }) => op.id),
      operations: operations.filter((op) => op.revision > body.cursor), cursor: operations.length, head: operations.length });
  }));
  return operations;
}
describe('attribution and independent reviews', () => {
  it.each(['checked', 'corrected'] as const)('allows confirming returning content offline for %s', async (kind) => {
    const scope = await history.record(check()); const id = scope.items[0]!.localId!;
    await history.setTaskReview(scope.scopeId, id, kind, true);
    await history.record(check({ checkId: 'synthetic-B', observedAt: '2026-10-02T09:00:00Z',
      points: [{ ...point, snapshot: { ...point.snapshot, instructions: 'Synthetic B' } }] }));
    await history.setTaskReview(scope.scopeId, id, kind, true);
    await history.record(check({ checkId: 'synthetic-A-again', observedAt: '2026-10-02T10:00:00Z' }));
    expect((await taskView(scope.scopeId)).reviews?.every((review) => review.previous)).toBe(true);
    await history.setTaskReview(scope.scopeId, id, kind, true);
    expect((await taskView(scope.scopeId)).reviews?.filter((review) => review.self && !review.previous && review.done)).toHaveLength(1);
    await history.setTaskReview(scope.scopeId, id, kind, false);
    expect((await taskView(scope.scopeId)).reviews?.some((review) => !review.previous && review.done)).toBe(false);
  });

  it('bounds old reviews deterministically without dropping current withdrawals', () => {
    const current = 'f'.repeat(64);
    const actor = { participantId: crypto.randomUUID(), deviceId: null, label: null, at: '2026-10-02T08:00:00Z' };
    const reviews: TaskReview[] = Array.from({ length: 220 }, (_, i) => ({ version: i.toString(16).padStart(64, '0'), kind: 'checked', done: true, actor }));
    const withdrawal: TaskReview = { version: current, kind: 'checked', done: false, actor };
    expect(boundedReviews([...reviews, withdrawal], current)).toEqual(boundedReviews([withdrawal, ...reviews.reverse()], current));
    expect(boundedReviews(reviews.concat(withdrawal), current)).toHaveLength(200);
    expect(boundedReviews(reviews.concat(withdrawal), current)[0]).toEqual(withdrawal);
  });

  it('recovers from an oversized remote review history and applies unrelated progress on repeated sync', async () => {
    const scope = await history.record(check()); await progressSync.connect(scope.scopeId, code, false);
    const state = (await progressSync.read())!;
    const key = await progressItemKey(state.key, point.sourceKey, new URL(scope.scopeId).origin);
    const version = await progressVersion(point.snapshot);
    state.planningOutbox = []; state.outbox = []; state.planningRemote = {};
    const actor = { participantId: scope.localId!, deviceId: null, label: null, at: '2026-10-02T08:00:00Z' };
    for (let i = 0; i < 220; i++) {
      const value = { type: 'task-review' as const, item: key, review: { version: i.toString(16).padStart(64, '0'), kind: 'checked' as const, done: true, actor } };
      state.planningRemote[planningResource(value)] = { value, revision: i + 1, seed: false };
    }
    const withdrawal = { type: 'task-review' as const, item: key, review: { version, kind: 'checked' as const, done: false, actor } };
    state.planningRemote[planningResource(withdrawal)] = { value: withdrawal, revision: 221, seed: false };
    state.cursor = state.head = 221;
    state.remote[`${key}.${version}`] = { version, status: 'done', kind: 'manual', revision: 221 };
    const db = await openHistoryDatabase(); await db.put('sync', state, 'progressSync'); db.close();
    await expect(progressSync.apply(scope.scopeId)).resolves.toBe(true);
    const task = await taskView(scope.scopeId);
    expect(task.status).toBe('done'); expect(task.reviews).toHaveLength(200);
    expect(task.reviews?.find((review) => !review.previous)).toMatchObject({ done: false, self: true });
    await expect(progressSync.apply(scope.scopeId)).resolves.toBe(false);
    expect((await taskView(scope.scopeId)).reviews).toEqual(task.reviews);
    await history.setTaskReview(scope.scopeId, scope.items[0]!.localId!, 'checked', true);
    expect((await taskView(scope.scopeId)).reviews?.find((review) => !review.previous)).toMatchObject({ done: true });
  });
  it('keeps local controls independent from completion, durable across reopen, and bound to meaningful task content', async () => {
    const scope = await history.record(check()); const id = scope.items[0]!.localId!;
    await history.setTaskStatus(scope.scopeId, id, 'done', audit);
    await history.setTaskReview(scope.scopeId, id, 'checked', true);
    await history.setTaskReview(scope.scopeId, id, 'corrected', true);
    const task = await taskView(scope.scopeId);
    expect(task.status).toBe('done'); expect(task.reviews).toHaveLength(2);
    expect(task.reviews?.every((review) => review.self && !review.previous && review.done)).toBe(true);
    expect(task.statusActor?.participantId).toBe(scope.localId);
    const restarted = new HistoryRepository();
    expect((await restarted.read(scope.scopeId)).scope?.items[0]?.reviews).toHaveLength(2);
    await history.record(check({ checkId: 'synthetic-new-check', observedAt: '2026-10-02T09:00:00Z', points: [{ ...point, snapshot: { ...point.snapshot, instructions: 'Synthetic changed instruction' } }] }));
    const changed = await taskView(scope.scopeId);
    expect(changed.reviews?.every((review) => review.previous)).toBe(true);
    expect(changed.status).toBe('in-progress'); expect(changed.statusActor).toBeUndefined();
    const html = renderToStaticMarkup(<TaskParticipation task={changed} disabled={false} />);
    expect(html).toContain('vorige taakinhoud'); expect(html).toContain('Naamloos toestel');
    await history.setTaskReview(scope.scopeId, id, 'checked', true);
    expect((await taskView(scope.scopeId)).reviews?.filter((review) => review.kind === 'checked' && review.done && !review.previous)).toHaveLength(1);
  });

  it('merges two offline reviewers, attributes statuses, and withdraws only the local participant control', async () => {
    const records = syntheticTransport(); const databaseA = globalThis.indexedDB;
    const a = await history.record(check()); const idA = a.items[0]!.localId!;
    await progressSync.connect(a.scopeId, code, false, false, 'Synthetic parent');
    await history.setTaskStatus(a.scopeId, idA, 'done', audit);
    await history.setTaskReview(a.scopeId, idA, 'checked', true);
    await history.setTaskReview(a.scopeId, idA, 'corrected', true);
    const databaseB = new IDBFactory(); vi.stubGlobal('indexedDB', databaseB);
    const b = await history.record(check({ scopeId: a.scopeId.replace('CompletedTaskForLL=30', 'CompletedTaskForLL=31') }));
    const idB = b.items[0]!.localId!;
    await progressSync.connect(b.scopeId, code, false, false, 'Synthetic pupil');
    await history.setTaskReview(b.scopeId, idB, 'checked', true);
    vi.stubGlobal('indexedDB', databaseA); await synchronizeProgress(a.scopeId);
    vi.stubGlobal('indexedDB', databaseB); await synchronizeProgress(b.scopeId);
    const taskB = await taskView(b.scopeId);
    expect(taskB.statusActor?.label).toBe('Synthetic parent'); expect(taskB.status).toBe('done');
    expect(taskB.reviews?.filter((review) => review.done)).toHaveLength(3);
    vi.stubGlobal('indexedDB', databaseA); await synchronizeProgress(a.scopeId);
    await history.setTaskReview(a.scopeId, idA, 'checked', false); await synchronizeProgress(a.scopeId);
    vi.stubGlobal('indexedDB', databaseB); await synchronizeProgress(b.scopeId);
    const after = await taskView(b.scopeId);
    expect(after.reviews?.filter((review) => review.kind === 'checked' && review.done).map((review) => review.actor.label)).toEqual(['Synthetic pupil']);
    expect(after.reviews?.some((review) => review.kind === 'corrected' && review.done && review.actor.label === 'Synthetic parent')).toBe(true);
    const count = records.length; await synchronizeProgress(b.scopeId); expect(records).toHaveLength(count);
    const html = renderToStaticMarkup(<TaskParticipation task={after} disabled={false} />);
    expect(html).toContain('Status gewijzigd door'); expect(html).toContain('Synthetic parent'); expect(html).toContain('Synthetic pupil');
  });

  it('seeds previously local reviews without exposing agenda data or inventing an old author', async () => {
    syntheticTransport(); const scope = await history.record(check()); const id = scope.items[0]!.localId!;
    await history.setTaskReview(scope.scopeId, id, 'checked', true);
    await progressSync.connect(scope.scopeId, code, false); await synchronizeProgress(scope.scopeId);
    expect(Object.values((await progressSync.read())!.planningRemote!).some((record) => record.value.type === 'task-review')).toBe(true);
    expect((await taskView(scope.scopeId)).statusActor).toBeUndefined();
  });

  it('keeps pending reviews and attribution intact while compatibility is unavailable', async () => {
    const scope = await history.record(check()); await progressSync.connect(scope.scopeId, code, false);
    await history.setTaskReview(scope.scopeId, scope.items[0]!.localId!, 'checked', true);
    const previous = (await progressSync.read())!.planningOutbox;
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Synthetic offline')));
    await synchronizeProgress(scope.scopeId);
    expect((await progressSync.read())!.planningOutbox).toEqual(previous);
    expect((await taskView(scope.scopeId)).reviews?.[0]).toMatchObject({ done: true, self: true });
  });

  it('records help, packing/unpacking and checklist authors while preserving old unknown metadata', async () => {
    const scope = await history.record(check()); await progressSync.connect(scope.scopeId, code, false, false, 'Synthetic parent');
    await history.setTaskHelp(scope.scopeId, scope.items[0]!.localId!, true, []);
    await history.setPackingChoice(scope.scopeId, 'c'.repeat(64), '2026-10-05', 'packed');
    await history.setPackingChoice(scope.scopeId, 'c'.repeat(64), '2026-10-05', 'open');
    const day = specialDay(); await history.saveSpecialDay(scope.scopeId, day);
    const saved = (await history.read(scope.scopeId)).scope!.specialDays![0]!;
    await history.saveSpecialDay(scope.scopeId, { ...saved, checklist: saved.checklist.map((point) => ({ ...point, done: true })) });
    const updated = (await history.read(scope.scopeId)).scope!;
    expect(updated.items[0]!.helpActor?.label).toBe('Synthetic parent');
    expect(updated.schoolbagChoices).toEqual([]);
    expect(updated.planningActors?.[`packing:${'c'.repeat(64)}`]?.actor.label).toBe('Synthetic parent');
    expect(updated.planningActors?.[`checklist:${day.id}:${day.checklist[0]!.id}`]?.actor.label).toBe('Synthetic parent');
    await history.deleteSpecialDay(scope.scopeId, day.id, updated.specialDays![0]!.revision);
    expect(Object.keys((await history.read(scope.scopeId)).scope!.planningActors!).some((key) => key.startsWith('checklist:'))).toBe(false);
  });

  it('handles maximum Unicode labels within existing ciphertext limits and validates actors and review messages', async () => {
    const actor = { participantId: crypto.randomUUID(), deviceId: crypto.randomUUID(), label: '界'.repeat(48), at: '2026-10-02T08:00:00Z' };
    const payload = { item: 'a'.repeat(64), version: 'b'.repeat(64), status: 'in-progress', kind: 'manual', actor };
    const id = crypto.randomUUID(); const encrypted = await encryptProgress('b'.repeat(64), id, payload);
    expect(encrypted.ciphertext.length).toBeLessThanOrEqual(2048);
    expect(await decryptProgress('b'.repeat(64), id, encrypted.iv, encrypted.ciphertext)).toEqual(payload);
    expect(isActionStamp({ ...actor, label: 'Synthetic\nname' })).toBe(false);
    const review = { version: 'b'.repeat(64), kind: 'checked' as const, done: true, actor };
    expect(isTaskReview(review)).toBe(true);
    const value = { type: 'task-review' as const, item: 'a'.repeat(64), review };
    const parts = planningOperations(value); const assembly = { count: parts.length, parts: Object.fromEntries(parts.map((op) => [op.fragment.index, op.fragment.data])), revision: 1 };
    expect(assemblePlanning(assembly).value).toEqual(value);
    expect(validatePlanningValue({ ...value, actor })).toBeNull();
    expect(validateConnectionMessage({ type: 'tasks.review', itemId: id, kind: 'checked', done: true })).not.toBeNull();
    expect(validateConnectionMessage({ type: 'tasks.review', itemId: id, kind: 'checked', done: true, participantId: actor.participantId })).toBeNull();
  });

  it('reads an existing version-3 database without attribution, preserves pending work, and does not invent actors', async () => {
    const scope = await history.record(check()); const db = await openHistoryDatabase();
    const stored = (await db.get('scopes', scope.scopeId))!;
    stored.items[0]!.taskStatus = 'done'; stored.items[0]!.taskUpdatedAt = '2026-10-02T07:00:00Z';
    await db.put('scopes', stored); db.close();
    expect((await taskView(scope.scopeId)).statusActor).toBeUndefined();
    expect(renderToStaticMarkup(<TaskParticipation task={await taskView(scope.scopeId)} disabled={false} />)).toContain('wie niet geregistreerd');
    expect((await new ProgressSyncRepository().view()).enabled).toBe(false);
    await history.setTaskReview(scope.scopeId, scope.items[0]!.localId!, 'checked', true);
    expect((await taskView(scope.scopeId)).status).toBe('done');
  });
});
