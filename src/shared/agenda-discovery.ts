import { SCHOOLWARE_PERMISSION } from '../schoolware/agenda-request';
import { isAlertId } from './browser-alerts';

export const DISCOVERY_PERMISSIONS: chrome.permissions.Permissions = { permissions: ['webRequest'], origins: [SCHOOLWARE_PERMISSION] };
export const DISCOVERY_STATUSES = ['idle', 'waiting', 'found', 'expired', 'permission-required', 'error'] as const;
export interface DiscoveryView { status: typeof DISCOVERY_STATUSES[number]; id: string | null }
type SimpleDiscoveryType = 'connection.discovery.start' | 'connection.discovery.read' | 'connection.discovery.cancel';
export type DiscoveryMessage = { [T in SimpleDiscoveryType]: { type: T } }[SimpleDiscoveryType] |
  { type: 'connection.discovery.confirm'; id: string };
export function validateDiscoveryMessage(raw: unknown): DiscoveryMessage | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  if (Object.keys(value).length === 1 && ['connection.discovery.start', 'connection.discovery.read', 'connection.discovery.cancel'].includes(value.type as string)) {
    return { type: value.type } as DiscoveryMessage;
  }
  return value.type === 'connection.discovery.confirm' && Object.keys(value).length === 2 && isAlertId(value.id) ?
    { type: value.type, id: value.id } : null;
}
export function validateDiscoveryView(raw: unknown): DiscoveryView | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  if (Object.keys(value).length !== 2 || !DISCOVERY_STATUSES.includes(value.status as DiscoveryView['status']) ||
      !(value.id === null || isAlertId(value.id))) return null;
  if (['waiting', 'found'].includes(value.status as string) !== (value.id !== null)) return null;
  return value as unknown as DiscoveryView;
}
