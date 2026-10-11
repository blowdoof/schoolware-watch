import { ProgressSyncRepository } from '../storage/progress-sync';
import { decryptProgress, encryptProgress, progressItemKey } from '../domain/progress-sync';
import { SYNC_URL, SYNC_PERMISSION, isRemoteProgress, isSyncMember, type SyncState, type SyncMember } from '../shared/progress-sync';
import { isAlertId } from '../shared/browser-alerts';
import type { ActivityAction, ActivityData, ActivityReason, ActivityReporter } from '../shared/activity';
import type { AuditContext } from '../storage/activity';
import { notifyProgressChange, notifyHelpRequests } from './progress-notifications';
import { isPlanningFragment, type PlanningFragment } from '../shared/planning-sync';
import { APP_VERSION, SYNC_PROTOCOL, validateSyncPolicy, compatibilityIssue, isAppVersion, type StoreUpdate, type SyncPolicy } from '../shared/sync-compatibility';

export const PROGRESS_SYNC_ALARM = 'schoolware-progress-sync';
export const progressSync = new ProgressSyncRepository();

class SyncFailure extends Error {
  constructor(readonly reason: ActivityReason, readonly httpStatus?: number) { super('Progress operation failed'); }
}
const failureData = (error: unknown, fallback: ActivityReason): ActivityData => error instanceof SyncFailure ?
  { reason: error.reason, ...(error.httpStatus ? { httpStatus: error.httpStatus } : {}) } : { reason: fallback };

function safeReporter(reporter: ActivityReporter = async () => {}): ActivityReporter {
  return async (action, phase, data) => {
    try { await reporter(action, phase, data); }
    catch { /* The worker maintains log health; logging must not change transport behavior. */ }
  };
}
async function audited<T>(record: ActivityReporter, action: ActivityAction, operation: () => Promise<T>,
  result: (value: T) => ActivityData = () => ({ reason: 'success' })): Promise<T> {
  const started = Date.now();
  await record(action, 'started');
  try {
    const value = await operation();
    await record(action, 'succeeded', { ...result(value), durationMs: Math.max(0, Date.now() - started) });
    return value;
  } catch (error) {
    await record(action, 'failed', { ...failureData(error, 'storage-error'), durationMs: Math.max(0, Date.now() - started) });
    throw error;
  }
}
async function encrypt(key: string, id: string, value: unknown) {
  try { return await encryptProgress(key, id, value); } catch { throw new SyncFailure('crypto-error'); }
}
async function decrypt(key: string, id: string, iv: string, ciphertext: string): Promise<unknown> {
  try { return await decryptProgress(key, id, iv, ciphertext); } catch { throw new SyncFailure('decryption-failed'); }
}

async function request(token: string, body: unknown): Promise<Record<string, unknown>> {
  if (!await chrome.permissions.contains({ origins: [SYNC_PERMISSION] })) throw new SyncFailure('permission-required');
  let response: Response;
  try {
    response = await fetch(SYNC_URL, { method: 'POST', credentials: 'omit', redirect: 'error', cache: 'no-store',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'X-Schoolware-Version': APP_VERSION, 'X-Schoolware-Protocol': String(SYNC_PROTOCOL) }, body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000) });
  } catch (error) {
    throw new SyncFailure(error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name) ? 'timeout' : 'network-error');
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    throw new SyncFailure(response.status === 426 ? 'update-required' : response.status === 429 ? 'rate-limited' :
      response.status === 401 || response.status === 403 ? 'authentication-failed' : 'http-error', response.status);
  }
  if (Number(response.headers.get('Content-Length') ?? 0) > 1_000_000) {
    await response.body?.cancel().catch(() => {}); throw new SyncFailure('invalid-response');
  }
  const reader = response.body?.getReader();
  if (!reader) throw new SyncFailure('invalid-response');
  const decoder = new TextDecoder(); let text = ''; let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 1_000_000) { await reader.cancel(); throw new SyncFailure('invalid-response'); }
      text += decoder.decode(chunk.value, { stream: true });
    }
  } catch (error) {
    if (error instanceof SyncFailure) throw error;
    throw new SyncFailure(error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name) ? 'timeout' : 'network-error');
  } finally { reader.releaseLock(); }
  text += decoder.decode();
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new SyncFailure('invalid-response'); }
  if (!value || typeof value !== 'object' || Array.isArray(value) || (value as Record<string, unknown>).ok !== true) throw new SyncFailure('invalid-response');
  return value as Record<string, unknown>;
}

async function checkCompatibility(state: SyncState, record: ActivityReporter): Promise<void> {
  const checkedAt = new Date().toISOString();
  let policy: SyncPolicy | null = null;
  try {
    const response = await audited(record, 'progress.compatibility', () => request(state.token, { action: 'compatibility' }));
    policy = validateSyncPolicy(response.policy);
    if (Object.keys(response).length !== 2 || !policy) throw new SyncFailure('server-update-required');
    const issue = compatibilityIssue(policy);
    if (!await progressSync.setCompatibility(state, { checkedAt, policy, issue })) throw new SyncFailure('cancelled');
    if (issue) throw new SyncFailure(issue);
  } catch (error) {
    if (error instanceof SyncFailure && error.reason === 'cancelled') throw error;
    const issue = error instanceof SyncFailure && error.reason === 'update-required' ? 'update-required' :
      error instanceof SyncFailure && (error.reason === 'server-update-required' || error.httpStatus === 400) ? 'server-update-required' : 'check-unavailable';
    await progressSync.setCompatibility(state, { checkedAt, policy, issue });
    if (issue === 'server-update-required') throw new SyncFailure(issue);
    throw error;
  }
}

export async function checkStoreUpdate(): Promise<void> {
  const state = await progressSync.read();
  if (!state) return;
  // Chrome also throttles this API. Preserve a recent result instead of polling.
  if (state.storeUpdate && Date.now() - Date.parse(state.storeUpdate.checkedAt) < 60000) return;
  let update: StoreUpdate = { checkedAt: new Date().toISOString(), status: 'unavailable' };
  try {
    const result = await chrome.runtime.requestUpdateCheck();
    if (['update_available', 'no_update', 'throttled'].includes(result.status) &&
        (result.status !== 'update_available' || isAppVersion(result.version)))
      update = { checkedAt: update.checkedAt, status: result.status, ...(result.status === 'update_available' ? { version: result.version! } : {}) };
  } catch { /* Unpacked builds or unavailable Chrome APIs do not imply latest. */ }
  await progressSync.setStoreUpdate(state, update);
}

export async function configureProgressSyncAlarm(reporter?: ActivityReporter): Promise<void> {
  const record = safeReporter(reporter);
  try {
    const state = await progressSync.read();
    if (!state || state.blocked) {
      await chrome.alarms.clear(PROGRESS_SYNC_ALARM);
      await record('alarm.configured', 'succeeded', { alarm: 'progress-sync', reason: 'disabled', registered: false }); return;
    }
    const previous = await chrome.alarms.get(PROGRESS_SYNC_ALARM);
    if (!previous) await chrome.alarms.create(PROGRESS_SYNC_ALARM, { delayInMinutes: 1, periodInMinutes: 1 });
    await record('alarm.configured', 'succeeded', { alarm: 'progress-sync', reason: previous ? 'unchanged' : 'success',
      registered: true, intervalMinutes: 1, ...(previous ? { scheduledAt: new Date(previous.scheduledTime).toISOString() } : {}) });
  } catch (error) { await record('alarm.configured', 'failed', { alarm: 'progress-sync', reason: 'unavailable' }); throw error; }
}

export async function deleteRemoteProgress(reporter?: ActivityReporter): Promise<void> {
  const record = safeReporter(reporter);
  await record('progress.delete', 'started');
  try {
    const state = await progressSync.read();
    if (!state) { await record('progress.delete', 'skipped', { reason: 'disabled' }); return; }
    await request(state.token, { action: 'delete' });
    await progressSync.disconnect(); await configureProgressSyncAlarm(record);
    await record('progress.delete', 'succeeded', { reason: 'success' });
  } catch (error) { await record('progress.delete', 'failed', failureData(error, 'storage-error')); throw error; }
}

export async function synchronizeMembers(state: SyncState, reporter?: ActivityReporter): Promise<boolean> {
  const record = safeReporter(reporter);
  if (!state.displayName || state.registrationPending) {
    await record('progress.members', 'skipped', { reason: state.registrationPending ? 'registration-pending' : 'missing' }); return false;
  }
  try {
    return await audited(record, 'progress.members', async () => {
      const encrypted = await encrypt(state.key, `member:${state.connectionId}`, { label: state.displayName });
      const response = await request(state.token, { action: 'members', device: { id: state.connectionId, ...encrypted } });
      if (Object.keys(response).length !== 2 || !Array.isArray(response.members) || response.members.length > 50) throw new SyncFailure('invalid-response');
      const members: SyncMember[] = []; const ids = new Set<string>();
      for (const raw of response.members) {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new SyncFailure('invalid-response');
        const entry = raw as Record<string, unknown>;
        if (Object.keys(entry).length !== 4 || !isAlertId(entry.id) || ids.has(entry.id) || typeof entry.iv !== 'string' ||
            !/^[a-f0-9]{24}$/.test(entry.iv) || typeof entry.ciphertext !== 'string' || !/^(?:[a-f0-9]{2}){16,1024}$/.test(entry.ciphertext)) throw new SyncFailure('invalid-response');
        const value = await decrypt(state.key, `member:${entry.id}`, entry.iv, entry.ciphertext);
        if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 1) throw new SyncFailure('invalid-response');
        const member = { id: entry.id, label: (value as Record<string, unknown>).label, lastSeenAt: entry.lastSeenAt };
        if (!isSyncMember(member)) throw new SyncFailure('invalid-response');
        members.push(member); ids.add(member.id);
      }
      if (!ids.has(state.connectionId)) throw new SyncFailure('invalid-response');
      const changed = await progressSync.commitMembers(state, members);
      return { count: members.length, membersUpdated: changed };
    }, (value) => ({ reason: 'success', ...value })).then((value) => value.membersUpdated);
  } catch { return await progressSync.commitMembers(state, null); }
}

export async function leaveSyncMembers(reporter?: ActivityReporter): Promise<void> {
  const record = safeReporter(reporter);
  await record('progress.leave', 'started');
  try {
    const state = await progressSync.read();
    if (!state?.displayName) { await record('progress.leave', 'skipped', { reason: 'missing' }); return; }
    await request(state.token, { action: 'member.leave', id: state.connectionId });
    await record('progress.leave', 'succeeded', { reason: 'success' });
  } catch (error) {
    await record('progress.leave', 'failed', failureData(error, 'storage-error'));
    // Offline disconnection must still remove all local credentials.
  }
}

// Presentation only; durable progress and retry state remain in repositories.
const runningScopes = new Map<string, number>();
export function isProgressSyncRunning(scopeId: string | null): boolean { return Boolean(scopeId && runningScopes.has(scopeId)); }
export async function synchronizeProgress(scopeId: string | null, reporter?: ActivityReporter, audit?: AuditContext): Promise<boolean> {
  const record = safeReporter(reporter);
  const started = Date.now();
  await record('progress.sync', 'started');
  let state: SyncState | undefined;
  if (scopeId) runningScopes.set(scopeId, (runningScopes.get(scopeId) ?? 0) + 1);
  try {
    state = await progressSync.read();
    if (!state || state.scopeId !== scopeId) {
      await record('progress.sync', 'skipped', { reason: !state ? 'disabled' : 'profile-mismatch' }); return false;
    }
    if (state.blocked) { await record('progress.sync', 'skipped', { reason: 'blocked' }); return false; }
    await checkCompatibility(state, record);
    await progressSync.announceVersion(state);
    await progressSync.preparePlanning(state.scopeId);
    const current = await progressSync.read();
    if (!current || current.connectionId !== state.connectionId) throw new SyncFailure('cancelled');
    state = current;
    if (current.blocked) {
      await record('progress.sync', 'skipped', { reason: 'blocked' }); return false;
    }
    if (current.registrationPending) {
      await audited(record, 'progress.registration', async () => {
        const registered = await request(current.token, { action: 'register' });
        if (Object.keys(registered).length !== 1) throw new SyncFailure('invalid-response');
        if (!await progressSync.registered(current)) throw new SyncFailure('cancelled');
        delete current.registrationPending;
      });
    }
    await record('progress.exchange', 'info', { pendingCount: current.outbox.length + (current.planningOutbox?.length ?? 0) });
    const exchanged = await audited(record, 'progress.exchange', async () => {
      // IDs survive retries; a fresh nonce does not change operation identity.
      const pending = [...current.outbox.slice(0, 50), ...(current.planningOutbox ?? []).slice(0, Math.max(0, 50 - current.outbox.length))];
      const operations = await Promise.all(pending.map(async (operation) => {
        if ('fragment' in operation) return { id: operation.id, ...await encrypt(current.key, operation.id, operation.fragment) };
        const item = await progressItemKey(current.key, operation.sourceKey, new URL(current.scopeId).origin);
        return { id: operation.id, ...await encrypt(current.key, operation.id,
            { item, version: operation.version, status: operation.status, kind: operation.kind, ...(operation.actor ? { actor: operation.actor } : {}) }) };
      }));
      const response = await request(current.token, { action: 'exchange', cursor: current.cursor, operations });
      if (!Array.isArray(response.acknowledged) || response.acknowledged.length !== pending.length ||
          !pending.every((op) => (response.acknowledged as unknown[]).includes(op.id)) ||
          !Array.isArray(response.operations) || response.operations.length > 200 || typeof response.cursor !== 'number' ||
          !Number.isSafeInteger(response.cursor) || response.cursor < current.cursor ||
          typeof response.head !== 'number' || !Number.isSafeInteger(response.head) || response.head < response.cursor) throw new SyncFailure('invalid-response');
      const remote: typeof current.remote = {}; let lastRevision = current.cursor;
      const planning: { fragment: PlanningFragment; revision: number }[] = [];
      for (const raw of response.operations) {
        if (!raw || typeof raw !== 'object') throw new SyncFailure('invalid-response');
        const op = raw as Record<string, unknown>;
        if (!isAlertId(op.id) || typeof op.revision !== 'number' || !Number.isSafeInteger(op.revision) || op.revision <= lastRevision ||
            typeof op.iv !== 'string' || !/^[a-f0-9]{24}$/.test(op.iv) ||
            typeof op.ciphertext !== 'string' || !/^[a-f0-9]{32,2048}$/.test(op.ciphertext)) throw new SyncFailure('invalid-response');
        const value = await decrypt(current.key, op.id, op.iv, op.ciphertext);
        if (isPlanningFragment(value)) planning.push({ fragment: value, revision: op.revision });
        else if (isRemoteProgress(value)) {
          const remoteKey = `${value.item}.${value.version}`;
          const previous = remote[remoteKey];
          if (!previous || previous.kind !== 'manual' || value.kind === 'manual')
              remote[remoteKey] = { version: value.version, status: value.status, revision: op.revision, kind: value.kind, ...(value.actor ? { actor: value.actor } : {}) };
        } else throw new SyncFailure('invalid-response');
        lastRevision = op.revision;
      }
      if (response.operations.length ? response.cursor !== lastRevision : response.cursor !== response.head) throw new SyncFailure('invalid-response');
      if (!await progressSync.commit(current, pending.map((op) => op.id), response.cursor, remote, response.head, planning)) throw new SyncFailure('cancelled');
      return { reason: 'success' as const, uploadedCount: pending.length, downloadedCount: response.operations.length,
        pendingCount: (await progressSync.view()).pending, hasMore: response.cursor < response.head };
    }, (value) => value);
    let changed = false;
    if (exchanged.hasMore) {
      await record('progress.apply', 'skipped', { reason: 'pagination-pending', hasMore: true });
    } else {
      changed = await audited(record, 'progress.apply', () => progressSync.apply(current.scopeId, audit),
        (applied) => ({ reason: applied ? 'success' : 'unchanged', applied }));
      if (changed && (await progressSync.read())?.lastApplyOrdinaryChanged) await notifyProgressChange(audit?.correlationId ?? crypto.randomUUID(),
        !(current.hasAppliedRemote ?? (current.lastSuccessAt !== null && current.cursor === current.head)), record);
      await notifyHelpRequests(progressSync, current.scopeId, record);
    }
    const membersChanged = await synchronizeMembers(current, record);
    const after = await progressSync.read();
    if (!after || after.connectionId !== current.connectionId) throw new SyncFailure('cancelled');
    await record('progress.sync', 'succeeded', { reason: after.membersError || after.cursor < after.head ? 'partial-success' : 'success',
      applied: changed, membersUpdated: membersChanged, pendingCount: after.outbox.length + (after.planningOutbox?.length ?? 0),
      hasMore: after.cursor < after.head,
      durationMs: Math.max(0, Date.now() - started) });
    return changed || membersChanged;
  } catch (error) {
    await record('progress.sync', 'failed', { ...failureData(error, 'storage-error'), durationMs: Math.max(0, Date.now() - started) });
    if (state) await progressSync.failed(state, error instanceof SyncFailure ? error.httpStatus : undefined);
    return false;
  } finally {
    if (scopeId) {
      const remaining = (runningScopes.get(scopeId) ?? 1) - 1;
      if (remaining) runningScopes.set(scopeId, remaining); else runningScopes.delete(scopeId);
    }
  }
}
