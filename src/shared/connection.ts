import type { FetchStatus } from '../schoolware/agenda-client';
import { validateAgendaRequest } from '../schoolware/agenda-request';
import type { AgendaTypeCounts } from '../schoolware/agenda-types';

export type CheckStatus = FetchStatus | 'permission-required' | 'busy' | 'storage-error';
export interface CheckSummary { status: CheckStatus; checkedAt: string; count: number | null; typeCounts?: AgendaTypeCounts }
export interface ConnectionState { requestUrl: string | null; lastCheck: CheckSummary | null }
export const EMPTY_CONNECTION: ConnectionState = { requestUrl: null, lastCheck: null };
export const CONNECTION_KEY = 'schoolwareConnection';

const statuses: CheckStatus[] = ['success', 'session-required', 'redirected', 'api-failure',
  'invalid-response', 'network-error', 'timeout', 'http-error', 'rate-limited',
  'invalid-request', 'permission-required', 'busy', 'storage-error'];

export type ConnectionMessage =
  | { type: 'connection.read' }
  | { type: 'connection.clear' }
  | { type: 'agenda.check'; requestUrl: string };

export function validateConnectionMessage(value: unknown): ConnectionMessage | null {
  if (!value || typeof value !== 'object') return null;
  const message = value as Record<string, unknown>;
  if ((message.type === 'connection.read' || message.type === 'connection.clear') && Object.keys(message).length === 1) {
    return { type: message.type };
  }
  if (message.type === 'agenda.check' && Object.keys(message).length === 2) {
    const requestUrl = validateAgendaRequest(message.requestUrl);
    if (requestUrl) return { type: 'agenda.check', requestUrl };
  }
  return null;
}

export function validateConnectionState(value: unknown): ConnectionState | null {
  if (!value || typeof value !== 'object') return null;
  const state = value as Record<string, unknown>;
  const requestUrl = state.requestUrl === null ? null : validateAgendaRequest(state.requestUrl);
  if (state.requestUrl !== null && !requestUrl) return null;
  if (state.lastCheck === null) return { requestUrl, lastCheck: null };
  if (!state.lastCheck || typeof state.lastCheck !== 'object') return null;
  const check = state.lastCheck as Record<string, unknown>;
  if (!statuses.includes(check.status as CheckStatus) || typeof check.checkedAt !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T/.test(check.checkedAt) || !Number.isFinite(Date.parse(check.checkedAt))) return null;
  if (check.status === 'success' ?
    typeof check.count !== 'number' || !Number.isSafeInteger(check.count) || check.count < 0 : check.count !== null) return null;
  const lastCheck: CheckSummary = { status: check.status as CheckStatus,
    checkedAt: check.checkedAt, count: check.count as number | null };
  // Older summaries contain only a total. Preserve them without inventing categories.
  if (Object.hasOwn(check, 'typeCounts')) {
    if (check.status !== 'success' || !check.typeCounts || typeof check.typeCounts !== 'object' || Array.isArray(check.typeCounts)) return null;
    const source = check.typeCounts as Record<string, unknown>;
    const typeCounts: AgendaTypeCounts = { tests: 0, assignments: 0, review: 0, other: 0 };
    for (const key of ['tests', 'assignments', 'review', 'other'] as const) {
      const count = source[key];
      if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0) return null;
      typeCounts[key] = count;
    }
    if (Object.values(typeCounts).reduce((sum, count) => sum + count, 0) !== check.count) return null;
    lastCheck.typeCounts = typeCounts;
  }
  return { requestUrl, lastCheck };
}

export function isExtensionPage(sender: { id?: string; url?: string }, extensionId: string): boolean {
  return sender.id === extensionId && ['popup.html', 'dashboard.html', 'options.html']
    .some((page) => sender.url === `chrome-extension://${extensionId}/${page}`);
}
