import { createNotificationDetails, type NotificationDetails } from './notification-details';
import { isTaskCategory, type TaskStatus } from './tasks';
import type { TodoReminderState } from './todo';
import { brusselsWallTime } from './notification-window';

export type Category = 'tests' | 'assignments' | 'review' | 'other';
export interface Snapshot {
  title: string; instructions: string; typePunt: number;
  startsAt: string; endsAt: string; validFrom: string;
  hidden: boolean; cancelled: boolean; recurrence: string;
}
export interface LessonContext { key: string; subject: string; room: string }
export interface ObservationPoint { sourceKey: string; category: Category; snapshot: Snapshot; lesson?: LessonContext; localId?: string }
export interface ObservedItem extends ObservationPoint {
  firstSeenAt: string; lastSeenAt: string; present: boolean;
  taskStatus?: TaskStatus; taskUpdatedAt?: string;
}
export type EventKind = 'baseline' | 'observed' | 'changed' | 'disappeared' | 'reappeared';
export interface ObservationEvent {
  id: string; sourceKey: string; kind: EventKind; category: Category;
  observedAt: string; before: Snapshot | null; after: Snapshot | null;
  fields: (keyof Snapshot)[];
  taskReopened?: boolean;
}
export type ObservationCounts = Record<EventKind, number>;
export interface RecordedCheck {
  checkId: string; observedAt: string; complete: boolean; identityVerified: boolean;
  counts: ObservationCounts;
  coverage?: { minTot: string; maxVan: string };
  notificationClaimedAt?: string;
  notificationDetails?: NotificationDetails;
}
export interface HistoryScope {
  scopeId: string; baselineAt: string | null; lastSuccessAt: string;
  localId?: string;
  todoReminder?: TodoReminderState;
  schoolbagChoices?: { id: string; day: string; state: 'packed' | 'hidden' }[];
  items: ObservedItem[]; events: ObservationEvent[]; checks: RecordedCheck[];
}
export interface CheckInput {
  scopeId: string; checkId: string; observedAt: string; points: ObservationPoint[];
  complete: boolean; identityVerified: boolean;
  coverage?: { minTot: string; maxVan: string };
  legacyCoverage?: { minTot: string; maxVan: string };
  notificationSelection?: { days: number; categories: Category[] };
}

const fields: (keyof Snapshot)[] = ['title', 'instructions', 'typePunt', 'startsAt',
  'endsAt', 'validFrom', 'hidden', 'cancelled', 'recurrence'];

export function compareObservations(previous: HistoryScope | null, input: CheckInput): HistoryScope {
  if (previous && previous.scopeId !== input.scopeId) throw new Error('Scope mismatch');
  if (previous?.checks.some((check) => check.checkId === input.checkId)) return previous;
  if (previous && input.observedAt < previous.lastSuccessAt) throw new Error('Stale observation');
  const seen = new Set<string>();
  for (const point of input.points) {
    if (seen.has(point.sourceKey)) throw new Error('Ambiguous source identity');
    seen.add(point.sourceKey);
  }
  const baseline = !previous?.baselineAt;
  const items = new Map((previous?.items ?? []).map((item) => [item.sourceKey, item]));
  const events: ObservationEvent[] = [];
  const counts: ObservationCounts = { baseline: 0, observed: 0, changed: 0, disappeared: 0, reappeared: 0 };
  const emit = (point: ObservationPoint, kind: EventKind, before: Snapshot | null, after: Snapshot | null) => {
    counts[kind]++;
    events.push({ id: JSON.stringify([input.checkId, point.sourceKey, kind]), sourceKey: point.sourceKey,
      category: point.category, kind, observedAt: input.observedAt, before, after,
      fields: before && after ? fields.filter((field) => before[field] !== after[field]) : [] });
  };
  for (const point of input.points) {
    const old = items.get(point.sourceKey);
    const changedFields = old ? fields.filter((field) => old.snapshot[field] !== point.snapshot[field]) : [];
    const taskReopened = old?.taskStatus === 'done' && isTaskCategory(point.category) &&
      !point.snapshot.hidden && !point.snapshot.cancelled &&
      (!old.present || changedFields.some((field) => field !== 'validFrom'));
    const coveredBefore = !input.coverage || (previous?.checks ?? []).some((check) => {
      const coverage = check.coverage ?? input.legacyCoverage;
      // Boundary inclusivity is unverified: use the strict interior only.
      return coverage && point.snapshot.startsAt.slice(0, 10) > coverage.minTot &&
        point.snapshot.endsAt.slice(0, 10) < coverage.maxVan;
    });
    if (!old) emit(point, baseline || !coveredBefore ? 'baseline' : 'observed', null, point.snapshot);
    else if (!old.present) emit(point, 'reappeared', old.snapshot, point.snapshot);
    else if (changedFields.length) emit(point, 'changed', old.snapshot, point.snapshot);
    if (taskReopened) events.at(-1)!.taskReopened = true;
    items.set(point.sourceKey, { ...point, firstSeenAt: old?.firstSeenAt ?? input.observedAt,
      lastSeenAt: input.observedAt, present: true,
      ...(old?.localId ? { localId: old.localId } : {}),
      ...(taskReopened ? { taskStatus: 'in-progress', taskUpdatedAt: input.observedAt } : {
        ...(old?.taskStatus ? { taskStatus: old.taskStatus } : {}),
        ...(old?.taskUpdatedAt ? { taskUpdatedAt: old.taskUpdatedAt } : {}),
      }) });
  }
  // The current Schoolware adapter never supplies either verified flag.
  const lastCoverage = previous?.checks.at(-1)?.coverage;
  const comparableCoverage = (!input.coverage && !lastCoverage) || (input.coverage && lastCoverage?.minTot === input.coverage.minTot &&
    lastCoverage.maxVan === input.coverage.maxVan);
  if (input.complete && input.identityVerified && previous && comparableCoverage) {
    for (const item of previous.items) {
      const insideCoverage = !input.coverage || (item.snapshot.startsAt.slice(0, 10) > input.coverage.minTot &&
        item.snapshot.endsAt.slice(0, 10) < input.coverage.maxVan);
      if (item.present && insideCoverage && !seen.has(item.sourceKey)) {
        emit(item, 'disappeared', item.snapshot, null);
        items.set(item.sourceKey, { ...item, present: false });
      }
    }
  }
  const notificationDetails = input.notificationSelection ? createNotificationDetails([
    ...input.points, ...(previous?.items.filter((item) => events.some((event) =>
      event.sourceKey === item.sourceKey && event.kind === 'disappeared')) ?? []),
  ], events,
    new Date(input.observedAt), input.notificationSelection.days, input.notificationSelection.categories) : null;
  return { scopeId: input.scopeId,
    ...(previous?.localId ? { localId: previous.localId } : {}),
    ...(previous?.todoReminder ? { todoReminder: previous.todoReminder } : {}),
    ...(previous?.schoolbagChoices ? { schoolbagChoices: previous.schoolbagChoices.filter((choice) => choice.day >= brusselsWallTime(new Date(input.observedAt)).slice(0, 10)) } : {}),
    baselineAt: previous?.baselineAt ?? (input.points.length ? input.observedAt : null),
    lastSuccessAt: input.observedAt, items: [...items.values()],
    events: [...(previous?.events ?? []), ...events],
    checks: [...(previous?.checks ?? []), { checkId: input.checkId, observedAt: input.observedAt,
      complete: input.complete, identityVerified: input.identityVerified, counts,
      ...(input.coverage ? { coverage: input.coverage } : {}),
      ...(notificationDetails ? { notificationDetails } : {}) }] };
}

export function pruneHistory(scope: HistoryScope, cutoff: string): HistoryScope | null {
  if (scope.lastSuccessAt < cutoff) return null;
  return { ...scope, items: scope.items.filter((item) => item.lastSeenAt >= cutoff),
    events: scope.events.filter((event) => event.observedAt >= cutoff),
    checks: scope.checks.filter((check) => check.observedAt >= cutoff) };
}
