import type { LessonDetail, LessonItem, NotificationDetails } from '../domain/notification-details';
import type { Category, Snapshot } from '../domain/observations';
import { addCalendarDays, brusselsWallTime } from '../domain/notification-window';
import { isAlertId } from './browser-alerts';
import { validateSnapshot } from './history';

export type NotificationTarget = string;
export const isNotificationTarget = (value: unknown): value is NotificationTarget => value === 'test' || isAlertId(value);
export interface NotificationDetailsView {
  ok: boolean; status: 'available' | 'missing' | 'test' | 'todo'; details: NotificationDetails | null;
}
export function notificationPage(target: NotificationTarget): string {
  if (!isNotificationTarget(target)) throw new Error('Invalid notification target');
  return `dashboard.html?alert=${encodeURIComponent(target)}`;
}
export function notificationTarget(search: string): NotificationTarget | null {
  const params = new URLSearchParams(search);
  const target = params.get('alert');
  return [...params.keys()].length === 1 && isNotificationTarget(target) ? target : null;
}

const categories: Category[] = ['tests', 'assignments', 'review', 'other'];
const fields: (keyof Snapshot)[] = ['title', 'instructions', 'typePunt', 'startsAt', 'endsAt',
  'validFrom', 'hidden', 'cancelled', 'recurrence'];
const record = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

export function validateNotificationDetails(value: unknown): NotificationDetails | null {
  if (!record(value) || typeof value.observedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(value.observedAt) ||
      !Number.isFinite(Date.parse(value.observedAt)) || !Array.isArray(value.lessons) || !value.lessons.length) return null;
  const lessons: LessonDetail[] = [];
  for (const raw of value.lessons) {
    if (!record(raw) || !['startsAt', 'endsAt', 'subject', 'room'].every((key) => typeof raw[key] === 'string') ||
        !Array.isArray(raw.items) || !raw.items.length) return null;
    const items: LessonItem[] = [];
    for (const item of raw.items) {
      if (!record(item) || !categories.includes(item.category as Category) ||
          (Object.hasOwn(item, 'itemId') && !isAlertId(item.itemId)) ||
          !['unchanged', 'observed', 'changed', 'disappeared', 'reappeared'].includes(item.kind as string) ||
          (Object.hasOwn(item, 'taskReopened') && typeof item.taskReopened !== 'boolean') || !Array.isArray(item.fields) ||
          !item.fields.every((field) => fields.includes(field))) return null;
      const before = validateSnapshot(item.before); const after = validateSnapshot(item.after);
      if (!after || before === false || (['changed', 'disappeared', 'reappeared'].includes(item.kind as string) && !before) ||
          (['unchanged', 'observed'].includes(item.kind as string) && before !== null) ||
          (item.kind !== 'changed' && item.fields.length) ||
          (item.taskReopened === true && (!['changed', 'reappeared'].includes(item.kind as string) ||
            !['tests', 'assignments', 'review'].includes(item.category as string) || after.hidden || after.cancelled))) return null;
      items.push({ category: item.category as Category, kind: item.kind as LessonItem['kind'], before, after,
        fields: item.fields as (keyof Snapshot)[], ...(item.itemId ? { itemId: item.itemId as string } : {}),
        ...(Object.hasOwn(item, 'taskReopened') ? { taskReopened: item.taskReopened as boolean } : {}) });
    }
    // Display projection only: no profile, lesson or source IDs cross this boundary.
    lessons.push({ startsAt: raw.startsAt as string, endsAt: raw.endsAt as string,
      subject: raw.subject as string, room: raw.room as string, items });
  }
  return { observedAt: value.observedAt, lessons };
}

export function validateNotificationDetailsView(value: unknown): NotificationDetailsView | null {
  if (!record(value) || typeof value.ok !== 'boolean' || !['available', 'missing', 'test', 'todo'].includes(value.status as string)) return null;
  const details = value.details === null ? null : validateNotificationDetails(value.details);
  if (value.status === 'missing' || value.status === 'todo' ? value.details !== null : !details) return null;
  return { ok: value.ok, status: value.status as NotificationDetailsView['status'], details };
}

/** Explicitly synthetic preview, never written to the observation repository. */
export function testNotificationDetails(now = new Date()): NotificationDetails {
  const tomorrow = addCalendarDays(brusselsWallTime(now), 1).slice(0, 10);
  const snapshot: Snapshot = { title: 'Voorbeeld: lesinhoud', instructions: 'Dit zijn voorbeeldgegevens.',
    typePunt: 0, startsAt: `${tomorrow} 09:00:00`, endsAt: `${tomorrow} 09:50:00`,
    validFrom: `${tomorrow} 00:00:00`, hidden: false, cancelled: false, recurrence: '' };
  const before = { ...snapshot, title: 'Voorbeeld: toets', typePunt: 101, instructions: 'Leer hoofdstuk 1.' };
  return { observedAt: now.toISOString(), lessons: [{ startsAt: snapshot.startsAt, endsAt: snapshot.endsAt,
    subject: 'Voorbeeldvak', room: 'Voorbeeldlokaal', items: [
      { category: 'other', kind: 'unchanged', before: null, after: snapshot, fields: [] },
      { category: 'assignments', kind: 'observed', before: null,
        after: { ...snapshot, title: 'Voorbeeld: nieuwe taak', typePunt: 1001, instructions: 'Maak oefeningen 1 en 2.' }, fields: [] },
      { category: 'tests', kind: 'changed', before,
        after: { ...before, instructions: 'Leer hoofdstukken 1 en 2.' }, fields: ['instructions'] },
    ] }] };
}
