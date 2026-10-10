import { withCompatiblePolicy } from './fixtures/sync-compatibility';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HistoryRepository } from '../src/storage/history';
import { progressSync, synchronizeProgress, synchronizeMembers, leaveSyncMembers } from '../src/background/progress-sync';
import { decryptProgress, encryptProgress } from '../src/domain/progress-sync';
import { SYNC_URL } from '../src/shared/progress-sync';
import { check } from './fixtures/observations';

const token = 'a'.repeat(64); const key = 'b'.repeat(64);
const history = new HistoryRepository();
const audit = () => ({ correlationId: crypto.randomUUID(), spanId: crypto.randomUUID(), context: 'dashboard' as const });
beforeEach(() => {
  vi.spyOn(progressSync, 'announceVersion').mockResolvedValue(undefined);
  vi.stubGlobal('indexedDB', new IDBFactory());
  vi.stubGlobal('chrome', { permissions: { contains: vi.fn().mockResolvedValue(true) } });
});
afterEach(() => vi.unstubAllGlobals());

describe('bounded progress transport', () => {
  it.each([401, 403, 409])('stops durable automatic retries after HTTP %s until explicitly resumed', async (status) => {
    const scope = await history.record(check());
    await progressSync.connect(scope.scopeId, `sw1.${token}.${key}`, false, status === 403);
    const fetcher = vi.fn().mockResolvedValue(new Response('', { status }));
    stubFetch(fetcher);
    await synchronizeProgress(scope.scopeId);
    expect((await progressSync.view()).blocked).toBe(true);
    await synchronizeProgress(scope.scopeId);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await progressSync.resume();
    await synchronizeProgress(scope.scopeId);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('shares only encrypted self-chosen names and reads participants without changing task progress', async () => {
    const scope = await history.record(check());
    await progressSync.connect(scope.scopeId, `sw1.${token}.${key}`, false, false, 'Synthetic parent');
    const state = (await progressSync.read())!;
    const other = crypto.randomUUID();
    const encrypted = await encryptProgress(key, `member:${other}`, { label: 'Synthetic pupil' });
    const lastSeenAt = '2026-10-04T09:00:00.000Z';
    stubFetch(vi.fn(async (_url: string, options: RequestInit) => {
      const body = JSON.parse(options.body as string);
      expect(body.action).toBe('members'); expect(body.device.id).toBe(state.connectionId);
      expect(options.body).not.toContain('Synthetic parent');
      expect(options.body).not.toContain(scope.scopeId);
      expect(await decryptProgress(key, `member:${state.connectionId}`, body.device.iv, body.device.ciphertext)).toEqual({ label: 'Synthetic parent' });
      return Response.json({ ok: true, members: [{ ...body.device, lastSeenAt }, { id: other, ...encrypted, lastSeenAt }] });
    }));
    await synchronizeMembers(state);
    expect((await progressSync.view()).members).toEqual([
      { id: state.connectionId, label: 'Synthetic parent', lastSeenAt, self: true },
      { id: other, label: 'Synthetic pupil', lastSeenAt, self: false },
    ]);
    expect((await progressSync.read())!.cursor).toBe(0);
    expect((await history.read(scope.scopeId)).scope!.events).toEqual(scope.events);
    // Tampering never partially replaces a previously verified participant list.
    stubFetch(vi.fn().mockResolvedValue(Response.json({ ok: true, members: [{ id: other, ...encrypted, ciphertext: '0'.repeat(64), lastSeenAt }] })));
    await synchronizeMembers(state);
    expect((await progressSync.view()).membersError).toBe(true);
    expect((await progressSync.view()).members).toHaveLength(2);
  });
  it('keeps progress synchronization successful when an older server cannot list participants', async () => {
    const scope = await history.record(check());
    await progressSync.connect(scope.scopeId, `sw1.${token}.${key}`, false, false, 'Synthetic parent');
    await history.setTaskStatus(scope.scopeId, scope.items[0]!.localId!, 'done', audit());
    stubFetch(vi.fn(async (_url: string, options: RequestInit) => {
      const body = JSON.parse(options.body as string);
      if (body.action === 'members') return new Response('{"ok":false}', { status: 400 });
      return Response.json({ ok: true, acknowledged: body.operations.map((operation: { id: string }) => operation.id),
        cursor: 1, head: 1, operations: body.operations.map((operation: object) => ({ ...operation, revision: 1 })) });
    }));
    await synchronizeProgress(scope.scopeId);
    expect(await progressSync.view()).toMatchObject({ pending: 0, error: false, membersError: true });
    expect((await history.read(scope.scopeId)).scope!.items[0]!.taskStatus).toBe('done');
    stubFetch(vi.fn().mockRejectedValue(new Error('Synthetic offline')));
    await leaveSyncMembers(); await progressSync.disconnect();
    expect(await progressSync.read()).toBeUndefined();
  });
  it('retries persisted registration with the same token after a lost reply, before exchanging encrypted progress', async () => {
    const scope = await history.record(check());
    await progressSync.connect(scope.scopeId, `sw1.${token}.${key}`, true, true);
    const initial = (await progressSync.read())!;
    const calls: string[] = [];
    const fetcher = vi.fn(async (_url: string, options: RequestInit) => {
      expect(options.credentials).toBe('omit');
      expect(options.redirect).toBe('error');
      expect((options.headers as Record<string, string>).Authorization).toBe(`Bearer ${token}`);
      expect(options.body).not.toContain(key);
      const body = JSON.parse(options.body as string);
      calls.push(body.action);
      if (calls.length === 1) throw new Error('Synthetic lost registration response');
      if (body.action === 'register') return Response.json({ ok: true });
      return Response.json({ ok: true, acknowledged: [], cursor: 0, head: 0, operations: [] });
    });
    stubFetch(fetcher);
    await synchronizeProgress(scope.scopeId);
    expect((await progressSync.read())!.registrationPending).toBe(true);
    expect((await progressSync.read())!.connectionId).toBe(initial.connectionId);
    await synchronizeProgress(scope.scopeId);
    expect(calls).toEqual(['register', 'register', 'exchange']);
    expect((await progressSync.read())!.registrationPending).toBeUndefined();
    expect((await progressSync.view()).error).toBe(false);
    await synchronizeProgress(scope.scopeId);
    expect(calls).toEqual(['register', 'register', 'exchange', 'exchange']);
  });
  it('keeps registration pending without uploading progress when registration is refused or malformed', async () => {
    const scope = await history.record(check());
    await progressSync.connect(scope.scopeId, `sw1.${token}.${key}`, true, true);
    const fetcher = vi.fn().mockResolvedValue(new Response('{"ok":false}', { status: 429 }));
    stubFetch(fetcher);
    await synchronizeProgress(scope.scopeId);
    expect((await progressSync.read())!.registrationPending).toBe(true);
    expect((await progressSync.view()).error).toBe(true);
    fetcher.mockResolvedValue(Response.json({ ok: true, token: 'untrusted' }));
    await synchronizeProgress(scope.scopeId);
    expect((await progressSync.read())!.registrationPending).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('uploads encrypted status to the fixed origin without Schoolware session material and safely acknowledges retries', async () => {
    const scope = await history.record(check()); await progressSync.connect(scope.scopeId, `sw1.${token}.${key}`, false);
    await history.setTaskStatus(scope.scopeId, scope.items[0]!.localId!, 'done', audit());
    const fetcher = vi.fn(async (url: string, options: RequestInit) => {
      expect(url).toBe(SYNC_URL); expect(options.credentials).toBe('omit'); expect(options.redirect).toBe('error');
      expect(options.body).not.toContain(scope.items[0]!.sourceKey);
      expect(options.body).not.toContain(scope.items[0]!.snapshot.title);
      const body = JSON.parse(options.body as string);
      const operation = body.operations[0];
      const value = await decryptProgress(key, operation.id, operation.iv, operation.ciphertext);
      expect(value).toMatchObject({ status: 'done', kind: 'manual' });
      return Response.json({ ok: true, acknowledged: [operation.id], cursor: 1, head: 1,
        operations: [{ ...operation, revision: 1 }] });
    });
    stubFetch(fetcher);
    await synchronizeProgress(scope.scopeId);
    expect((await progressSync.read())!.outbox).toEqual([]);
    expect((await progressSync.view()).error).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('keeps queued edits and the receive cursor intact on network or decryption failures', async () => {
    const scope = await history.record(check()); await progressSync.connect(scope.scopeId, `sw1.${token}.${key}`, false);
    await history.setTaskStatus(scope.scopeId, scope.items[0]!.localId!, 'done', audit());
    const state = (await progressSync.read())!;
    stubFetch(vi.fn().mockRejectedValue(new Error('Synthetic offline')));
    expect(await synchronizeProgress(scope.scopeId)).toBe(false);
    expect((await progressSync.read())!.outbox).toEqual(state.outbox);
    stubFetch(vi.fn().mockResolvedValue(Response.json({ ok: true, acknowledged: [state.outbox[0]!.id], cursor: 1, head: 1,
      operations: [{ id: state.outbox[0]!.id, revision: 1, iv: '0'.repeat(24), ciphertext: '0'.repeat(320) }] })));
    expect(await synchronizeProgress(scope.scopeId)).toBe(false);
    const after = (await progressSync.read())!;
    expect(after.cursor).toBe(0); expect(after.outbox).toEqual(state.outbox); expect(after.error).toBe(true);
    expect((await history.read(scope.scopeId)).scope!.items[0]!.taskStatus).toBe('done');
  });
  it('does not contact the server for a different local pupil scope or without optional permission', async () => {
    const scope = await history.record(check()); await progressSync.connect(scope.scopeId, `sw1.${token}.${key}`, false);
    const fetcher = vi.fn(); stubFetch(fetcher);
    await synchronizeProgress('another-synthetic-profile');
    vi.stubGlobal('chrome', { permissions: { contains: vi.fn().mockResolvedValue(false) } });
    await synchronizeProgress(scope.scopeId);
    expect(fetcher).not.toHaveBeenCalled();
  });
});

function stubFetch(fetcher: unknown) { vi.stubGlobal('fetch', withCompatiblePolicy(fetcher)); }
