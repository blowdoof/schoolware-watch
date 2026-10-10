import { withCompatiblePolicy } from './fixtures/sync-compatibility';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { HistoryRepository } from '../src/storage/history';
import { ProgressSyncRepository } from '../src/storage/progress-sync';
import { progressSync, synchronizeProgress } from '../src/background/progress-sync';
import { notifyHelpRequests } from '../src/background/progress-notifications';
import { validateConnectionMessage } from '../src/shared/connection';
import { createTasksView, validateTasksView } from '../src/shared/tasks';
import { validateTaskHelp } from '../src/shared/task-help';
import { planningOperations, type PlanningValue } from '../src/shared/planning-sync';
import { progressItemKey, decryptProgress } from '../src/domain/progress-sync';
import { DEFAULT_PREFERENCES, PREFERENCES_KEY } from '../src/shared/preferences';
import { TodoOverview } from '../src/ui/TodoPanel';
import { tasksCsv } from '../src/domain/csv';
import { check, point } from './fixtures/observations';

const code = `sw1.${'a'.repeat(64)}.${'b'.repeat(64)}`;
const history = new HistoryRepository();
const audit = { correlationId: crypto.randomUUID(), spanId: crypto.randomUUID(), context: 'system' as const };
let enabled: boolean;
let permission: boolean;
const create = vi.fn();
beforeEach(() => {
  vi.spyOn(progressSync, 'announceVersion').mockResolvedValue(undefined);
  vi.setSystemTime(new Date('2026-10-09T12:00:00Z'));
  vi.stubGlobal('indexedDB', new IDBFactory()); enabled = true; permission = true;
  create.mockReset().mockResolvedValue('synthetic');
  vi.stubGlobal('chrome', { permissions: { contains: vi.fn(async (v: chrome.permissions.Permissions) => v.permissions ? permission : true) },
    storage: { local: { get: vi.fn(async () => ({ [PREFERENCES_KEY]: { ...DEFAULT_PREFERENCES, notificationsEnabled: enabled } })) } },
    notifications: { create }, runtime: { getURL: (path: string) => `chrome-extension://synthetic/${path}` } });
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });

function server(pageSize = 200) {
  const records: { id: string; iv: string; ciphertext: string; revision: number }[] = [];
  const fetcher = vi.fn(async (_url: string, options: RequestInit) => {
    const body = JSON.parse(options.body as string);
    expect(body.action).toBe('exchange');
    for (const op of body.operations) {
      expect(Object.keys(op).sort()).toEqual(['ciphertext', 'id', 'iv']);
      if (!records.some((record) => record.id === op.id)) records.push({ ...op, revision: records.length + 1 });
    }
    const operations = records.filter((record) => record.revision > body.cursor).slice(0, pageSize);
    return Response.json({ ok: true, acknowledged: body.operations.map((op: { id: string }) => op.id), operations,
      cursor: operations.at(-1)?.revision ?? records.length, head: records.length });
  });
  stubFetch(fetcher); return fetcher;
}
async function drain(scopeId: string) {
  for (let i = 0; i < 100; i++) {
    await synchronizeProgress(scopeId);
    const state = (await progressSync.read())!;
    expect(state.error).toBe(false);
    if ((await progressSync.view()).pending === 0 && state.cursor === state.head) return;
  }
  throw new Error('Synthetic help exchange did not settle');
}
async function connected() {
  const scope = await history.record(check());
  await progressSync.connect(scope.scopeId, code, false);
  await progressSync.preparePlanning(scope.scopeId);
  return { scope, state: (await progressSync.read())!, id: scope.items[0]!.localId! };
}

describe('independent encrypted help requests', () => {
  it('keeps help alongside every progress status, without recipients, across observation changes and restarts', async () => {
    const scope = await history.record(check()); const id = scope.items[0]!.localId!;
    for (const status of ['open', 'in-progress', 'done'] as const) {
      await history.setTaskStatus(scope.scopeId, id, status, audit);
      await history.setTaskHelp(scope.scopeId, id, true, []);
      expect((await history.read(scope.scopeId)).scope?.items[0]).toMatchObject({ taskStatus: status, taskHelp: { needed: true, recipients: [] } });
    }
    const next = await history.record(check({ checkId: 'synthetic-next', observedAt: '2026-10-09T12:00:00Z',
      points: [{ ...point, snapshot: { ...point.snapshot, title: 'Synthetic revised task' } }] }));
    expect(next.items[0]).toMatchObject({ taskStatus: 'in-progress', taskHelp: { needed: true } });
    await new HistoryRepository().setTaskHelp(scope.scopeId, id, false, []);
    expect((await history.read(scope.scopeId)).scope?.items[0]).toMatchObject({ taskStatus: 'in-progress', taskHelp: { needed: false, recipients: [] } });
    expect(create).not.toHaveBeenCalled();
  });

  it('delivers only to two selected devices, once per request, including first download, and encrypts all addressing', async () => {
    const fetcher = server(1);
    const devices = [];
    for (let n = 0; n < 4; n++) {
      const factory = new IDBFactory(); vi.stubGlobal('indexedDB', factory);
      const scope = await history.record(check({ scopeId: check().scopeId.replace('CompletedTaskForLL=30', `CompletedTaskForLL=${30 + n}`) }));
      await progressSync.connect(scope.scopeId, code, false);
      devices.push({ factory, scope, state: (await progressSync.read())!, id: scope.items[0]!.localId! });
    }
    const roster = devices.map((device, i) => ({ id: device.state.connectionId, label: `Synthetic person ${i}`, lastSeenAt: '2026-10-09T12:00:00.000Z' }));
    for (const device of devices) { vi.stubGlobal('indexedDB', device.factory); await progressSync.commitMembers(device.state, roster); }
    const sender = devices[0]!; const recipients = [devices[1]!.state.connectionId, devices[2]!.state.connectionId];
    vi.stubGlobal('indexedDB', sender.factory);
    await history.setTaskStatus(sender.scope.scopeId, sender.id, 'done', audit);
    await history.setTaskHelp(sender.scope.scopeId, sender.id, true, recipients); await drain(sender.scope.scopeId);
    expect(create).not.toHaveBeenCalled();
    const request = (await history.read(sender.scope.scopeId)).scope!.items[0]!.taskHelp!;
    for (let n = 1; n < 4; n++) {
      create.mockClear(); const device = devices[n]!; vi.stubGlobal('indexedDB', device.factory);
      await drain(device.scope.scopeId);
      const view = createTasksView((await history.read(device.scope.scopeId)).scope, await progressSync.read());
      expect(view.entries[0]).toMatchObject({ status: 'done', help: request, helpForYou: n < 3 });
      expect(create).toHaveBeenCalledTimes(n < 3 ? 1 : 0);
      if (n < 3) expect(create).toHaveBeenCalledWith(`schoolware-watch-help-${request.requestId}`, expect.objectContaining({ message: expect.stringContaining('hulp aan jou gevraagd') }));
      await drain(device.scope.scopeId);
      expect(await new ProgressSyncRepository().claimHelpNotifications(device.scope.scopeId)).toBeNull();
      expect(create).toHaveBeenCalledTimes(n < 3 ? 1 : 0);
    }
    vi.stubGlobal('indexedDB', sender.factory);
    const itemKey = await progressItemKey(sender.state.key, point.sourceKey, new URL(sender.scope.scopeId).origin);
    for (const call of fetcher.mock.calls) {
      expect(call[1].body).not.toContain(point.sourceKey); expect(call[1].body).not.toContain(point.snapshot.title);
      expect(call[1].body).not.toContain(recipients[0]); expect(call[1].body).not.toContain(sender.scope.scopeId);
      for (const op of JSON.parse(call[1].body as string).operations) {
        const raw = JSON.stringify(await decryptProgress(sender.state.key, op.id, op.iv, op.ciphertext));
        expect(raw).not.toContain(point.sourceKey); expect(raw).not.toContain(point.snapshot.title);
      }
    }
    expect((await progressSync.read())?.planningRemote?.[`help:${itemKey}`]?.value).toMatchObject({ type: 'help', help: request });
    await history.setTaskHelp(sender.scope.scopeId, sender.id, true, recipients);
    expect((await progressSync.view()).pending).toBe(0);
    await history.setTaskHelp(sender.scope.scopeId, sender.id, false, []); await drain(sender.scope.scopeId);
    vi.stubGlobal('indexedDB', devices[1]!.factory); create.mockClear(); await drain(devices[1]!.scope.scopeId);
    expect(create).not.toHaveBeenCalled();
    expect((await history.read(devices[1]!.scope.scopeId)).scope?.items[0]).toMatchObject({ taskStatus: 'done', taskHelp: { needed: false } });
    vi.stubGlobal('indexedDB', sender.factory); await history.setTaskHelp(sender.scope.scopeId, sender.id, true, [recipients[0]!]); await drain(sender.scope.scopeId);
    vi.stubGlobal('indexedDB', devices[1]!.factory); await drain(devices[1]!.scope.scopeId); expect(create).toHaveBeenCalledOnce();
  });

  it('rejects unknown, self, cross-profile and malformed recipients without writing a partial change', async () => {
    const { scope, state, id } = await connected();
    await progressSync.commitMembers(state, [{ id: state.connectionId, label: 'Synthetic self', lastSeenAt: '2026-10-09T12:00:00.000Z' }]);
    for (const recipients of [[crypto.randomUUID()], [state.connectionId]])
      await expect(history.setTaskHelp(scope.scopeId, id, true, recipients)).rejects.toThrow('Recipient unavailable');
    await expect(history.setTaskHelp(scope.scopeId.replace('CompletedTaskForLL=30', 'CompletedTaskForLL=31'), id, true, [])).rejects.toThrow();
    expect((await history.read(scope.scopeId)).scope?.items[0]?.taskHelp).toBeUndefined();
    const recipient = crypto.randomUUID();
    const valid = { type: 'tasks.help', itemId: id, needed: true, recipients: [recipient] };
    expect(validateConnectionMessage(valid)).toEqual(valid);
    for (const value of [{ ...valid, recipients: [recipient, recipient] }, { ...valid, recipients: ['bad'] },
      { ...valid, needed: false }, { ...valid, recipients: Array.from({ length: 50 }, () => crypto.randomUUID()) }, { ...valid, secret: 'bad' }])
      expect(validateConnectionMessage(value)).toBeNull();
    expect(validateTaskHelp({ needed: true, recipients: [], requestId: 'bad' })).toBeNull();
  });

  it('keeps pending local help edits and delays delivery until complete pagination, then respects preferences and permission', async () => {
    server(); const { scope, state, id } = await connected();
    const key = await progressItemKey(state.key, point.sourceKey, new URL(scope.scopeId).origin);
    const remote: PlanningValue = { type: 'help', item: key, help: { needed: true, recipients: [state.connectionId], requestId: crypto.randomUUID() } };
    const parts = planningOperations(remote);
    await progressSync.commit(state, [], parts.length, {}, parts.length + 1, parts.map((op, index) => ({ fragment: op.fragment, revision: index + 1 })));
    expect(await progressSync.apply(scope.scopeId)).toBe(false);
    expect(await progressSync.claimHelpNotifications(scope.scopeId)).toBeNull();
    await history.setTaskHelp(scope.scopeId, id, true, []);
    await progressSync.commit((await progressSync.read())!, [], parts.length + 1, {});
    await progressSync.apply(scope.scopeId);
    expect((await history.read(scope.scopeId)).scope?.items[0]?.taskHelp?.recipients).toEqual([]);
    expect(await progressSync.claimHelpNotifications(scope.scopeId)).toBeNull();
    // Remove the pending edit without changing the received request, as an acknowledged edit would do.
    const pending = (await progressSync.read())!.planningOutbox!;
    await progressSync.commit((await progressSync.read())!, pending.map((op) => op.id), parts.length + 1, {});
    await progressSync.apply(scope.scopeId);
    enabled = false; await notifyHelpRequests(progressSync, scope.scopeId, async () => {}); expect(create).not.toHaveBeenCalled();
    enabled = true; permission = false; await notifyHelpRequests(progressSync, scope.scopeId, async () => {}); expect(create).not.toHaveBeenCalled();
    permission = true; await notifyHelpRequests(progressSync, scope.scopeId, async () => {}); expect(create).toHaveBeenCalledOnce();
    await notifyHelpRequests(progressSync, scope.scopeId, async () => {}); expect(create).toHaveBeenCalledOnce();
  });

  it('stores help and encrypted outbox atomically when storage fails', async () => {
    const { scope, id } = await connected();
    const original = IDBObjectStore.prototype.put;
    const spy = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore['put']>) {
      if (this.name === 'sync') throw new Error('Synthetic storage failure');
      return original.apply(this, args);
    });
    await expect(history.setTaskHelp(scope.scopeId, id, true, [])).rejects.toThrow('Synthetic storage failure'); spy.mockRestore();
    expect((await history.read(scope.scopeId)).scope?.items[0]?.taskHelp).toBeUndefined();
    expect((await progressSync.view()).pending).toBe(0);
  });

  it('bootstraps existing flags without stale recipients and keeps explicit remote cancellation ahead of seeds', async () => {
    server(); const { scope, state, id } = await connected();
    const oldRecipient = crypto.randomUUID();
    await progressSync.commitMembers(state, [{ id: oldRecipient, label: 'Synthetic old participant', lastSeenAt: '2026-10-09T12:00:00.000Z' }]);
    await history.setTaskHelp(scope.scopeId, id, true, [oldRecipient]);
    await progressSync.disconnect();
    await progressSync.connect(scope.scopeId, code, false);
    await progressSync.preparePlanning(scope.scopeId);
    await drain(scope.scopeId);
    expect((await history.read(scope.scopeId)).scope?.items[0]?.taskHelp).toMatchObject({ needed: true, recipients: [] });
    const current = (await progressSync.read())!;
    const key = await progressItemKey(current.key, point.sourceKey, new URL(scope.scopeId).origin);
    const cancellation: PlanningValue = { type: 'help', item: key, help: { needed: false, recipients: [], requestId: crypto.randomUUID() } };
    const cancelled = planningOperations(cancellation);
    await progressSync.commit(current, [], current.cursor + cancelled.length, {}, current.cursor + cancelled.length,
      cancelled.map((op, i) => ({ fragment: op.fragment, revision: current.cursor + i + 1 })));
    const stale: PlanningValue = { type: 'help', item: key, help: { needed: true, recipients: [], requestId: crypto.randomUUID() } };
    const seeds = planningOperations(stale, true); const latest = (await progressSync.read())!;
    await progressSync.commit(latest, [], latest.cursor + seeds.length, {}, latest.cursor + seeds.length,
      seeds.map((op, i) => ({ fragment: op.fragment, revision: latest.cursor + i + 1 })));
    await progressSync.apply(scope.scopeId);
    expect((await history.read(scope.scopeId)).scope?.items[0]?.taskHelp?.needed).toBe(false);
    expect(create).not.toHaveBeenCalled();
  });

  it('claims a batch durably before API failure and never replays superseded or unaddressed requests', async () => {
    const { scope, state } = await connected();
    const values: PlanningValue[] = [
      { type: 'help', item: '1'.repeat(64), help: { needed: true, recipients: [state.connectionId], requestId: crypto.randomUUID() } },
      { type: 'help', item: '2'.repeat(64), help: { needed: true, recipients: [state.connectionId], requestId: crypto.randomUUID() } },
      { type: 'help', item: '3'.repeat(64), help: { needed: false, recipients: [], requestId: crypto.randomUUID() } },
      { type: 'help', item: '4'.repeat(64), help: { needed: true, recipients: [crypto.randomUUID()], requestId: crypto.randomUUID() } },
    ];
    const parts = values.flatMap((value) => planningOperations(value));
    await progressSync.commit(state, [], parts.length, {}, parts.length, parts.map((op, i) => ({ fragment: op.fragment, revision: i + 1 })));
    create.mockRejectedValueOnce(new Error('Synthetic notification failure'));
    const report = vi.fn().mockResolvedValue(undefined);
    await expect(notifyHelpRequests(progressSync, scope.scopeId, report)).resolves.toBeUndefined();
    expect(create).toHaveBeenCalledOnce();
    expect(report).toHaveBeenCalledWith('notification.progress', 'failed', { reason: 'api-error' });
    await notifyHelpRequests(new ProgressSyncRepository(), scope.scopeId, report);
    expect(create).toHaveBeenCalledOnce();
    expect(Object.keys((await progressSync.read())!.helpNotificationClaims!)).toHaveLength(2);
    expect(await progressSync.claimHelpNotifications(scope.scopeId.replace('CompletedTaskForLL=30', 'CompletedTaskForLL=31'))).toBeNull();
  });

  it('shows done/old/future help requests prominently and exports the independent flag', async () => {
    const scope = await history.record(check()); const id = scope.items[0]!.localId!;
    await history.setTaskStatus(scope.scopeId, id, 'done', audit); await history.setTaskHelp(scope.scopeId, id, true, []);
    const view = createTasksView((await history.read(scope.scopeId)).scope);
    expect(validateTasksView(view)).toEqual(view);
    const html = renderToStaticMarkup(<TodoOverview view={view} now={new Date()} working={false} update={async () => {}} updateMany={async () => {}} updateHelp={async () => {}} />);
    expect(html).toContain('aria-label="Hulpvragen"'); expect(html).toContain(point.snapshot.title); expect(html).toContain('Bewaard zonder ontvanger');
    expect(tasksCsv(view.entries)).toContain('"Klaar";"Ja"');
    expect(validateTasksView({ ...view, helpRecipients: [{ id: crypto.randomUUID(), label: '' }] })).toBeNull();
  });
});

function stubFetch(fetcher: unknown) { vi.stubGlobal('fetch', withCompatiblePolicy(fetcher)); }
