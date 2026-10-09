import { isAlertId } from './browser-alerts';
import { isTaskStatus, type TaskStatus } from '../domain/tasks';
import type { Snapshot } from '../domain/observations';
import type { Category } from '../domain/observations';

export const MAX_ACTIVITY_ENTRIES = 20000;
export const ACTIVITY_ACTIONS = ['worker.started', 'worker.installed', 'browser.started', 'alarm.configured', 'alarm.fired',
  'request', 'message.rejected', 'check', 'transport', 'retry.scheduled', 'observation.baseline', 'observation.observed',
  'observation.changed', 'observation.disappeared', 'observation.reappeared', 'notification.selection',
  'notification.system', 'notification.clicked', 'notification.closed', 'notification.cleared', 'notification.details',
  'banner.published', 'banner.rendered', 'banner.opened', 'banner.dismissed', 'banner.broadcast', 'website.script',
  'preferences.saved', 'permission.changed', 'permission.requested', 'task.status', 'log.exported',
  'progress.sync', 'progress.registration', 'progress.exchange', 'progress.apply', 'progress.members',
  'progress.leave', 'progress.delete', 'progress.connection', 'progress.name', 'notification.todo', 'notification.progress', 'notification.specialDays', 'connection.discovery'] as const;
export type ActivityAction = typeof ACTIVITY_ACTIONS[number];
export type ActivityPhase = 'started' | 'succeeded' | 'failed' | 'skipped' | 'info';
export type ActivityContext = 'worker' | 'popup' | 'options' | 'dashboard' | 'schoolware' | 'alarm' | 'system';
export const ACTIVITY_REQUESTS = ['setup.complete', 'ui.open', 'sync.read', 'sync.run', 'sync.create', 'sync.connect', 'sync.disconnect', 'sync.delete', 'sync.pairing', 'connection.read', 'connection.clear', 'history.read', 'history.clear', 'history.retention',
  'sync.name', 'specialDays.read', 'specialDays.save', 'specialDays.delete',
  'connection.discovery.start', 'connection.discovery.read', 'connection.discovery.cancel', 'connection.discovery.confirm',
  'preferences.read', 'preferences.save', 'notifications.test', 'notifications.details', 'browser.alerts.read',
  'browser.alerts.dismiss', 'browser.alerts.test', 'browser.alerts.open', 'browser.alerts.rendered', 'agenda.check',
  'schoolbag.read', 'schoolbag.update', 'tasks.read', 'tasks.update', 'tasks.updateMany', 'tasks.help', 'activity.read', 'activity.clear', 'activity.exported', 'permission.result'] as const;
export const ACTIVITY_REASONS = ['success', 'session-required', 'redirected', 'api-failure', 'invalid-response',
  'network-error', 'timeout', 'http-error', 'rate-limited', 'invalid-request', 'permission-required', 'busy', 'storage-error',
  'api-error', 'blocked', 'accepted', 'denied', 'granted', 'unavailable', 'disabled', 'backoff', 'no-events',
  'already-claimed', 'cancelled', 'user', 'system', 'invalid-message', 'untrusted-sender', 'unchanged', 'missing', 'test', 'source-changed',
  'profile-mismatch', 'authentication-failed', 'decryption-failed', 'crypto-error', 'registration-pending', 'pagination-pending', 'partial-success', 'remote-sync', 'no-reminder'] as const;
export type ActivityReason = typeof ACTIVITY_REASONS[number];
export const ACTIVITY_TRIGGERS = ['alarm', 'manual', 'task-edit', 'agenda-check', 'startup', 'installation', 'permission-change', 'disconnect'] as const;
export type ActivityTrigger = typeof ACTIVITY_TRIGGERS[number];
export interface ActivityData {
  request?: typeof ACTIVITY_REQUESTS[number]; permission?: 'notifications' | 'browser' | 'schoolware';
  reason?: ActivityReason; count?: number; added?: number; changed?: number; days?: number; durationMs?: number;
  baselineCount?: number; categoryExcludedCount?: number; outsideWindowCount?: number; inactiveCount?: number;
  intervalMinutes?: number; retryAt?: string; scheduledAt?: string; registered?: boolean; test?: boolean; byUser?: boolean;
  monitoringEnabled?: boolean; notificationsEnabled?: boolean; browserNotificationsEnabled?: boolean; todoRemindersEnabled?: boolean; schoolbagEnabled?: boolean;
  newColor?: string; changedColor?: string; categories?: Category[]; failedCount?: number;
  from?: TaskStatus; to?: TaskStatus; fields?: (keyof Snapshot)[];
  trigger?: ActivityTrigger; alarm?: 'agenda' | 'progress-sync' | 'agenda-discovery' | 'special-days';
  uploadedCount?: number; downloadedCount?: number; pendingCount?: number; httpStatus?: number;
  applied?: boolean; membersUpdated?: boolean; hasMore?: boolean;
}
export type ActivityReporter = (action: ActivityAction, phase: ActivityPhase, data?: ActivityData) => Promise<void>;
export interface ActivityInput {
  id: string; timestamp: string; correlationId: string; spanId: string; action: ActivityAction;
  phase: ActivityPhase; context: ActivityContext; profileId?: string; itemId?: string; data: ActivityData;
}
export interface ActivityEntry extends ActivityInput { sequence: number }
export interface ActivityView { ok: boolean; healthy: boolean; total: number; retentionDays: number; entries: ActivityEntry[] }

const record = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const timestamp = (value: unknown): value is string => typeof value === 'string' &&
  /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value));
const fields: (keyof Snapshot)[] = ['title', 'instructions', 'typePunt', 'startsAt', 'endsAt', 'validFrom',
  'hidden', 'cancelled', 'recurrence'];

/** Allowlisted metadata only. Never accept arbitrary text, source objects or URLs. */
export function validateActivityInput(value: unknown): ActivityInput | null {
  if (!record(value) || !isAlertId(value.id) || !isAlertId(value.correlationId) || !isAlertId(value.spanId) ||
      !timestamp(value.timestamp) || !ACTIVITY_ACTIONS.includes(value.action as ActivityAction) ||
      !['started', 'succeeded', 'failed', 'skipped', 'info'].includes(value.phase as string) ||
      !['worker', 'popup', 'options', 'dashboard', 'schoolware', 'alarm', 'system'].includes(value.context as string) || !record(value.data)) return null;
  for (const key of ['profileId', 'itemId'] as const) if (Object.hasOwn(value, key) && !isAlertId(value[key])) return null;
  const data: ActivityData = {};
  if (Object.hasOwn(value.data, 'request')) {
    if (!ACTIVITY_REQUESTS.includes(value.data.request as typeof ACTIVITY_REQUESTS[number])) return null;
    data.request = value.data.request as typeof ACTIVITY_REQUESTS[number];
  }
  if (Object.hasOwn(value.data, 'permission')) {
    if (!['notifications', 'browser', 'schoolware'].includes(value.data.permission as string)) return null;
    data.permission = value.data.permission as 'notifications' | 'browser' | 'schoolware';
  }
  for (const key of ['count', 'added', 'changed', 'days', 'durationMs', 'intervalMinutes', 'failedCount',
    'baselineCount', 'categoryExcludedCount', 'outsideWindowCount', 'inactiveCount', 'uploadedCount', 'downloadedCount', 'pendingCount'] as const) {
    if (Object.hasOwn(value.data, key)) {
      if (typeof value.data[key] !== 'number' || !Number.isSafeInteger(value.data[key]) || value.data[key] < 0) return null;
      data[key] = value.data[key];
    }
  }
  for (const key of ['retryAt', 'scheduledAt'] as const) {
    if (Object.hasOwn(value.data, key)) { if (!timestamp(value.data[key])) return null; data[key] = value.data[key]; }
  }
  if (Object.hasOwn(value.data, 'httpStatus')) {
    if (typeof value.data.httpStatus !== 'number' || !Number.isInteger(value.data.httpStatus) || value.data.httpStatus < 100 || value.data.httpStatus > 599) return null;
    data.httpStatus = value.data.httpStatus;
  }
  if (Object.hasOwn(value.data, 'trigger')) {
    if (!ACTIVITY_TRIGGERS.includes(value.data.trigger as ActivityTrigger)) return null;
    data.trigger = value.data.trigger as ActivityTrigger;
  }
  if (Object.hasOwn(value.data, 'alarm')) {
    if (!['agenda', 'progress-sync', 'agenda-discovery', 'special-days'].includes(value.data.alarm as string)) return null;
    data.alarm = value.data.alarm as NonNullable<ActivityData['alarm']>;
  }
  for (const key of ['registered', 'test', 'byUser', 'monitoringEnabled', 'notificationsEnabled', 'browserNotificationsEnabled', 'todoRemindersEnabled', 'schoolbagEnabled', 'applied', 'membersUpdated', 'hasMore'] as const) {
    if (Object.hasOwn(value.data, key)) { if (typeof value.data[key] !== 'boolean') return null; data[key] = value.data[key]; }
  }
  for (const key of ['newColor', 'changedColor'] as const) {
    if (Object.hasOwn(value.data, key)) {
      if (typeof value.data[key] !== 'string' || !/^#[0-9a-f]{6}$/i.test(value.data[key])) return null;
      data[key] = value.data[key];
    }
  }
  if (Object.hasOwn(value.data, 'categories')) {
    if (!Array.isArray(value.data.categories) || !value.data.categories.every((category) => ['tests', 'assignments', 'review', 'other'].includes(category))) return null;
    data.categories = value.data.categories as Category[];
  }
  for (const key of ['from', 'to'] as const) {
    if (Object.hasOwn(value.data, key)) { if (!isTaskStatus(value.data[key])) return null; data[key] = value.data[key]; }
  }
  if (Object.hasOwn(value.data, 'reason')) {
    if (!ACTIVITY_REASONS.includes(value.data.reason as ActivityReason)) return null;
    data.reason = value.data.reason as ActivityReason;
  }
  if (Object.hasOwn(value.data, 'fields')) {
    if (!Array.isArray(value.data.fields) || !value.data.fields.every((field) => fields.includes(field))) return null;
    data.fields = value.data.fields as (keyof Snapshot)[];
  }
  return { id: value.id, correlationId: value.correlationId, spanId: value.spanId, timestamp: value.timestamp,
    action: value.action as ActivityAction, phase: value.phase as ActivityPhase, context: value.context as ActivityContext,
    ...(value.profileId ? { profileId: value.profileId as string } : {}),
    ...(value.itemId ? { itemId: value.itemId as string } : {}), data };
}

export function validateActivityView(value: unknown): ActivityView | null {
  if (!record(value) || typeof value.ok !== 'boolean' || typeof value.healthy !== 'boolean' || typeof value.total !== 'number' || !Number.isSafeInteger(value.total) ||
      value.total < 0 || value.total > MAX_ACTIVITY_ENTRIES || ![30, 90, 180, 365].includes(value.retentionDays as number) ||
      !Array.isArray(value.entries) || value.entries.length > MAX_ACTIVITY_ENTRIES) return null;
  const entries: ActivityEntry[] = [];
  for (const raw of value.entries) {
    const entry = validateActivityInput(raw);
    if (!entry || !record(raw) || typeof raw.sequence !== 'number' || !Number.isSafeInteger(raw.sequence) || raw.sequence < 1) return null;
    entries.push({ ...entry, sequence: raw.sequence });
  }
  return { ok: value.ok, healthy: value.healthy, total: value.total, retentionDays: value.retentionDays as number, entries };
}
