import { isTaskStatus, type TaskStatus } from '../domain/tasks';
import { isAlertId } from './browser-alerts';

export const SYNC_ORIGIN = 'https://schoolware.bumper.be';
export const SYNC_PERMISSION = `${SYNC_ORIGIN}/*`;
export const SYNC_URL = `${SYNC_ORIGIN}/sync.php`;
export const SYNC_STATE_KEY = 'progressSync';
export interface ProgressOperation {
  id: string; sourceKey: string; version: string; status: TaskStatus; kind: 'manual' | 'reopen';
}
export interface SyncMember { id: string; label: string; lastSeenAt: string }
export function normalizeSyncLabel(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const value = raw.trim().normalize('NFC');
  return value.length > 0 && value.length <= 48 && !/[\p{Cc}\p{Cf}]/u.test(value) ? value : null;
}
export function isSyncMember(raw: unknown): raw is SyncMember {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
  const value = raw as Record<string, unknown>;
  return Object.keys(value).length === 3 && isAlertId(value.id) && typeof value.label === 'string' && normalizeSyncLabel(value.label) === value.label &&
    typeof value.lastSeenAt === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.000Z$/.test(value.lastSeenAt) &&
    Number.isFinite(Date.parse(value.lastSeenAt));
}
export interface SyncState {
  connectionId: string; scopeId: string; token: string; key: string; cursor: number; head: number;
  outbox: ProgressOperation[]; remote: Record<string, { version: string; status: TaskStatus; revision: number; kind: 'manual' | 'reopen' }>;
  lastSuccessAt: string | null; error: boolean;
  registrationPending?: boolean;
  displayName?: string; members?: SyncMember[]; membersError?: boolean;
}
export interface SyncView { ok: boolean; enabled: boolean; pending: number; lastSuccessAt: string | null; error: boolean; pairingCode?: string; registrationPending?: boolean;
  displayName?: string; members?: (SyncMember & { self: boolean })[]; membersError?: boolean }
type SimpleSyncType = 'sync.read' | 'sync.run' | 'sync.disconnect' | 'sync.delete' | 'sync.pairing';
export type SyncMessage = { [T in SimpleSyncType]: { type: T } }[SimpleSyncType] |
  { type: 'sync.create'; code: string; label?: string } |
  { type: 'sync.connect'; code: string; seed: boolean; label?: string } |
  { type: 'sync.name'; label: string };
export const isSecret = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
export function parsePairingCode(code: unknown): { token: string; key: string } | null {
  if (typeof code !== 'string') return null;
  const parts = code.split('.');
  return parts.length === 3 && parts[0] === 'sw1' && isSecret(parts[1]) && isSecret(parts[2]) ? { token: parts[1], key: parts[2] } : null;
}
export function validateSyncMessage(raw: unknown): SyncMessage | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  if (Object.keys(value).length === 1 && ['sync.read', 'sync.run', 'sync.disconnect', 'sync.delete', 'sync.pairing'].includes(value.type as string)) {
    return { type: value.type } as SyncMessage;
  }
  const label = value.label === undefined ? undefined : normalizeSyncLabel(value.label);
  if (value.label !== undefined && !label) return null;
  if (value.type === 'sync.name' && Object.keys(value).length === 2 && label) return { type: 'sync.name', label };
  if (value.type === 'sync.create' && Object.keys(value).length === (label ? 3 : 2) && parsePairingCode(value.code)) {
    return { type: 'sync.create', code: value.code as string, ...(label ? { label } : {}) };
  }
  return value.type === 'sync.connect' && Object.keys(value).length === (label ? 4 : 3) && typeof value.seed === 'boolean' && parsePairingCode(value.code) ?
    { type: 'sync.connect', code: value.code as string, seed: value.seed, ...(label ? { label } : {}) } : null;
}
export function validateSyncView(raw: unknown): SyncView | null {
  if (!raw || typeof raw !== 'object') return null;
  const v = raw as Record<string, unknown>;
  if (typeof v.ok !== 'boolean' || typeof v.enabled !== 'boolean' || typeof v.error !== 'boolean' ||
      typeof v.pending !== 'number' || !Number.isSafeInteger(v.pending) || v.pending < 0 ||
      !(v.lastSuccessAt === null || (typeof v.lastSuccessAt === 'string' && Number.isFinite(Date.parse(v.lastSuccessAt)))) ||
      (v.pairingCode !== undefined && !parsePairingCode(v.pairingCode)) ||
      (v.registrationPending !== undefined && typeof v.registrationPending !== 'boolean') ||
      (v.displayName !== undefined && (typeof v.displayName !== 'string' || normalizeSyncLabel(v.displayName) !== v.displayName)) ||
      (v.membersError !== undefined && typeof v.membersError !== 'boolean') ||
      (v.members !== undefined && (!Array.isArray(v.members) || v.members.length > 50 ||
        !v.members.every((member: unknown) => {
          if (!member || typeof member !== 'object') return false;
          const { self, ...entry } = member as Record<string, unknown>;
          return typeof self === 'boolean' && isSyncMember(entry);
        })))) return null;
  return v as unknown as SyncView;
}
export const isRemoteProgress = (raw: unknown): raw is { item: string; version: string; status: TaskStatus; kind: 'manual' | 'reopen' } => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
  const v = raw as Record<string, unknown>;
  return Object.keys(v).length === 4 && ['manual', 'reopen'].includes(v.kind as string) && isSecret(v.item) && isSecret(v.version) && isTaskStatus(v.status);
};
