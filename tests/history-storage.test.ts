import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HistoryRepository, openHistoryDatabase } from '../src/storage/history';
import { check, point } from './fixtures/observations';

const repository = new HistoryRepository('synthetic-history-test');
beforeEach(() => { vi.stubGlobal('indexedDB', new IDBFactory()); });

describe('IndexedDB observation repository', () => {
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
