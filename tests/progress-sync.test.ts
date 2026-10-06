import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { progressItemKey, progressVersion, encryptProgress, decryptProgress, hex, unhex } from '../src/domain/progress-sync';
import { parsePairingCode, validateSyncMessage, validateSyncView, normalizeSyncLabel, isSyncMember, isRemoteProgress, SYNC_STATE_KEY } from '../src/shared/progress-sync';
import { HistoryRepository, openHistoryDatabase } from '../src/storage/history';
import { ProgressSyncRepository } from '../src/storage/progress-sync';
import { check, point } from './fixtures/observations';
import { ActivityRepository } from '../src/storage/activity';

const token = 'a'.repeat(64); const key = 'b'.repeat(64); const code = `sw1.${token}.${key}`;
const name = 'synthetic-progress-sync';
const history = new HistoryRepository(name); const sync = new ProgressSyncRepository(name);
const audit = () => ({ correlationId: crypto.randomUUID(), spanId: crypto.randomUUID(), context: 'dashboard' as const });
beforeEach(() => { vi.stubGlobal('indexedDB', new IDBFactory()); vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-03T08:00:00Z')); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('private shared progress', () => {
  it('keeps the latest manual outbox operation when a successful reopening check is retried', async () => {
    const initial = await history.record(check());
    await sync.connect(initial.scopeId, code, false);
    await history.setTaskStatus(initial.scopeId, initial.items[0]!.localId!, 'done', audit());
    const input = check({ checkId: 'synthetic-reopen', observedAt: '2026-10-03T08:00:00Z',
      points: [{ ...point, snapshot: { ...point.snapshot, instructions: 'Synthetic revised instructions' } }] });
    const reopened = await history.record(input);
    await history.setTaskStatus(initial.scopeId, initial.items[0]!.localId!, 'done', audit());
    const before = await sync.read();
    const logs = await new ActivityRepository(name).read();
    const latest = await history.record(input);
    expect(latest.events).toEqual(reopened.events);
    expect(latest.items[0]!.taskStatus).toBe('done');
    expect(await sync.read()).toEqual(before);
    expect(await new ActivityRepository(name).read()).toEqual(logs);
  });
  it('pads all new statuses and labels to the same length while remaining readable by legacy clients', async () => {
    const id = crypto.randomUUID();
    const values: unknown[] = ['open', 'in-progress', 'done'].map((status) => ({ item: 'a'.repeat(64), version: 'b'.repeat(64), status, kind: 'manual' }));
    values.push({ label: 'Synthetic parent' });
    const encrypted = await Promise.all(values.map((value) => encryptProgress(key, id, value)));
    expect(new Set(encrypted.map((value) => value.ciphertext.length)).size).toBe(1);
    expect(encrypted[0]!.ciphertext).toHaveLength(1056);
    for (let index = 0; index < values.length; index++) {
      expect(await decryptProgress(key, id, encrypted[index]!.iv, encrypted[index]!.ciphertext)).toEqual(values[index]);
    }
    const legacyKey = await crypto.subtle.importKey('raw', unhex(key), 'AES-GCM', false, ['encrypt', 'decrypt']);
    const aad = new TextEncoder().encode(`sw1:${id}`);
    const bytes = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unhex(encrypted[0]!.iv), additionalData: aad }, legacyKey, unhex(encrypted[0]!.ciphertext));
    expect(JSON.parse(new TextDecoder().decode(bytes))).toEqual(values[0]);
    const oldIv = crypto.getRandomValues(new Uint8Array(12));
    const oldCiphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: oldIv, additionalData: aad }, legacyKey, new TextEncoder().encode(JSON.stringify(values[0])));
    expect(await decryptProgress(key, id, hex(oldIv), hex(oldCiphertext))).toEqual(values[0]);
    expect(await progressVersion(point.snapshot)).toBe(await progressVersion({ ...point.snapshot, instructions: `${point.snapshot.instructions}\r\n  ` }));
  });
  it('removes credentials, queued progress and participants atomically when retention expires their profile', async () => {
    const first = await history.record(check());
    await sync.connect(first.scopeId, code, false, false, 'Synthetic parent');
    await history.setTaskStatus(first.scopeId, first.items[0]!.localId!, 'done', audit());
    expect((await sync.read())!.outbox).toHaveLength(1);
    const recentDate = '2026-11-15T08:00:00.000Z';
    await history.setRetention(30, recentDate);
    expect(await sync.read()).toBeUndefined();
    expect((await history.read(first.scopeId, recentDate)).scope).toBeNull();
    expect(await new ProgressSyncRepository(name).read()).toBeUndefined();
  });

  it('preserves sharing for retained profiles and cleans credentials orphaned by an older retention implementation', async () => {
    const first = await history.record(check());
    await sync.connect(first.scopeId, code, false);
    await history.setRetention(30, first.lastSuccessAt);
    expect(await sync.read()).toBeDefined();
    const db = await openHistoryDatabase(name);
    await db.delete('scopes', first.scopeId); db.close();
    await history.read(first.scopeId, first.lastSuccessAt);
    expect(await sync.read()).toBeUndefined();
  });
  it('commits bulk completion with its logs and outbox, retries safely and rolls back the whole selection when an item becomes unavailable', async () => {
    const points = [point,
      { ...point, sourceKey: 'synthetic-second', snapshot: { ...point.snapshot, startsAt: '2026-10-02 09:00:00' } },
      { ...point, sourceKey: 'synthetic-future', snapshot: { ...point.snapshot, startsAt: '2026-10-06 09:00:00' } },
    ];
    const first = await history.record(check({ points }));
    const ids = first.items.slice(0, 2).map((item) => item.localId!);
    const activity = new ActivityRepository(name);
    await sync.connect(first.scopeId, code, false);
    await history.setTaskStatus(first.scopeId, ids[0]!, 'in-progress', audit());
    const trace = audit();
    await history.setTaskStatuses(first.scopeId, ids, 'done', trace);
    const restarted = (await new HistoryRepository(name).read(first.scopeId)).scope!;
    expect(restarted.items.map((item) => item.taskStatus)).toEqual(['done', 'done', 'open']);
    expect(restarted.events).toEqual(first.events);
    const outbox = (await sync.read())!.outbox;
    expect(outbox).toHaveLength(2);
    expect(outbox.every((operation) => operation.status === 'done')).toBe(true);
    const logs = await activity.read(500, { correlationId: trace.correlationId });
    expect(logs.entries).toHaveLength(2);
    expect(logs.entries.every((entry) => entry.action === 'task.status' && entry.data.to === 'done')).toBe(true);
    await history.setTaskStatuses(first.scopeId, ids, 'done', audit());
    expect((await sync.read())!.outbox).toEqual(outbox);

    await history.setTaskStatus(first.scopeId, ids[0]!, 'open', audit());
    await history.record(check({ checkId: 'synthetic-hide-second', points: points.map((entry, index) =>
      index === 1 ? { ...entry, snapshot: { ...entry.snapshot, hidden: true } } : entry) }));
    const before = (await history.read(first.scopeId)).scope;
    const syncBefore = await sync.read(); const logsBefore = await activity.read();
    await expect(history.setTaskStatuses(first.scopeId, ids, 'done', audit())).rejects.toThrow('Task unavailable');
    expect((await history.read(first.scopeId)).scope).toEqual(before);
    expect(await sync.read()).toEqual(syncBefore); expect(await activity.read()).toEqual(logsBefore);
    await expect(history.setTaskStatuses(first.scopeId, [ids[0]!], 'done', { ...audit(), correlationId: 'invalid' })).rejects.toThrow();
    expect((await history.read(first.scopeId)).scope).toEqual(before);
    expect(await sync.read()).toEqual(syncBefore); expect(await activity.read()).toEqual(logsBefore);
  });

  it('validates pairing/messages without accepting destinations or extra credentials', () => {
    expect(parsePairingCode(code)).toEqual({ token, key });
    expect(parsePairingCode(`${code}.extra`)).toBeNull();
    expect(validateSyncMessage({ type: 'sync.connect', code, seed: true })).not.toBeNull();
    expect(validateSyncMessage({ type: 'sync.create', code })).toEqual({ type: 'sync.create', code });
    expect(validateSyncMessage({ type: 'sync.create', code, url: 'https://other.example' })).toBeNull();
    expect(validateSyncMessage({ type: 'sync.create', code: 'invalid' })).toBeNull();
    expect(validateSyncMessage({ type: 'sync.pairing', token })).toBeNull();
    const view = { ok: true, enabled: true, pending: 0, lastSuccessAt: null, error: false };
    expect(validateSyncView({ ...view, pairingCode: code, registrationPending: true })).not.toBeNull();
    expect(validateSyncView({ ...view, pairingCode: 'invalid' })).toBeNull();
    expect(validateSyncView({ ...view, registrationPending: 'true' })).toBeNull();
    expect(validateSyncMessage({ type: 'sync.connect', code, seed: true, url: 'https://other.example' })).toBeNull();
    expect(validateSyncMessage({ type: 'sync.run', token })).toBeNull();
    expect(isRemoteProgress({ item: key, version: token, status: 'done', kind: 'manual' })).toBe(true);
    expect(isRemoteProgress({ item: key, version: token, status: 'done', kind: 'manual', title: 'synthetic' })).toBe(false);
  });
  it('validates names and ignores stale participant replies after renaming or disconnecting', async () => {
    expect(normalizeSyncLabel(' Synthetic parent ')).toBe('Synthetic parent');
    for (const invalid of ['', 'x'.repeat(49), 'Synthetic\nname', 'Synthetic\u202ename']) expect(normalizeSyncLabel(invalid)).toBeNull();
    expect(validateSyncMessage({ type: 'sync.name', label: ' Synthetic parent ' })).toEqual({ type: 'sync.name', label: 'Synthetic parent' });
    expect(validateSyncMessage({ type: 'sync.name', label: 'Synthetic', token })).toBeNull();
    const first = await history.record(check());
    await sync.connect(first.scopeId, code, false, false, 'Synthetic parent');
    const before = (await sync.read())!;
    const member = { id: before.connectionId, label: 'Synthetic parent', lastSeenAt: '2026-10-04T09:00:00.000Z' };
    expect(isSyncMember(member)).toBe(true);
    expect(isSyncMember({ ...member, label: null })).toBe(false);
    await sync.commitMembers(before, [member]);
    expect((await sync.view()).members?.[0]?.self).toBe(true);
    await sync.setDisplayName('Synthetic renamed');
    await sync.commitMembers(before, []);
    expect((await sync.view()).members).toHaveLength(1);
    await sync.disconnect();
    await sync.commitMembers(before, [member]);
    expect(await sync.read()).toBeUndefined();
  });
  it('persists registration intent and ignores stale registration replies after reconnection', async () => {
    const first = await history.record(check());
    await sync.connect(first.scopeId, code, true, true);
    const pending = (await sync.read())!;
    expect(pending.registrationPending).toBe(true);
    expect(await sync.view()).toMatchObject({ registrationPending: true });
    expect((await new ProgressSyncRepository(name).read())!.token).toBe(token);
    await sync.disconnect();
    await sync.connect(first.scopeId, code, false, true);
    await sync.registered(pending);
    expect((await sync.read())!.registrationPending).toBe(true);
    await sync.registered((await sync.read())!);
    expect((await sync.read())!.registrationPending).toBeUndefined();
  });
  it('encrypts progress with fresh nonces and authenticates key, ID and ciphertext', async () => {
    const id = crypto.randomUUID(); const item = await progressItemKey(key, point.sourceKey);
    const value = { item, version: await progressVersion(point.snapshot), status: 'done', kind: 'manual' };
    const first = await encryptProgress(key, id, value); const second = await encryptProgress(key, id, value);
    expect(first.iv).not.toBe(second.iv); expect(first.ciphertext).not.toContain(point.sourceKey);
    expect(await decryptProgress(key, id, first.iv, first.ciphertext)).toEqual(value);
    await expect(decryptProgress(token, id, first.iv, first.ciphertext)).rejects.toThrow();
    await expect(decryptProgress(key, crypto.randomUUID(), first.iv, first.ciphertext)).rejects.toThrow();
    await expect(decryptProgress(key, id, first.iv, `ff${first.ciphertext.slice(2)}`)).rejects.toThrow();
  });
  it('recognizes exact cross-account source tuples independently of local windows and isolates sharing keys', async () => {
    expect(await progressItemKey(key, point.sourceKey)).toBe(await progressItemKey(key, point.sourceKey));
    expect(await progressItemKey(token, point.sourceKey)).not.toBe(await progressItemKey(key, point.sourceKey));
    expect(await progressItemKey(key, 'different-occurrence')).not.toBe(await progressItemKey(key, point.sourceKey));
    expect(await progressVersion({ ...point.snapshot, validFrom: '2026-10-01 00:00:00' })).toBe(await progressVersion(point.snapshot));
    expect(await progressVersion({ ...point.snapshot, instructions: 'Synthetic changed work' })).not.toBe(await progressVersion(point.snapshot));
  });
  it('atomically queues edits and keeps edits made while an upload is in flight', async () => {
    const first = await history.record(check());
    await sync.connect(first.scopeId, code, false);
    const id = first.items[0]!.localId!;
    await history.setTaskStatus(first.scopeId, id, 'done', audit());
    const uploaded = (await sync.read())!;
    await history.setTaskStatus(first.scopeId, id, 'in-progress', audit());
    await sync.commit(uploaded, uploaded.outbox.map((op) => op.id), 1, {});
    expect((await sync.read())!.outbox).toHaveLength(1);
    expect((await sync.read())!.outbox[0]!.status).toBe('in-progress');
    await expect(history.setTaskStatus(first.scopeId, id, 'open', { ...audit(), correlationId: 'invalid' })).rejects.toThrow();
    expect((await sync.read())!.outbox).toHaveLength(1);
    expect((await history.read(first.scopeId)).scope!.items[0]!.taskStatus).toBe('in-progress');
  });
  it('applies remote progress only to the paired profile and matching content, without observation events', async () => {
    const first = await history.record(check());
    const other = await history.record(check({ scopeId: 'synthetic-other-pupil' }));
    await sync.connect(first.scopeId, code, false);
    const state = (await sync.read())!; const version = await progressVersion(point.snapshot);
    const item = await progressItemKey(key, point.sourceKey);
    await sync.commit(state, [], 1, { [`${item}.${version}`]: { version, status: 'done', revision: 1, kind: 'manual' } });
    expect(await sync.apply(other.scopeId)).toBe(false);
    expect(await sync.apply(first.scopeId)).toBe(true);
    const done = (await history.read(first.scopeId)).scope!;
    expect(done.items[0]!.taskStatus).toBe('done'); expect(done.events).toEqual(first.events);
    const changed = await history.record(check({ checkId: 'synthetic-changed', observedAt: '2026-10-03T08:01:00Z',
      points: [{ ...point, snapshot: { ...point.snapshot, instructions: 'Synthetic changed work' } }] }));
    expect(changed.items[0]!.taskStatus).toBe('in-progress');
    expect((await sync.read())!.outbox[0]!.kind).toBe('reopen');
    expect(await sync.apply(first.scopeId)).toBe(false);
  });
  it('preserves explicit completion of new content when another device later reports automatic reopening', async () => {
    const first = await history.record(check()); await sync.connect(first.scopeId, code, false);
    const state = (await sync.read())!; const version = await progressVersion(point.snapshot);
    const item = await progressItemKey(key, point.sourceKey); const remoteKey = `${item}.${version}`;
    await sync.commit(state, [], 1, { [remoteKey]: { version, status: 'done', revision: 1, kind: 'manual' } });
    await sync.commit(state, [], 2, { [remoteKey]: { version, status: 'in-progress', revision: 2, kind: 'reopen' } });
    await sync.apply(first.scopeId);
    expect((await history.read(first.scopeId)).scope!.items[0]!.taskStatus).toBe('done');
    await sync.commit(state, [], 3, { [remoteKey]: { version, status: 'open', revision: 3, kind: 'manual' } });
    await sync.apply(first.scopeId);
    expect((await history.read(first.scopeId)).scope!.items[0]!.taskStatus).toBe('open');
  });
  it('disconnects on local profile deletion and never restores credentials from a stale network reply', async () => {
    const first = await history.record(check()); await sync.connect(first.scopeId, code, false);
    const state = (await sync.read())!;
    await history.clearScope(first.scopeId);
    await sync.commit(state, [], 1, {});
    expect(await sync.read()).toBeUndefined();
    const db = await openHistoryDatabase(name);
    expect(await db.get('sync', SYNC_STATE_KEY)).toBeUndefined(); db.close();
  });
  it('does not apply old progress while still paging toward a newer server revision', async () => {
    const first = await history.record(check()); await sync.connect(first.scopeId, code, false);
    const state = (await sync.read())!; const version = await progressVersion(point.snapshot);
    const item = await progressItemKey(key, point.sourceKey); const remoteKey = `${item}.${version}`;
    await sync.commit(state, [], 1, { [remoteKey]: { version, status: 'done', revision: 1, kind: 'manual' } }, 2);
    expect(await sync.apply(first.scopeId)).toBe(false);
    await sync.commit(state, [], 2, { [remoteKey]: { version, status: 'in-progress', revision: 2, kind: 'manual' } }, 2);
    expect(await sync.apply(first.scopeId)).toBe(true);
    expect((await history.read(first.scopeId)).scope!.items[0]!.taskStatus).toBe('in-progress');
  });
  it('does not acknowledge a stale reply after reconnecting with the same pairing code', async () => {
    const first = await history.record(check()); await sync.connect(first.scopeId, code, false);
    const state = (await sync.read())!;
    await sync.disconnect(); await sync.connect(first.scopeId, code, false);
    await sync.commit(state, [], 10, {});
    expect((await sync.read())!.cursor).toBe(0);
  });
});
