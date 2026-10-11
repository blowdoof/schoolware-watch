import { withCompatiblePolicy } from './fixtures/sync-compatibility';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { HistoryRepository } from '../src/storage/history';
import { progressSync, synchronizeProgress } from '../src/background/progress-sync';
import { encryptProgress, decryptProgress } from '../src/domain/progress-sync';
import { planningOperations, sharedSpecialDay, isPlanningFragment, assemblePlanning, planningResource, type PlanningValue } from '../src/shared/planning-sync';
import { createSchoolbagView, createStableSchoolbagView } from '../src/shared/schoolbag';
import { availablePackingChoices } from '../src/domain/schoolbag';
import { applySharedPlanning } from '../src/domain/shared-planning';
import { check, point } from './fixtures/observations';
import { specialDay } from './fixtures/special-days';

const token = 'a'.repeat(64); const key = 'b'.repeat(64);
const code = `sw1.${token}.${key}`;
const history = new HistoryRepository();
beforeEach(() => {
  vi.spyOn(progressSync, 'announceVersion').mockResolvedValue(undefined);
  vi.setSystemTime(new Date('2026-10-09T12:00:00Z'));
  vi.stubGlobal('indexedDB', new IDBFactory());
  vi.stubGlobal('chrome', { permissions: { contains: vi.fn().mockResolvedValue(true) }, storage: { local: { get: vi.fn().mockResolvedValue({}) } } });
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

function syntheticServer(pageSize = 200) {
  const groups = new Map<string, { id: string; iv: string; ciphertext: string; revision: number }[]>();
  const fetcher = vi.fn(async (_url: string, options: RequestInit) => {
    const body = JSON.parse(options.body as string);
    const headers = options.headers as Record<string, string>;
    const records = groups.get(headers.Authorization!) ?? []; groups.set(headers.Authorization!, records);
    expect(body.action).toBe('exchange'); expect(options.credentials).toBe('omit');
    for (const operation of body.operations) {
      expect(operation.ciphertext.length).toBeLessThanOrEqual(2048);
      expect(Object.keys(operation).sort()).toEqual(['ciphertext', 'id', 'iv']);
      if (!records.some((record) => record.id === operation.id)) records.push({ ...operation, revision: records.length + 1 });
    }
    const operations = records.filter((record) => record.revision > body.cursor).slice(0, pageSize);
    return Response.json({ ok: true, acknowledged: body.operations.map((operation: { id: string }) => operation.id),
      operations, cursor: operations.at(-1)?.revision ?? records.length, head: records.length });
  });
  stubFetch(fetcher); return { fetcher, groups };
}
async function drain(scopeId: string) {
  let changed = false;
  for (let attempt = 0; attempt < 300; attempt++) {
    changed = await synchronizeProgress(scopeId) || changed;
    const state = (await progressSync.read())!;
    expect(state.error).toBe(false);
    if ((await progressSync.view()).pending === 0 && state.cursor === state.head) return changed;
  }
  throw new Error('Synthetic synchronization did not settle');
}

describe('encrypted shared planning transport', () => {
  it('retires edited checklist identities across devices and ignores late old completion', async () => {
    syntheticServer(); const deviceA = globalThis.indexedDB; const deviceB = new IDBFactory();
    const a = await history.record(check()); await progressSync.connect(a.scopeId, code, false);
    const day = specialDay(); await history.saveSpecialDay(a.scopeId, day);
    let saved = (await history.read(a.scopeId)).scope!.specialDays![0]!;
    await history.saveSpecialDay(a.scopeId, { ...saved, checklist: saved.checklist.map((p) => ({ ...p, done: true })) });
    await drain(a.scopeId);
    vi.stubGlobal('indexedDB', deviceB);
    const b = await history.record(check()); await progressSync.connect(b.scopeId, code, false); await drain(b.scopeId);
    const oldB = (await history.read(b.scopeId)).scope!.specialDays![0]!;
    expect(oldB.checklist[0]!.done).toBe(true);
    vi.stubGlobal('indexedDB', deviceA);
    saved = (await history.read(a.scopeId)).scope!.specialDays![0]!;
    await history.saveSpecialDay(a.scopeId, { ...saved, checklist: saved.checklist.map((p) => ({ ...p, text: 'Synthetic different book' })) });
    const replacement = (await history.read(a.scopeId)).scope!.specialDays![0]!.checklist[0]!;
    expect(replacement).toMatchObject({ done: false, text: 'Synthetic different book' });
    expect(replacement.id).not.toBe(day.checklist[0]!.id);
    expect((await history.read(a.scopeId)).scope!.planningActors?.[`checklist:${day.id}:${day.checklist[0]!.id}`]).toBeUndefined();
    await drain(a.scopeId);
    // B still has old metadata offline and uploads a later completion for its retired point.
    vi.stubGlobal('indexedDB', deviceB);
    await history.saveSpecialDay(b.scopeId, { ...oldB, checklist: oldB.checklist.map((p) => ({ ...p, done: false })) });
    const unchecked = (await history.read(b.scopeId)).scope!.specialDays![0]!;
    await history.saveSpecialDay(b.scopeId, { ...unchecked, checklist: unchecked.checklist.map((p) => ({ ...p, done: true })) });
    await drain(b.scopeId);
    expect((await history.read(b.scopeId)).scope!.specialDays![0]!.checklist[0]).toEqual(replacement);
    vi.stubGlobal('indexedDB', deviceA); await drain(a.scopeId);
    expect((await history.read(a.scopeId)).scope!.specialDays![0]!.checklist[0]).toEqual(replacement);
  });
  it('splits maximal Unicode notes/checklists into legacy-sized encrypted operations and validates every reconstructed field', async () => {
    const entry = specialDay({ notes: '📚'.repeat(2000), title: 'é'.repeat(120), checklist: Array.from({ length: 40 }, () => ({
      id: crypto.randomUUID(), text: 'é'.repeat(200), done: true, pack: true })) });
    const value: PlanningValue = { type: 'special-day', day: entry.day, entry: sharedSpecialDay(entry) };
    const operations = planningOperations(value);
    expect(operations.length).toBeGreaterThan(50);
    const parts: Record<string, string> = {};
    for (const operation of operations) {
      const encrypted = await encryptProgress(key, operation.id, operation.fragment);
      expect(encrypted.ciphertext.length).toBeLessThanOrEqual(2048);
      expect(isPlanningFragment(await decryptProgress(key, operation.id, encrypted.iv, encrypted.ciphertext))).toBe(true);
      parts[operation.fragment.index] = operation.fragment.data;
    }
    expect(assemblePlanning({ count: operations.length, parts, revision: 1 }).value).toEqual(value);
    expect(isPlanningFragment({ ...operations[0]!.fragment, index: 192 })).toBe(false);
    expect(isPlanningFragment({ ...operations[0]!.fragment, sourceId: 'synthetic' })).toBe(false);
  });
  it('shares creation, two independent checklist edits, packing/unpacking, moves and deletion between separate IndexedDB devices', async () => {
    const server = syntheticServer(2);
    const deviceA = new IDBFactory(); const deviceB = new IDBFactory();
    vi.stubGlobal('indexedDB', deviceA);
    const scopeA = await history.record(check({ points: [{ ...point, snapshot: { ...point.snapshot, startsAt: '2026-10-12 09:00:00', instructions: 'Boek pagina 10' } }] }));
    await progressSync.connect(scopeA.scopeId, code, false);
    const entry = specialDay({ notes: 'Synthetic notes '.repeat(100), checklist: [...specialDay().checklist,
      { id: crypto.randomUUID(), text: 'Synthetic lunch', done: false, pack: true }] });
    await history.saveSpecialDay(scopeA.scopeId, entry);
    await drain(scopeA.scopeId);
    vi.stubGlobal('indexedDB', deviceB);
    const scopeB = await history.record(check({ scopeId: check().scopeId.replace('CompletedTaskForLL=30', 'CompletedTaskForLL=31'),
      points: [{ ...point, snapshot: { ...point.snapshot, startsAt: '2026-10-12 09:00:00', instructions: 'Boek pagina 10' } }] }));
    expect(scopeB.items[0]!.localId).not.toBe(scopeA.items[0]!.localId);
    await progressSync.connect(scopeB.scopeId, code, false);
    await synchronizeProgress(scopeB.scopeId);
    expect((await history.read(scopeB.scopeId)).scope?.specialDays ?? []).toEqual([]);
    await drain(scopeB.scopeId);
    let remote = (await history.read(scopeB.scopeId)).scope!.specialDays![0]!;
    expect(remote.title).toBe(entry.title); expect(remote.notes).toBe(entry.notes);
    const choicesB = await availablePackingChoices(await createStableSchoolbagView((await history.read(scopeB.scopeId)).scope), new Date());
    vi.stubGlobal('indexedDB', deviceA);
    let local = (await history.read(scopeA.scopeId)).scope!.specialDays![0]!;
    const choicesA = await availablePackingChoices(await createStableSchoolbagView((await history.read(scopeA.scopeId)).scope), new Date());
    expect([...choicesA]).toEqual([...choicesB]);
    await history.saveSpecialDay(scopeA.scopeId, { ...local, checklist: local.checklist.map((item, index) => index === 0 ? { ...item, done: true } : item) });
    vi.stubGlobal('indexedDB', deviceB);
    await history.saveSpecialDay(scopeB.scopeId, { ...remote, checklist: remote.checklist.map((item, index) => index === 1 ? { ...item, done: true } : item) });
    vi.stubGlobal('indexedDB', deviceA); await drain(scopeA.scopeId);
    vi.stubGlobal('indexedDB', deviceB); await drain(scopeB.scopeId);
    vi.stubGlobal('indexedDB', deviceA); await drain(scopeA.scopeId);
    local = (await history.read(scopeA.scopeId)).scope!.specialDays![0]!;
    expect(local.checklist.map((item) => item.done)).toEqual([true, true]);
    const [packingId, packingDay] = [...choicesA][0]!;
    await history.setPackingChoice(scopeA.scopeId, packingId, packingDay, 'packed'); await drain(scopeA.scopeId);
    vi.stubGlobal('indexedDB', deviceB); await drain(scopeB.scopeId);
    expect((await history.read(scopeB.scopeId)).scope?.schoolbagChoices).toContainEqual({ id: packingId, day: packingDay, state: 'packed' });
    await history.setPackingChoice(scopeB.scopeId, packingId, packingDay, 'hidden'); await drain(scopeB.scopeId);
    vi.stubGlobal('indexedDB', deviceA); await drain(scopeA.scopeId);
    expect((await history.read(scopeA.scopeId)).scope?.schoolbagChoices).toContainEqual({ id: packingId, day: packingDay, state: 'hidden' });
    await history.setPackingChoice(scopeA.scopeId, packingId, packingDay, 'open'); await drain(scopeA.scopeId);
    vi.stubGlobal('indexedDB', deviceB); await drain(scopeB.scopeId);
    expect((await history.read(scopeB.scopeId)).scope?.schoolbagChoices).not.toContainEqual(expect.objectContaining({ id: packingId }));
    remote = (await history.read(scopeB.scopeId)).scope!.specialDays![0]!;
    await history.saveSpecialDay(scopeB.scopeId, { ...remote, day: '2026-10-13' }); await drain(scopeB.scopeId);
    vi.stubGlobal('indexedDB', deviceA); await drain(scopeA.scopeId);
    local = (await history.read(scopeA.scopeId)).scope!.specialDays![0]!;
    expect(local.day).toBe('2026-10-13'); expect(local.checklist.map((item) => item.done)).toEqual([true, true]);
    await history.deleteSpecialDay(scopeA.scopeId, local.id, local.revision); await drain(scopeA.scopeId);
    vi.stubGlobal('indexedDB', deviceB); await drain(scopeB.scopeId);
    expect((await history.read(scopeB.scopeId)).scope?.specialDays).toEqual([]);
    expect(await drain(scopeB.scopeId)).toBe(false);
    for (const call of server.fetcher.mock.calls) {
      expect(call[1].body).not.toContain(entry.title); expect(call[1].body).not.toContain('Boek pagina 10');
      expect(call[1].body).not.toContain(scopeA.scopeId); expect(call[1].body).not.toContain(point.sourceKey);
    }
  });
  it('preserves existing local packing choices during identity upgrade without changing observations', async () => {
    const scope = await history.record(check({ points: [{ ...point, snapshot: { ...point.snapshot, startsAt: '2026-10-12 09:00:00', instructions: 'Werkboek pagina 10' } }] }));
    const old = await availablePackingChoices(createSchoolbagView(scope), new Date());
    const target = [...old][1]!;
    await history.setPackingChoice(scope.scopeId, target[0], target[1], 'packed');
    await history.migratePackingIdentity(scope.scopeId);
    const upgraded = (await history.read(scope.scopeId)).scope!;
    const stable = await availablePackingChoices(await createStableSchoolbagView(upgraded), new Date());
    expect(upgraded.schoolbagChoices).toEqual([{ id: [...stable][1]![0], day: target[1], state: 'packed' }]);
    expect(upgraded.events).toEqual(scope.events); expect(upgraded.checks).toEqual(scope.checks);
    await history.migratePackingIdentity(scope.scopeId);
    expect((await history.read(scope.scopeId)).scope?.schoolbagChoices).toEqual(upgraded.schoolbagChoices);
  });
  it('rolls back a special-day edit when its sync outbox fails to persist', async () => {
    const scope = await history.record(check()); await progressSync.connect(scope.scopeId, code, false);
    const original = IDBObjectStore.prototype.put;
    const failure = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args) {
      if (this.name === 'sync') throw new Error('Synthetic outbox failure');
      return original.apply(this, args);
    });
    try { await expect(history.saveSpecialDay(scope.scopeId, specialDay())).rejects.toThrow(); } finally { failure.mockRestore(); }
    expect((await history.read(scope.scopeId)).scope?.specialDays).toBeUndefined();
    expect((await progressSync.view()).pending).toBe(0);
  });
  it('retains partial fragments across retries, rejects malformed reassembly atomically and protects newer local edits from old acknowledgements', async () => {
    const scope = await history.record(check()); await progressSync.connect(scope.scopeId, code, false);
    const value: PlanningValue = { type: 'special-day', day: '2026-10-12', entry: sharedSpecialDay(specialDay({ notes: 'Synthetic '.repeat(100) })) };
    const operations = planningOperations(value);
    const state = (await progressSync.read())!;
    await progressSync.commit(state, [], 1, {}, 3, [{ fragment: operations[0]!.fragment, revision: 1 }]);
    expect(Object.keys((await progressSync.read())!.planningParts!)).toHaveLength(1);
    expect(await progressSync.apply(scope.scopeId)).toBe(false);
    const corrupt = { ...operations[0]!.fragment, index: 0, count: 1, batch: crypto.randomUUID(), data: btoa('{"bad":true}') };
    await expect(progressSync.commit(state, [], 2, {}, 3, [{ fragment: corrupt, revision: 2 }])).rejects.toThrow();
    expect((await progressSync.read())!.cursor).toBe(1);
    const entry = specialDay(); await history.saveSpecialDay(scope.scopeId, entry);
    const first = (await progressSync.read())!;
    await history.saveSpecialDay(scope.scopeId, { ...entry, revision: 1, notes: 'Newer local note' });
    await progressSync.commit(first, first.planningOutbox!.map((operation) => operation.id), 3, {}, 3);
    expect((await progressSync.read())!.planningOutbox!.length).toBeGreaterThan(0);
  });
  it('keeps the old date visible when a move upload stops before its new metadata is complete', async () => {
    const scope = await history.record(check());
    const entry = specialDay({ notes: 'Synthetic long move '.repeat(100) });
    await history.saveSpecialDay(scope.scopeId, entry);
    await progressSync.connect(scope.scopeId, code, false);
    const state = (await progressSync.read())!;
    const operations = planningOperations({ type: 'special-day-move', previousDay: entry.day,
      entry: sharedSpecialDay({ ...entry, day: '2026-10-13' }) });
    expect(operations.length).toBeGreaterThan(1);
    await progressSync.commit(state, [], 1, {}, 1, [{ fragment: operations[0]!.fragment, revision: 1 }]);
    expect(await progressSync.apply(scope.scopeId)).toBe(false);
    expect((await history.read(scope.scopeId)).scope?.specialDays?.[0]?.day).toBe(entry.day);
    await progressSync.commit(state, [], operations.length, {}, operations.length,
      operations.slice(1).map((operation, index) => ({ fragment: operation.fragment, revision: index + 2 })));
    expect(await progressSync.apply(scope.scopeId)).toBe(true);
    const received = (await history.read(scope.scopeId)).scope!.specialDays!;
    expect(received).toHaveLength(1); expect(received[0]!.day).toBe('2026-10-13');
  });
  it('keeps seed snapshots below explicit edits/deletions and scopes sharing to the paired server group', async () => {
    const server = syntheticServer(); const first = new IDBFactory(); const second = new IDBFactory();
    vi.stubGlobal('indexedDB', first);
    const scope = await history.record(check()); await progressSync.connect(scope.scopeId, code, false);
    const entry = specialDay(); await history.saveSpecialDay(scope.scopeId, entry); await drain(scope.scopeId);
    await history.deleteSpecialDay(scope.scopeId, entry.id, 1); await drain(scope.scopeId);
    vi.stubGlobal('indexedDB', second);
    await history.record(check()); await history.saveSpecialDay(scope.scopeId, entry);
    await progressSync.connect(scope.scopeId, code, false); await drain(scope.scopeId);
    expect((await history.read(scope.scopeId)).scope?.specialDays).toEqual([]);
    await progressSync.disconnect(); await progressSync.connect(scope.scopeId, `sw1.${'c'.repeat(64)}.${key}`, false); await drain(scope.scopeId);
    expect((await history.read(scope.scopeId)).scope?.specialDays).toEqual([]);
    expect(server.groups.size).toBe(2);
  });
  it('does not replay unchanged planning or overwrite pending local values', async () => {
    const scope = await history.record(check()); await progressSync.connect(scope.scopeId, code, false);
    const entry = specialDay(); scope.specialDays = [{ ...entry, revision: 1 }];
    const state = (await progressSync.read())!;
    const value: PlanningValue = { type: 'special-day', day: entry.day, entry: sharedSpecialDay(entry) };
    const resource = planningResource(value);
    state.planningRemote = { [resource]: { value, seed: false, revision: 1 } };
    expect(applySharedPlanning(scope, state, '2026-07-01T00:00:00Z', '2026-10-09')).toBe(false);
    state.planningRemote[resource]!.value = { ...value, entry: { ...sharedSpecialDay(entry), title: 'Remote title' } };
    state.planningOutbox = planningOperations(value);
    expect(applySharedPlanning(scope, state, '2026-07-01T00:00:00Z', '2026-10-09')).toBe(false);
    state.planningOutbox = [];
    expect(applySharedPlanning(scope, state, '2026-07-01T00:00:00Z', '2026-10-09')).toBe(true);
    expect(scope.specialDays[0]?.revision).toBe(2);
    state.planningRemote[resource]!.value = { type: 'special-day', day: entry.day, entry: null };
    expect(applySharedPlanning(scope, state, '2026-07-01T00:00:00Z', '2026-10-09')).toBe(true);
    state.planningRemote[resource]!.value = value;
    expect(applySharedPlanning(scope, state, '2026-07-01T00:00:00Z', '2026-10-09')).toBe(true);
    expect(scope.specialDays[0]!.revision).toBeGreaterThan(2);
  });
});

function stubFetch(fetcher: unknown) { vi.stubGlobal('fetch', withCompatiblePolicy(fetcher)); }
