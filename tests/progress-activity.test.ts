import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HistoryRepository } from '../src/storage/history';
import { ActivityRepository, activityInput } from '../src/storage/activity';
import { progressSync, synchronizeProgress, configureProgressSyncAlarm, deleteRemoteProgress, leaveSyncMembers } from '../src/background/progress-sync';
import { encryptProgress, progressItemKey, progressVersion } from '../src/domain/progress-sync';
import { validateActivityInput, type ActivityReporter } from '../src/shared/activity';
import { check, point } from './fixtures/observations';

const token = 'a'.repeat(64); const key = 'b'.repeat(64); const code = `sw1.${token}.${key}`;
const history = new HistoryRepository(); const activity = new ActivityRepository();
const audit = () => ({ correlationId: crypto.randomUUID(), spanId: crypto.randomUUID(), context: 'alarm' as const });
const empty = () => Response.json({ ok: true, acknowledged: [], operations: [], cursor: 0, head: 0 });
beforeEach(() => {
  vi.stubGlobal('indexedDB', new IDBFactory());
  vi.stubGlobal('chrome', { permissions: { contains: vi.fn().mockResolvedValue(true) },
    alarms: { get: vi.fn().mockResolvedValue(undefined), create: vi.fn().mockResolvedValue(undefined), clear: vi.fn().mockResolvedValue(true) } });
});
afterEach(() => vi.unstubAllGlobals());

describe('private progress activity', () => {
  it('records an incoming edit and all sync stages with one correlation, without remote identifiers, names or secrets', async () => {
    const scope = await history.record(check());
    await progressSync.connect(scope.scopeId, code, false, false, 'Synthetic private parent');
    const state = (await progressSync.read())!;
    const id = crypto.randomUUID(); const item = await progressItemKey(key, point.sourceKey);
    const version = await progressVersion(point.snapshot);
    const encrypted = await encryptProgress(key, id, { item, version, status: 'done', kind: 'manual' });
    const member = await encryptProgress(key, `member:${state.connectionId}`, { label: state.displayName });
    vi.stubGlobal('fetch', vi.fn(async (_url: string, options: RequestInit) => {
      const body = JSON.parse(options.body as string);
      return body.action === 'exchange' ? Response.json({ ok: true, acknowledged: [], cursor: 1, head: 1,
        operations: [{ id, revision: 1, ...encrypted }] }) : Response.json({ ok: true,
        members: [{ id: state.connectionId, ...member, lastSeenAt: '2026-10-04T09:00:00.000Z' }] });
    }));
    const trace = audit();
    const report: ActivityReporter = (action, phase, data) => activity.append(activityInput(trace, action, phase, { ...data, trigger: 'alarm' }));
    expect(await synchronizeProgress(scope.scopeId, report, trace)).toBe(true);
    const entries = (await activity.read()).entries.filter((entry) => entry.action.startsWith('progress.') || entry.data.reason === 'remote-sync');
    expect(entries.every((entry) => entry.correlationId === trace.correlationId)).toBe(true);
    expect(entries.find((entry) => entry.action === 'progress.exchange' && entry.phase === 'succeeded')?.data).toMatchObject({
      uploadedCount: 0, downloadedCount: 1, pendingCount: 0, hasMore: false, trigger: 'alarm' });
    expect(entries.find((entry) => entry.action === 'progress.sync' && entry.phase === 'succeeded')?.data).toMatchObject({ applied: true, reason: 'success' });
    expect(entries.find((entry) => entry.action === 'task.status')).toMatchObject({ itemId: scope.items[0]!.localId,
      data: { reason: 'remote-sync', from: 'open', to: 'done' } });
    expect((await history.read(scope.scopeId)).scope!.events).toEqual(scope.events);
    const exported = JSON.stringify(entries);
    for (const privateValue of [token, key, code, state.connectionId, id, item, version, encrypted.ciphertext,
      'Synthetic private parent', point.sourceKey, point.snapshot.title, scope.scopeId]) expect(exported).not.toContain(privateValue);
  });

  it('records a successful idle exchange even without uploads or changed progress', async () => {
    const scope = await history.record(check()); await progressSync.connect(scope.scopeId, code, false);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(empty()));
    const report = vi.fn<ActivityReporter>().mockResolvedValue(undefined);
    expect(await synchronizeProgress(scope.scopeId, report)).toBe(false);
    expect(report).toHaveBeenCalledWith('progress.exchange', 'succeeded', expect.objectContaining({ uploadedCount: 0, downloadedCount: 0 }));
    expect(report).toHaveBeenCalledWith('progress.sync', 'succeeded', expect.objectContaining({ reason: 'success', applied: false }));
  });

  it('distinguishes a successful page download from a complete sync and defers applying incomplete progress', async () => {
    const scope = await history.record(check()); await progressSync.connect(scope.scopeId, code, false);
    const id = crypto.randomUUID(); const item = await progressItemKey(key, point.sourceKey); const version = await progressVersion(point.snapshot);
    const encrypted = await encryptProgress(key, id, { item, version, status: 'done', kind: 'manual' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ ok: true, acknowledged: [], cursor: 1, head: 2,
      operations: [{ id, revision: 1, ...encrypted }] })));
    const report = vi.fn<ActivityReporter>().mockResolvedValue(undefined);
    await synchronizeProgress(scope.scopeId, report);
    expect(report).toHaveBeenCalledWith('progress.apply', 'skipped', { reason: 'pagination-pending', hasMore: true });
    expect(report).toHaveBeenCalledWith('progress.sync', 'succeeded', expect.objectContaining({ reason: 'partial-success', hasMore: true }));
    expect((await history.read(scope.scopeId)).scope!.items[0]!.taskStatus).toBe('open');
  });

  it.each([
    ['network-error', () => Promise.reject(new Error(`Private error ${code}`)), undefined],
    ['timeout', () => Promise.reject(new DOMException(code, 'TimeoutError')), undefined],
    ['authentication-failed', () => Promise.resolve(new Response(code, { status: 401 })), 401],
    ['rate-limited', () => Promise.resolve(new Response(code, { status: 429 })), 429],
    ['http-error', () => Promise.resolve(new Response(code, { status: 503 })), 503],
    ['invalid-response', () => Promise.resolve(new Response(code)), undefined],
  ] as const)('records %s precisely and preserves the retry outbox without logging exception text', async (reason, response, httpStatus) => {
    const scope = await history.record(check()); await progressSync.connect(scope.scopeId, code, false);
    await history.setTaskStatus(scope.scopeId, scope.items[0]!.localId!, 'done', audit());
    const before = (await progressSync.read())!;
    vi.stubGlobal('fetch', vi.fn().mockImplementation(response));
    const report = vi.fn<ActivityReporter>().mockResolvedValue(undefined);
    expect(await synchronizeProgress(scope.scopeId, report)).toBe(false);
    const expected = { reason, ...(httpStatus ? { httpStatus } : {}) };
    expect(report).toHaveBeenCalledWith('progress.exchange', 'failed', expect.objectContaining(expected));
    expect(report).toHaveBeenCalledWith('progress.sync', 'failed', expect.objectContaining(expected));
    expect((await progressSync.read())!.outbox).toEqual(before.outbox);
    expect(JSON.stringify(report.mock.calls)).not.toContain(code);
  });

  it('records partial success when progress succeeds but participants cannot be updated', async () => {
    const scope = await history.record(check()); await progressSync.connect(scope.scopeId, code, false, false, 'Synthetic private parent');
    vi.stubGlobal('fetch', vi.fn(async (_url: string, options: RequestInit) =>
      JSON.parse(options.body as string).action === 'exchange' ? empty() : new Response('Private server detail', { status: 503 })));
    const report = vi.fn<ActivityReporter>().mockResolvedValue(undefined);
    await synchronizeProgress(scope.scopeId, report);
    expect(report).toHaveBeenCalledWith('progress.members', 'failed', expect.objectContaining({ reason: 'http-error', httpStatus: 503 }));
    expect(report).toHaveBeenCalledWith('progress.sync', 'succeeded', expect.objectContaining({ reason: 'partial-success' }));
    expect(await progressSync.view()).toMatchObject({ error: false, membersError: true });
  });

  it('records decryption failure without acknowledging untrusted encrypted progress', async () => {
    const scope = await history.record(check()); await progressSync.connect(scope.scopeId, code, false);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ ok: true, acknowledged: [], cursor: 1, head: 1,
      operations: [{ id: crypto.randomUUID(), revision: 1, iv: '0'.repeat(24), ciphertext: '0'.repeat(320) }] })));
    const report = vi.fn<ActivityReporter>().mockResolvedValue(undefined);
    await synchronizeProgress(scope.scopeId, report);
    expect(report).toHaveBeenCalledWith('progress.exchange', 'failed', expect.objectContaining({ reason: 'decryption-failed' }));
    expect((await progressSync.read())!.cursor).toBe(0);
    expect((await history.read(scope.scopeId)).scope!.items[0]!.taskStatus).toBe('open');
  });

  it('logs oversized streamed replies as invalid while cancelling the body', async () => {
    const scope = await history.record(check()); await progressSync.connect(scope.scopeId, code, false);
    const cancel = vi.fn();
    const response = new Response(new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new Uint8Array(1_000_001)); }, cancel,
    }));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));
    const report = vi.fn<ActivityReporter>().mockResolvedValue(undefined);
    await synchronizeProgress(scope.scopeId, report);
    expect(report).toHaveBeenCalledWith('progress.exchange', 'failed', expect.objectContaining({ reason: 'invalid-response' }));
    expect(cancel).toHaveBeenCalledOnce();
    expect(response.body?.locked).toBe(false);
  });

  it('records registration failure and successful retry without falsely declaring a failed registration successful', async () => {
    const scope = await history.record(check()); await progressSync.connect(scope.scopeId, code, false, true);
    const fetcher = vi.fn().mockResolvedValueOnce(new Response('', { status: 429 }))
      .mockResolvedValueOnce(Response.json({ ok: true })).mockResolvedValueOnce(empty());
    vi.stubGlobal('fetch', fetcher);
    const report = vi.fn<ActivityReporter>().mockResolvedValue(undefined);
    await synchronizeProgress(scope.scopeId, report);
    expect(report).toHaveBeenCalledWith('progress.registration', 'failed', expect.objectContaining({ reason: 'rate-limited' }));
    expect((await progressSync.read())!.registrationPending).toBe(true);
    await synchronizeProgress(scope.scopeId, report);
    expect(report).toHaveBeenCalledWith('progress.registration', 'succeeded', expect.objectContaining({ reason: 'success' }));
    expect((await progressSync.read())!.registrationPending).toBeUndefined();
  });

  it('records disabled, wrong-profile and missing-permission attempts without sending requests', async () => {
    const report = vi.fn<ActivityReporter>().mockResolvedValue(undefined); const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    await synchronizeProgress(null, report);
    expect(report).toHaveBeenCalledWith('progress.sync', 'skipped', { reason: 'disabled' });
    const scope = await history.record(check()); await progressSync.connect(scope.scopeId, code, false);
    await synchronizeProgress('another-synthetic-profile', report);
    expect(report).toHaveBeenCalledWith('progress.sync', 'skipped', { reason: 'profile-mismatch' });
    vi.mocked(chrome.permissions.contains).mockImplementation(async () => false);
    await synchronizeProgress(scope.scopeId, report);
    expect(report).toHaveBeenCalledWith('progress.sync', 'failed', expect.objectContaining({ reason: 'permission-required' }));
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('does not report an ignored stale reply as a successful sync', async () => {
    const scope = await history.record(check()); await progressSync.connect(scope.scopeId, code, false);
    vi.stubGlobal('fetch', vi.fn(async () => { await progressSync.disconnect(); return empty(); }));
    const report = vi.fn<ActivityReporter>().mockResolvedValue(undefined);
    await synchronizeProgress(scope.scopeId, report);
    expect(report).toHaveBeenCalledWith('progress.sync', 'failed', expect.objectContaining({ reason: 'cancelled' }));
    expect(report.mock.calls.some(([action, phase]) => action === 'progress.sync' && phase === 'succeeded')).toBe(false);
  });

  it('keeps the remote task edit and its audit record atomic, including failed audits and retries', async () => {
    const scope = await history.record(check()); await progressSync.connect(scope.scopeId, code, false);
    const state = (await progressSync.read())!; const item = await progressItemKey(key, point.sourceKey); const version = await progressVersion(point.snapshot);
    await progressSync.commit(state, [], 1, { [`${item}.${version}`]: { version, status: 'done', revision: 1, kind: 'manual' } });
    const trace = audit();
    const beforeLogs = await activity.read();
    await expect(progressSync.apply(scope.scopeId, { ...trace, correlationId: 'invalid' })).rejects.toThrow();
    expect((await history.read(scope.scopeId)).scope!.items[0]!.taskStatus).toBe('open');
    expect(await activity.read()).toEqual(beforeLogs);
    expect(await progressSync.apply(scope.scopeId, trace)).toBe(true);
    expect(await progressSync.apply(scope.scopeId, trace)).toBe(false);
    expect((await activity.read()).entries.filter((entry) => entry.data.reason === 'remote-sync')).toHaveLength(1);
  });

  it('logs alarm setup, leaving and remote deletion; a failed delete keeps the pairing', async () => {
    const scope = await history.record(check()); await progressSync.connect(scope.scopeId, code, false, false, 'Synthetic parent');
    const report = vi.fn<ActivityReporter>().mockResolvedValue(undefined);
    await configureProgressSyncAlarm(report);
    expect(report).toHaveBeenCalledWith('alarm.configured', 'succeeded', expect.objectContaining({ alarm: 'progress-sync', registered: true }));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 503 })));
    await leaveSyncMembers(report);
    expect(report).toHaveBeenCalledWith('progress.leave', 'failed', { reason: 'http-error', httpStatus: 503 });
    await expect(deleteRemoteProgress(report)).rejects.toThrow();
    expect(await progressSync.read()).toBeDefined();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ ok: true })));
    await deleteRemoteProgress(report);
    expect(report).toHaveBeenCalledWith('progress.delete', 'succeeded', { reason: 'success' });
    expect(report).toHaveBeenCalledWith('alarm.configured', 'succeeded', expect.objectContaining({ registered: false }));
    expect(await progressSync.read()).toBeUndefined();
  });

  it('does not turn a diagnostic-write failure into a transport failure', async () => {
    const scope = await history.record(check()); await progressSync.connect(scope.scopeId, code, false);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(empty()));
    await synchronizeProgress(scope.scopeId, vi.fn<ActivityReporter>().mockRejectedValue(new Error('Synthetic logger failure')));
    expect(await progressSync.view()).toMatchObject({ error: false, pending: 0 });
  });

  it('validates new diagnostic fields and rejects arbitrary triggers/status values while projecting away secrets', () => {
    const entry = activityInput(audit(), 'progress.sync', 'succeeded', { trigger: 'alarm', uploadedCount: 2,
      downloadedCount: 0, pendingCount: 0, applied: false, hasMore: false, alarm: 'progress-sync', httpStatus: 503 });
    expect(validateActivityInput({ ...entry, data: { ...entry.data, token, code, name: 'Synthetic private parent' } })).toEqual(entry);
    for (const invalid of [{ trigger: code }, { uploadedCount: -1 }, { downloadedCount: 1.5 }, { pendingCount: '0' },
      { alarm: 'arbitrary-alarm' }, { httpStatus: 99 }, { httpStatus: 600 }, { applied: 'yes' }]) {
      expect(validateActivityInput({ ...entry, data: { ...entry.data, ...invalid } })).toBeNull();
    }
  });
});
