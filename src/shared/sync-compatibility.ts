import manifest from '../../manifest.json';

export const APP_VERSION = manifest.version;
export const SYNC_PROTOCOL = 2;
export interface SyncPolicy { minimumProtocol: number; maximumProtocol: number; minimumVersion: string; latestVersion: string | null }
export type CompatibilityIssue = 'update-required' | 'server-update-required' | 'check-unavailable';
export type UpdateStatus = 'update_available' | 'no_update' | 'throttled' | 'unavailable';
export interface SyncCompatibility { checkedAt: string; policy: SyncPolicy | null; issue: CompatibilityIssue | null }
export interface StoreUpdate { checkedAt: string; status: UpdateStatus; version?: string }
export function isAppVersion(value: unknown): value is string {
  return typeof value === 'string' && /^(?:0|[1-9]\d{0,4})(?:\.(?:0|[1-9]\d{0,4})){1,3}$/.test(value) && value.split('.').every((part) => Number(part) <= 65535);
}
export function compareAppVersions(left: string, right: string): number {
  const a = left.split('.').map(Number); const b = right.split('.').map(Number);
  for (let i = 0; i < 4; i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) < (b[i] ?? 0) ? -1 : 1;
  return 0;
}
export function validateSyncPolicy(raw: unknown): SyncPolicy | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const v = raw as Record<string, unknown>;
  return Object.keys(v).length === 4 && Number.isSafeInteger(v.minimumProtocol) && Number.isSafeInteger(v.maximumProtocol) &&
    (v.minimumProtocol as number) > 0 && (v.maximumProtocol as number) >= (v.minimumProtocol as number) && (v.maximumProtocol as number) <= 1000 &&
    isAppVersion(v.minimumVersion) && (v.latestVersion === null || (isAppVersion(v.latestVersion) && compareAppVersions(v.latestVersion, v.minimumVersion) >= 0)) ?
    v as unknown as SyncPolicy : null;
}
export function compatibilityIssue(policy: SyncPolicy, version = APP_VERSION, protocol = SYNC_PROTOCOL): CompatibilityIssue | null {
  if (protocol > policy.maximumProtocol) return 'server-update-required';
  return protocol < policy.minimumProtocol || compareAppVersions(version, policy.minimumVersion) < 0 ? 'update-required' : null;
}
const timestamp = (v: unknown): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v));
export function validateSyncCompatibility(raw: unknown): SyncCompatibility | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const v = raw as Record<string, unknown>;
  return Object.keys(v).length === 3 && timestamp(v.checkedAt) && (v.policy === null || validateSyncPolicy(v.policy)) &&
    (v.issue === null || ['update-required', 'server-update-required', 'check-unavailable'].includes(v.issue as string)) ? v as unknown as SyncCompatibility : null;
}
export function validateStoreUpdate(raw: unknown): StoreUpdate | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const v = raw as Record<string, unknown>;
  return Object.keys(v).length === (v.version === undefined ? 2 : 3) && timestamp(v.checkedAt) &&
    ['update_available', 'no_update', 'throttled', 'unavailable'].includes(v.status as string) &&
    (v.status === 'update_available' ? isAppVersion(v.version) : v.version === undefined) ? v as unknown as StoreUpdate : null;
}
