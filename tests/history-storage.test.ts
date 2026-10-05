import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HistoryRepository, openHistoryDatabase } from '../src/storage/history';
import { check, point } from './fixtures/observations';
import { openDB } from 'idb';
import { compareObservations } from '../src/domain/observations';

const repository = new HistoryRepository('synthetic-history-test');
beforeEach(() => { vi.stubGlobal('indexedDB', new IDBFactory()); });

describe('IndexedDB observation repository', () => {
  it.each([1, 2])('upgrades a version %s database to v3 without losing history, retention or pupil identity', async (version) => {
    const name = `synthetic-legacy-${version}`;
    const before = compareObservations(null, check());
    if (version === 2) {
      before.localId = crypto.randomUUID();
      before.items[0]!.localId = crypto.randomUUID();
    }
    const legacy = await openDB(name, version, { upgrade(db) {
      db.createObjectStore('scopes', { keyPath: 'scopeId' }); db.createObjectStore('settings');
      if (version === 2) {
        const activity = db.createObjectStore('activity', { keyPath: 'sequence', autoIncrement: true });
        for (const key of ['timestamp', 'profileId', 'correlationId', 'itemId']) activity.createIndex(key, key);
      }
    } });
    await legacy.put('scopes', before); await legacy.put('settings', 180, 'retentionDays'); legacy.close();
    const upgraded = await openHistoryDatabase(name);
    expect(upgraded.version).toBe(3);
    const after = await upgraded.get('scopes', before.scopeId);
    expect(after?.events).toEqual(before.events);
    expect(after?.localId).toEqual(before.localId ?? expect.any(String));
    expect(after?.items[0]?.localId).toEqual(before.items[0]!.localId ?? expect.any(String));
    expect(await upgraded.get('settings', 'retentionDays')).toBe(180);
    expect(await upgraded.get('sync', 'progressSync')).toBeUndefined();
    upgraded.close();
  });
  it('rolls back an interrupted v1 upgrade and can retry it', async () => {
    const name = 'synthetic-aborted-upgrade';
    const before = compareObservations(null, check());
    const legacy = await openDB(name, 1, { upgrade(db) { db.createObjectStore('scopes', { keyPath: 'scopeId' }); db.createObjectStore('settings'); } });
    await legacy.put('scopes', before); legacy.close();
    const fail = vi.spyOn(IDBCursor.prototype, 'update').mockImplementation(() => { throw new Error('Synthetic migration failure'); });
    try { await expect(openHistoryDatabase(name)).rejects.toThrow(); } finally { fail.mockRestore(); }
    const unchanged = await openDB(name, 1);
    expect(await unchanged.get('scopes', before.scopeId)).toEqual(before);
    expect([...unchanged.objectStoreNames]).toEqual(['scopes', 'settings']); unchanged.close();
    const retry = await openHistoryDatabase(name);
    expect(retry.version).toBe(3); expect((await retry.get('scopes', before.scopeId))?.localId).toBeDefined(); retry.close();
  });
  it('rolls back a history write if the later audit write fails', async () => {
    const first = await repository.record(check());
    const original = IDBObjectStore.prototype.add;
    const fail = vi.spyOn(IDBObjectStore.prototype, 'add').mockImplementation(function (this: IDBObjectStore, value, key) {
      if (this.name === 'activity') throw new Error('Synthetic late store failure');
      return original.call(this, value, key);
    });
    const input = check({ checkId: 'synthetic-failed-write', observedAt: '2026-10-02T09:00:00Z', points: [{ ...point, snapshot: { ...point.snapshot, title: 'Synthetic changed title' } }] });
    try { await expect(repository.record(input)).rejects.toThrow('Synthetic late store failure'); } finally { fail.mockRestore(); }
    expect((await repository.read(first.scopeId, first.lastSuccessAt)).scope).toEqual(first);
    expect((await repository.record(input)).events.at(-1)!.kind).toBe('changed');
  });
  it('reuses a profile across calendar weeks while preserving installation and selection isolation', async () => {
    const first = await repository.record(check());
    const nextWeek = first.scopeId.replace('2026-10-01', '2026-10-08').replace('2026-10-31', '2026-11-07');
    expect(await repository.resolveProfileLink(nextWeek)).toBe(first.scopeId);
    const otherPupil = nextWeek.replace('CompletedTaskForLL=30', 'CompletedTaskForLL=40');
    expect(await repository.resolveProfileLink(otherPupil)).not.toBe(first.scopeId);
    expect(await repository.resolveProfileLink(nextWeek.replace('schoolware_siw.ksgwl.be', 'schoolware.example.org'))).not.toBe(first.scopeId);
  });
  it('persists packing choices across repository restarts, checks and deletion without sharing them between profiles', async () => {
    const input = check({ observedAt: new Date().toISOString() });
    const day = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
    const id = 'a'.repeat(64);
    await repository.record(input);
    await repository.setPackingChoice(input.scopeId, id, day, 'packed');
    const restarted = new HistoryRepository('synthetic-history-test');
    expect((await restarted.read(input.scopeId)).scope?.schoolbagChoices).toEqual([{ id, day, state: 'packed' }]);
    await restarted.record(check({ checkId: 'synthetic-recheck', observedAt: new Date().toISOString() }));
    expect((await repository.read(input.scopeId)).scope?.schoolbagChoices).toEqual([{ id, day, state: 'packed' }]);
    const otherScope = 'synthetic-other-profile';
    await repository.record(check({ scopeId: otherScope, observedAt: new Date().toISOString() }));
    expect((await repository.read(otherScope)).scope?.schoolbagChoices).toBeUndefined();
    await restarted.setPackingChoice(input.scopeId, id, day, 'hidden');
    expect((await repository.read(input.scopeId)).scope?.schoolbagChoices).toEqual([{ id, day, state: 'hidden' }]);
    await restarted.setPackingChoice(input.scopeId, id, day, 'open');
    expect((await repository.read(input.scopeId)).scope?.schoolbagChoices).toEqual([]);
    await repository.clearScope(input.scopeId);
    expect((await restarted.read(input.scopeId)).scope).toBeNull();
    await expect(restarted.setPackingChoice(input.scopeId, id, day, 'packed')).rejects.toThrow('Profile unavailable');
  });
  it('claims each daily reminder channel atomically, preserves it across checks/restarts and isolates/deletes profile state', async () => {
    const now = new Date('2026-10-02T14:00:00.000Z');
    const input = check({ observedAt: now.toISOString() });
    await repository.record(input);
    const other = new HistoryRepository('synthetic-history-test');
    const claims = await Promise.all([
      repository.claimTodoReminder(input.scopeId, now, ['assignments'], { browser: true, system: true }),
      other.claimTodoReminder(input.scopeId, now, ['assignments'], { browser: true, system: true }),
    ]);
    expect(claims.filter((claim) => claim?.browser)).toHaveLength(1);
    expect(claims.filter((claim) => claim?.system)).toHaveLength(1);
    expect(claims[0]?.id).toBe(claims[1]?.id);
    await repository.record(check({ checkId: 'synthetic-later', observedAt: now.toISOString() }));
    expect(await other.claimTodoReminder(input.scopeId, now, ['assignments'], { browser: true, system: true })).toMatchObject({ browser: false, system: false });
    expect(await other.claimTodoReminder('synthetic-other-profile', now, ['assignments'], { browser: true, system: true })).toBeNull();
    const tomorrow = new Date('2026-10-03T14:00:00.000Z');
    await repository.record(check({ checkId: 'synthetic-next-day', observedAt: tomorrow.toISOString() }));
    const next = await other.claimTodoReminder(input.scopeId, tomorrow, ['assignments'], { browser: true, system: false });
    expect(next).toMatchObject({ browser: true, system: false }); expect(next?.id).not.toBe(claims[0]?.id);
    expect(await other.claimTodoReminder(input.scopeId, tomorrow, ['assignments'], { browser: true, system: true })).toMatchObject({ id: next?.id, browser: false, system: true });
    await repository.clearScope(input.scopeId);
    expect(await other.claimTodoReminder(input.scopeId, tomorrow, ['assignments'], { browser: true, system: true })).toBeNull();
  });
  it('claims a notification atomically once across connections and preserves the claim when checks are retried', async () => {
    const input = check();
    await repository.record(input);
    const other = new HistoryRepository('synthetic-history-test');
    const results = await Promise.all([repository.claimNotification(input.scopeId, input.checkId, input.observedAt),
      other.claimNotification(input.scopeId, input.checkId, input.observedAt)]);
    expect(results.sort()).toEqual([false, true]);
    await repository.record(input);
    expect(await other.claimNotification(input.scopeId, input.checkId, input.observedAt)).toBe(false);
    expect(await other.claimNotification(input.scopeId, 'unknown-check', input.observedAt)).toBe(false);
    await repository.clearScope(input.scopeId);
    expect(await repository.claimNotification(input.scopeId, input.checkId, input.observedAt)).toBe(false);
  });
  it('creates the versioned schema and preserves committed state across connections', async () => {
    const db = await openHistoryDatabase('synthetic-history-test');
    expect(db.version).toBe(3);
    expect([...db.objectStoreNames]).toEqual(['activity', 'scopes', 'settings', 'sync']);
    db.close();
    const first = await repository.record(check());
    const restarted = new HistoryRepository('synthetic-history-test');
    expect((await restarted.read(first.scopeId, first.lastSuccessAt)).scope).toEqual(first);
  });

  it('stores scope, versions/events and successful-check metadata atomically and idempotently', async () => {
    const first = await repository.record(check());
    const nextInput = check({ checkId: 'next', observedAt: '2026-10-02T09:00:00.000Z',
      points: [{ ...point, snapshot: { ...point.snapshot, title: 'Synthetic update' } }] });
    const next = await repository.record(nextInput);
    expect(next.events).toHaveLength(2);
    expect(next.checks).toHaveLength(2);
    expect(await repository.record(nextInput)).toEqual(next);
    await expect(repository.record(check({ checkId: 'bad', observedAt: '2026-10-02T10:00:00.000Z', points: [point, point] }))).rejects.toThrow();
    expect((await repository.read(first.scopeId, next.lastSuccessAt)).scope).toEqual(next);
  });

  it('aborts a cancelled write without retaining baseline or metadata', async () => {
    const abort = new AbortController(); abort.abort();
    await expect(repository.record(check(), abort.signal)).rejects.toThrow();
    expect((await repository.read(check().scopeId, check().observedAt)).scope).toBeNull();
  });

  it('preserves legacy records and commits notification lesson snapshots atomically with versions and check metadata', async () => {
    const first = await repository.record(check()); // Existing version-1 records have no lesson metadata.
    const updated = check({ checkId: 'notification', observedAt: '2026-10-02T09:00:00.000Z',
      notificationSelection: { days: 3, categories: ['assignments'] },
      points: [{ ...point, lesson: { key: 'synthetic-lesson', subject: 'Synthetic subject', room: 'Synthetic room' },
        snapshot: { ...point.snapshot, title: 'Synthetic update' } }] });
    const next = await repository.record(updated);
    expect(next.checks[0]!.notificationDetails).toBeUndefined();
    const details = next.checks[1]!.notificationDetails!;
    expect(details.lessons[0]!.items[0]!.kind).toBe('changed');
    expect(await repository.record(updated)).toEqual(next);
    const restarted = new HistoryRepository('synthetic-history-test');
    expect((await restarted.read(first.scopeId, next.lastSuccessAt)).scope).toEqual(next);
    const abort = new AbortController(); abort.abort();
    await expect(repository.record({ ...updated, checkId: 'cancelled', observedAt: '2026-10-02T10:00:00Z' }, abort.signal)).rejects.toThrow();
    expect((await restarted.read(first.scopeId, next.lastSuccessAt)).scope).toEqual(next);
    await repository.setRetention(30, '2026-11-15T08:00:00Z');
    expect((await restarted.read(first.scopeId, '2026-11-15T08:00:00Z')).scope).toBeNull();
  });

  it('isolates profiles and window scopes and deletes only the requested selection', async () => {
    await repository.record(check());
    const other = check({ scopeId: 'synthetic-other-profile' });
    await repository.record(other);
    await repository.clearScope(check().scopeId);
    expect((await repository.read(check().scopeId, check().observedAt)).scope).toBeNull();
    expect((await repository.read(other.scopeId, other.observedAt)).scope?.events[0]?.kind).toBe('baseline');
    await repository.clearAll();
    expect((await repository.read(other.scopeId, other.observedAt)).scope).toBeNull();
  });

  it('applies retention immediately across all scopes, without dropping recently observed current items', async () => {
    await repository.record(check());
    await repository.record(check({ scopeId: 'old-profile' }));
    const recent = check({ checkId: 'recent', observedAt: '2026-11-15T08:00:00.000Z' });
    await repository.record(recent);
    await repository.setRetention(30, recent.observedAt);
    const view = await repository.read(recent.scopeId, recent.observedAt);
    expect(view.retentionDays).toBe(30);
    expect(view.scope?.items).toHaveLength(1);
    expect(view.scope?.events).toEqual([]);
    expect((await repository.read('old-profile', recent.observedAt)).scope).toBeNull();
    await expect(repository.setRetention(0)).rejects.toThrow('Invalid retention');
    expect((await repository.read(recent.scopeId, recent.observedAt)).retentionDays).toBe(30);
  });
});
