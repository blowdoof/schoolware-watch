import type { Category, ObservationEvent, ObservationPoint, Snapshot } from './observations';
import { eligibleNotificationEvents } from './notification-window';

export interface LessonItem {
  itemId?: string;
  category: Category; kind: 'unchanged' | 'observed' | 'changed' | 'disappeared' | 'reappeared';
  before: Snapshot | null; after: Snapshot; fields: (keyof Snapshot)[];
  // For disappeared items, after is the last known snapshot for display only.
  taskReopened?: boolean;
}
export interface LessonDetail {
  startsAt: string; endsAt: string; subject: string; room: string; items: LessonItem[];
}
export interface NotificationDetails { observedAt: string; lessons: LessonDetail[] }

// Group presentation only; this never merges observation identities. A missing
// lesson ID falls back to the same agenda and time in the Schoolware adapter.
const lessonKey = (point: ObservationPoint) => JSON.stringify([
  point.lesson?.key ?? point.sourceKey, point.snapshot.startsAt, point.snapshot.endsAt,
]);

export function createNotificationDetails(points: ObservationPoint[], events: ObservationEvent[], now: Date,
  days: number, categories: Category[]): NotificationDetails | null {
  const eligible = eligibleNotificationEvents(events, now, days, categories);
  if (!eligible.length) return null;
  const selected = new Set(eligible.map((event) => event.sourceKey));
  const keys = new Set(points.filter((point) => selected.has(point.sourceKey)).map(lessonKey));
  const changes = new Map(events.map((event) => [event.sourceKey, event]));
  const groups = new Map<string, LessonDetail>();
  for (const point of points) {
    const key = lessonKey(point);
    if (!keys.has(key)) continue;
    let lesson = groups.get(key);
    if (!lesson) {
      lesson = { startsAt: point.snapshot.startsAt, endsAt: point.snapshot.endsAt,
        subject: point.lesson?.subject ?? '', room: point.lesson?.room ?? '', items: [] };
      groups.set(key, lesson);
    }
    if (!lesson.subject) lesson.subject = point.lesson?.subject ?? '';
    if (!lesson.room) lesson.room = point.lesson?.room ?? '';
    const event = changes.get(point.sourceKey);
    const kind = event && event.kind !== 'baseline' ? event.kind : 'unchanged';
    lesson.items.push({ category: point.category, kind, before: (kind === 'changed' || kind === 'disappeared' || kind === 'reappeared') && event!.before ? { ...event!.before } : null,
      after: { ...point.snapshot }, fields: kind === 'changed' ? [...event!.fields] : [],
      ...(event?.taskReopened ? { taskReopened: true } : {}),
      ...(point.localId ? { itemId: point.localId } : {}) });
  }
  return { observedAt: now.toISOString(), lessons: [...groups.values()].sort((a, b) =>
    a.startsAt.localeCompare(b.startsAt) || a.subject.localeCompare(b.subject)) };
}
