import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { HistoryRepository } from '../src/storage/history';
import { progressSync, synchronizeProgress, checkStoreUpdate } from '../src/background/progress-sync';
import { ProgressSyncRepository } from '../src/storage/progress-sync';
import { APP_VERSION, compareAppVersions, compatibilityIssue, validateSyncPolicy, isAppVersion, type SyncPolicy } from '../src/shared/sync-compatibility';
import { validateSyncView } from '../src/shared/progress-sync';
import { createTasksView } from '../src/shared/tasks';
import { decryptProgress } from '../src/domain/progress-sync';
import { assemblePlanning, isPlanningFragment } from '../src/shared/planning-sync';
import { SyncVersionStatus } from '../src/ui/SyncVersionStatus';
import { check, point } from './fixtures/observations';

const policy: SyncPolicy = { minimumProtocol: 2, maximumProtocol: 2, minimumVersion: '0.3.0', latestVersion: null };
const history = new HistoryRepository();
const code = `sw1.${'a'.repeat(64)}.${'b'.repeat(64)}`;
const audit = { correlationId: crypto.randomUUID(), spanId: crypto.randomUUID(), context: 'dashboard' as const };
const updateCheck = vi.fn();
beforeEach(() => {
  vi.setSystemTime(new Date('2026-10-10T10:00:00Z'));
  vi.stubGlobal('indexedDB', new IDBFactory()); updateCheck.mockReset();
  vi.stubGlobal('chrome', { permissions: { contains: vi.fn().mockResolvedValue(true) },
    storage: { local: { get: vi.fn().mockResolvedValue({}) } }, runtime: { requestUpdateCheck: updateCheck } });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });
async function connected() {
  const scope = await history.record(check()); await progressSync.connect(scope.scopeId, code, false);
  await history.setTaskStatus(scope.scopeId, scope.items[0]!.localId!, 'done', audit);
  return { scope, state: (await progressSync.read())! };
}
describe('version compatibility before content exchange', () => {
  it('validates Chrome version numbers and compares numerically, independently of supported protocol', () => {
    expect(compareAppVersions('0.10.0', '0.9.9')).toBe(1); expect(compareAppVersions('0.3', '0.3.0')).toBe(0);
    for (const v of ['0.3.0-beta', '65536.0', '01.3', '', '1', '1.2.3.4.5']) expect(isAppVersion(v)).toBe(false);
    expect(compatibilityIssue(policy, '0.2.0', 2)).toBe('update-required');
    expect(compatibilityIssue(policy, '0.3.0', 1)).toBe('update-required');
    expect(compatibilityIssue(policy, '0.4.0', 3)).toBe('server-update-required');
    expect(compatibilityIssue(policy, '0.4.0', 2)).toBeNull();
    expect(validateSyncPolicy({ ...policy, latestVersion: '0.2.0' })).toBeNull();
    expect(validateSyncPolicy({ ...policy, maximumProtocol: 1 })).toBeNull();
    expect(validateSyncPolicy({ ...policy, extra: true })).toBeNull();
  });

  it.each([
    { response: () => Response.json({ ok: true, policy: { ...policy, minimumVersion: '0.4.0' } }), issue: 'update-required' },
    { response: () => Response.json({ ok: true, policy: { ...policy, minimumProtocol: 3, maximumProtocol: 3 } }), issue: 'update-required' },
    { response: () => Response.json({ ok: true, policy: { ...policy, minimumProtocol: 1, maximumProtocol: 1 } }), issue: 'server-update-required' },
    { response: () => Response.json({ ok: true, acknowledged: [], operations: [], cursor: 0, head: 0 }), issue: 'server-update-required' },
    { response: () => new Response('', { status: 400 }), issue: 'server-update-required' },
    { response: () => new Response('', { status: 503 }), issue: 'check-unavailable' },
  ])('preserves all queued edits without uploading when $issue', async ({ response, issue }) => {
    const { scope, state } = await connected();
    const fetcher = vi.fn(async (_input: unknown, options: RequestInit) => {
      expect(JSON.parse(options.body as string)).toEqual({ action: 'compatibility' }); return response();
    });
    vi.stubGlobal('fetch', fetcher);
    expect(await synchronizeProgress(scope.scopeId)).toBe(false);
    expect(fetcher).toHaveBeenCalledOnce();
    const after = (await progressSync.read())!;
    expect(after.outbox).toEqual(state.outbox); expect(after.cursor).toBe(0); expect(after.remote).toEqual({});
    expect(after.compatibility?.issue).toBe(issue); expect(after.deviceVersionAnnounced).toBeUndefined();
    await history.setTaskHelp(scope.scopeId, scope.items[0]!.localId!, true, []);
    const view = createTasksView((await history.read(scope.scopeId)).scope, await progressSync.read());
    expect(view.entries[0]).toMatchObject({ status: 'done', help: { needed: true } }); expect(view.syncIssue).toBe(issue);
  });

  it('sends only a bounded policy request offline and does not reuse a previous successful check', async () => {
    const { scope, state } = await connected();
    await progressSync.setCompatibility(state, { checkedAt: '2026-10-09T10:00:00Z', policy, issue: null });
    const fetcher = vi.fn().mockRejectedValue(new Error('Synthetic offline')); vi.stubGlobal('fetch', fetcher);
    await synchronizeProgress(scope.scopeId);
    expect(fetcher).toHaveBeenCalledOnce();
    expect((await progressSync.read())?.compatibility).toMatchObject({ issue: 'check-unavailable', policy: null });
    expect((await progressSync.read())?.outbox).toEqual(state.outbox);
  });

  it('rechecks on the server response, preserving unacknowledged content when policy changes after preflight', async () => {
    const { scope, state } = await connected(); const actions: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_input: unknown, options: RequestInit) => {
      const body = JSON.parse(options.body as string); actions.push(body.action);
      return body.action === 'compatibility' ? Response.json({ ok: true, policy }) : new Response('', { status: 426 });
    }));
    await synchronizeProgress(scope.scopeId);
    expect(actions).toEqual(['compatibility', 'exchange']);
    expect((await progressSync.read())?.outbox).toEqual(state.outbox);
    expect((await progressSync.read())?.compatibility?.issue).toBe('update-required');
    expect((await progressSync.read())?.cursor).toBe(0);
  });

  it('announces anonymous device versions encrypted once, propagates them and avoids stale connection replies', async () => {
    const records: { id: string; iv: string; ciphertext: string; revision: number }[] = [];
    const fetcher = vi.fn(async (_input: unknown, options: RequestInit) => {
      const body = JSON.parse(options.body as string);
      expect(options.credentials).toBe('omit'); expect(options.redirect).toBe('error');
      expect(options.headers).toMatchObject({ 'X-Schoolware-Version': APP_VERSION, 'X-Schoolware-Protocol': '2' });
      expect(options.body).not.toContain(point.sourceKey); expect(options.body).not.toContain(point.snapshot.title);
      if (body.action === 'compatibility') return Response.json({ ok: true, policy });
      expect(body.action).toBe('exchange');
      for (const op of body.operations) {
        expect(Object.keys(op).sort()).toEqual(['ciphertext', 'id', 'iv']);
        if (!records.some((record) => record.id === op.id)) records.push({ ...op, revision: records.length + 1 });
      }
      const operations = records.filter((record) => record.revision > body.cursor);
      return Response.json({ ok: true, operations, acknowledged: body.operations.map((op: { id: string }) => op.id), cursor: records.length, head: records.length });
    });
    vi.stubGlobal('fetch', fetcher); const deviceA = globalThis.indexedDB;
    const { scope, state } = await connected(); await synchronizeProgress(scope.scopeId);
    const viewA = await progressSync.view(); expect(validateSyncView(viewA)).toEqual(viewA);
    expect(viewA.devices).toMatchObject([{ id: state.connectionId, version: APP_VERSION, protocol: 2, self: true }]);
    expect(viewA.members).toBeUndefined();
    const sent = records.length;
    await synchronizeProgress(scope.scopeId); expect(records).toHaveLength(sent);
    const parts: Record<string, string> = {}; let count = 0;
    for (const op of records) {
      const raw = await decryptProgress(state.key, op.id, op.iv, op.ciphertext);
      if (isPlanningFragment(raw)) { parts[raw.index] = raw.data; count = raw.count; }
    }
    expect(assemblePlanning({ count, parts, revision: sent }).value).toMatchObject({ type: 'device-version', deviceId: state.connectionId, version: APP_VERSION });
    vi.stubGlobal('indexedDB', new IDBFactory());
    const other = await history.record(check({ scopeId: scope.scopeId.replace('CompletedTaskForLL=30', 'CompletedTaskForLL=31') }));
    await progressSync.connect(other.scopeId, code, false); await synchronizeProgress(other.scopeId);
    expect((await progressSync.view()).devices).toHaveLength(2);
    vi.stubGlobal('indexedDB', deviceA); await synchronizeProgress(scope.scopeId);
    expect((await progressSync.view()).devices).toHaveLength(2);
    const old = (await progressSync.read())!; await progressSync.disconnect(); await progressSync.connect(scope.scopeId, code, false);
    expect(await new ProgressSyncRepository().setCompatibility(old, { checkedAt: new Date().toISOString(), policy, issue: 'update-required' })).toBe(false);
    expect((await progressSync.read())?.compatibility).toBeUndefined();
  });

  it.each(['update_available', 'no_update', 'throttled', 'unavailable'] as const)('records Store result %s without claiming compatibility or reloading unsaved UI', async (status) => {
    await connected();
    if (status === 'unavailable') updateCheck.mockRejectedValue(new Error('Synthetic unavailable'));
    else updateCheck.mockResolvedValue({ status, ...(status === 'update_available' ? { version: '0.4.0' } : {}) });
    await checkStoreUpdate(); await checkStoreUpdate(); expect(updateCheck).toHaveBeenCalledOnce();
    expect((await progressSync.read())?.storeUpdate?.status).toBe(status);
    expect((await progressSync.read())?.compatibility).toBeUndefined();
    const html = renderToStaticMarkup(<SyncVersionStatus view={await progressSync.view()} working={false} onCheck={() => {}} />);
    expect(html).toContain('Controleren op updates');
    if (status === 'update_available') expect(html).toContain('herstart Chrome');
  });
});
