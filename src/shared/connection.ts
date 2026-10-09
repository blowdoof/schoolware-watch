import { validateSyncMessage, type SyncMessage } from './progress-sync';
import { validateDiscoveryMessage, type DiscoveryMessage } from './agenda-discovery';
import type { FetchStatus } from '../schoolware/agenda-client';
import { validateAgendaRequest } from '../schoolware/agenda-request';
import type { AgendaTypeCounts } from '../schoolware/agenda-types';
import type { Category } from '../domain/observations';
import { validatePreferences, type Preferences } from './preferences';
import { isAlertId } from './browser-alerts';
import { isNotificationTarget, notificationTarget } from './notification-details';
import { MAX_ACTIVITY_ENTRIES } from './activity';
import { isTaskStatus, type TaskStatus } from '../domain/tasks';
import { MAX_TASK_UPDATES } from './tasks';
import { isHelpRecipients } from './task-help';
import { validateOpenPageMessage, type OpenPageMessage } from './navigation';
import { validateSpecialDaysMessage, type SpecialDaysMessage } from './special-days';

export type CheckStatus = FetchStatus | 'permission-required' | 'busy' | 'storage-error';
export interface CheckSummary { status: CheckStatus; checkedAt: string; count: number | null; typeCounts?: AgendaTypeCounts }
export interface ConnectionState { requestUrl: string | null; lastCheck: CheckSummary | null; lastSuccessAt?: string | null }
export const EMPTY_CONNECTION: ConnectionState = { requestUrl: null, lastCheck: null };
export const CONNECTION_KEY = 'schoolwareConnection';

const statuses: CheckStatus[] = ['success', 'session-required', 'redirected', 'api-failure',
  'invalid-response', 'network-error', 'timeout', 'http-error', 'rate-limited',
  'invalid-request', 'permission-required', 'busy', 'storage-error'];

export type ConnectionMessage = SyncMessage | DiscoveryMessage | OpenPageMessage | SpecialDaysMessage
  | { type: 'setup.complete' }
  | { type: 'connection.read' }
  | { type: 'connection.clear' }
  | { type: 'history.read'; category?: Category | 'all' }
  | { type: 'history.clear' }
  | { type: 'history.retention'; days: number }
  | { type: 'preferences.read' }
  | { type: 'preferences.save'; preferences: Preferences }
  | { type: 'notifications.test' }
  | { type: 'browser.alerts.read' }
  | { type: 'browser.alerts.dismiss' }
  | { type: 'browser.alerts.test' }
  | { type: 'browser.alerts.open'; alertId?: string }
  | { type: 'notifications.details'; target: string }
  | { type: 'tasks.read' }
  | { type: 'schoolbag.read' }
  | { type: 'schoolbag.update'; choiceId: string; state: 'packed' | 'hidden' | 'open' }
  | { type: 'tasks.update'; itemId: string; status: TaskStatus }
  | { type: 'tasks.help'; itemId: string; needed: boolean; recipients: string[] }
  | { type: 'tasks.updateMany'; itemIds: string[]; status: TaskStatus }
  | { type: 'activity.read'; limit?: number; correlationId?: string; itemId?: string }
  | { type: 'activity.clear' }
  | { type: 'activity.exported'; count: number }
  | { type: 'browser.alerts.rendered'; alertIds: string[] }
  | { type: 'permission.result'; permission: 'notifications' | 'browser' | 'schoolware'; granted: boolean }
  | { type: 'agenda.check'; requestUrl: string };

export function validateConnectionMessage(value: unknown): ConnectionMessage | null {
  const special = validateSpecialDaysMessage(value);
  if (special) return special;
  const navigation = validateOpenPageMessage(value);
  if (navigation) return navigation;
  const sync = validateSyncMessage(value);
  if (sync) return sync;
  const discovery = validateDiscoveryMessage(value);
  if (discovery) return discovery;
  if (!value || typeof value !== 'object') return null;
  const message = value as Record<string, unknown>;
  if (message.type === 'schoolbag.update' && Object.keys(message).length === 3 &&
      typeof message.choiceId === 'string' && /^[a-f0-9]{64}$/.test(message.choiceId) &&
      ['packed', 'hidden', 'open'].includes(message.state as string)) {
    return { type: 'schoolbag.update', choiceId: message.choiceId, state: message.state as 'packed' | 'hidden' | 'open' };
  }
  if (message.type === 'permission.result' && Object.keys(message).length === 3 &&
      ['notifications', 'browser', 'schoolware'].includes(message.permission as string) && typeof message.granted === 'boolean') {
    return { type: 'permission.result', permission: message.permission as 'notifications' | 'browser' | 'schoolware', granted: message.granted };
  }
  if (message.type === 'tasks.help' && Object.keys(message).length === 4 && isAlertId(message.itemId) &&
      typeof message.needed === 'boolean' && isHelpRecipients(message.recipients) && (message.needed || !message.recipients.length)) {
    return { type: 'tasks.help', itemId: message.itemId, needed: message.needed, recipients: [...message.recipients] };
  }
  if (message.type === 'tasks.update' && Object.keys(message).length === 3 && isAlertId(message.itemId) && isTaskStatus(message.status)) {
    return { type: 'tasks.update', itemId: message.itemId, status: message.status };
  }
  if (message.type === 'tasks.updateMany' && Object.keys(message).length === 3 && Array.isArray(message.itemIds) &&
      message.itemIds.length > 0 && message.itemIds.length <= MAX_TASK_UPDATES && message.itemIds.every(isAlertId) &&
      new Set(message.itemIds).size === message.itemIds.length && isTaskStatus(message.status)) {
    return { type: 'tasks.updateMany', itemIds: [...message.itemIds], status: message.status };
  }
  if (message.type === 'activity.read' && Object.keys(message).every((key) => ['type', 'limit', 'correlationId', 'itemId'].includes(key)) &&
      (!Object.hasOwn(message, 'limit') || (typeof message.limit === 'number' && Number.isSafeInteger(message.limit) && message.limit >= 1 && message.limit <= MAX_ACTIVITY_ENTRIES)) &&
      (!Object.hasOwn(message, 'correlationId') || isAlertId(message.correlationId)) &&
      (!Object.hasOwn(message, 'itemId') || isAlertId(message.itemId))) {
    return { type: 'activity.read', ...(message.limit ? { limit: message.limit as number } : {}),
      ...(message.correlationId ? { correlationId: message.correlationId as string } : {}), ...(message.itemId ? { itemId: message.itemId as string } : {}) };
  }
  if (message.type === 'activity.exported' && Object.keys(message).length === 2 &&
      typeof message.count === 'number' && Number.isSafeInteger(message.count) && message.count >= 0 && message.count <= MAX_ACTIVITY_ENTRIES) {
    return { type: 'activity.exported', count: message.count };
  }
  if (message.type === 'browser.alerts.rendered' && Object.keys(message).length === 2 && Array.isArray(message.alertIds) &&
      message.alertIds.length > 0 && message.alertIds.length <= 20 && message.alertIds.every(isAlertId) && new Set(message.alertIds).size === message.alertIds.length) {
    return { type: 'browser.alerts.rendered', alertIds: message.alertIds as string[] };
  }
  if (message.type === 'browser.alerts.open' && Object.keys(message).length === 2 && isAlertId(message.alertId)) {
    return { type: 'browser.alerts.open', alertId: message.alertId };
  }
  if (message.type === 'notifications.details' && Object.keys(message).length === 2 && isNotificationTarget(message.target)) {
    return { type: 'notifications.details', target: message.target };
  }
  if (['setup.complete', 'connection.read', 'connection.clear', 'history.clear', 'preferences.read', 'notifications.test',
    'browser.alerts.read', 'browser.alerts.dismiss', 'browser.alerts.test', 'browser.alerts.open', 'tasks.read', 'schoolbag.read', 'activity.clear'].includes(message.type as string) && Object.keys(message).length === 1) {
    return { type: message.type } as ConnectionMessage;
  }
  if (message.type === 'preferences.save' && Object.keys(message).length === 2) {
    const preferences = validatePreferences(message.preferences);
    if (preferences) return { type: 'preferences.save', preferences };
  }
  if (message.type === 'history.read') {
    if (Object.keys(message).length === 1) return { type: 'history.read' };
    if (Object.keys(message).length === 2 && ['all', 'tests', 'assignments', 'review', 'other'].includes(message.category as string)) {
      return { type: 'history.read', category: message.category as Category | 'all' };
    }
  }
  if (message.type === 'history.retention' && Object.keys(message).length === 2 &&
      typeof message.days === 'number' && [30, 90, 180, 365].includes(message.days)) return { type: message.type, days: message.days };
  if (message.type === 'agenda.check' && Object.keys(message).length === 2) {
    const requestUrl = validateAgendaRequest(message.requestUrl);
    if (requestUrl) return { type: 'agenda.check', requestUrl };
  }
  return null;
}

export function validateConnectionState(value: unknown): ConnectionState | null {
  if (!value || typeof value !== 'object') return null;
  const state = value as Record<string, unknown>;
  if (Object.hasOwn(state, 'lastSuccessAt') && state.lastSuccessAt !== null &&
      !(typeof state.lastSuccessAt === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(state.lastSuccessAt) && Number.isFinite(Date.parse(state.lastSuccessAt)))) return null;
  const success = Object.hasOwn(state, 'lastSuccessAt') ? { lastSuccessAt: state.lastSuccessAt as string | null } : {};
  const requestUrl = state.requestUrl === null ? null : validateAgendaRequest(state.requestUrl);
  if (state.requestUrl !== null && !requestUrl) return null;
  if (state.lastCheck === null) return { requestUrl, lastCheck: null, ...success };
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
  return { requestUrl, lastCheck, ...success };
}

export function isExtensionPage(sender: { id?: string; url?: string }, extensionId: string): boolean {
  if (sender.id !== extensionId || !sender.url) return false;
  try {
    const url = new URL(sender.url);
    return url.protocol === 'chrome-extension:' && url.host === extensionId && !url.username && !url.password && !url.hash &&
      ['popup.html', 'dashboard.html', 'options.html'].includes(url.pathname.slice(1)) &&
      (!url.search || (url.pathname === '/dashboard.html' && notificationTarget(url.search) !== null));
  } catch { return false; }
}
