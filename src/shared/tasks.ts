import type { HistoryScope, Snapshot } from '../domain/observations';
import { isTaskCategory, isTaskStatus, type TaskStatus } from '../domain/tasks';
import { isAlertId } from './browser-alerts';
import { validateSnapshot } from './history';

export const MAX_TASK_UPDATES = 5000;

export interface TaskEntry {
  id: string; category: 'tests' | 'assignments' | 'review'; snapshot: Snapshot; subject: string; room: string;
  status: TaskStatus; updatedAt: string | null; firstSeenAt: string; lastSeenAt: string;
}
export interface TaskAgenda { days: string[]; lastSuccessAt: string }
export interface TasksView { ok: boolean; entries: TaskEntry[]; agenda?: TaskAgenda }
export function createTasksView(scope: HistoryScope | null): TasksView {
  return { ok: true, ...(scope ? { agenda: {
    // Only positive evidence from the latest successful response. Retained items
    // missing from an incomplete response must not invent a future school day.
    days: [...new Set(scope.items.filter((item) => item.present && !item.snapshot.hidden && !item.snapshot.cancelled &&
      item.lastSeenAt === scope.lastSuccessAt).map((item) => item.snapshot.startsAt.slice(0, 10)))].sort(),
    lastSuccessAt: scope.lastSuccessAt,
  } } : {}), entries: (scope?.items ?? []).filter((item) => item.present && !item.snapshot.hidden && !item.snapshot.cancelled && isTaskCategory(item.category) && item.localId)
    .map((item) => ({ id: item.localId!, category: item.category as TaskEntry['category'], snapshot: item.snapshot,
      subject: item.lesson?.subject ?? '', room: item.lesson?.room ?? '', status: item.taskStatus ?? 'open',
      updatedAt: item.taskUpdatedAt ?? null, firstSeenAt: item.firstSeenAt, lastSeenAt: item.lastSeenAt }))
    .sort((a, b) => a.snapshot.startsAt.localeCompare(b.snapshot.startsAt) || a.snapshot.title.localeCompare(b.snapshot.title)) };
}
export function validateTasksView(value: unknown): TasksView | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const view = value as Record<string, unknown>;
  if (typeof view.ok !== 'boolean' || !Array.isArray(view.entries)) return null;
  const entries: TaskEntry[] = [];
  const timestamp = (raw: unknown): raw is string => typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(raw) && Number.isFinite(Date.parse(raw));
  let agenda: TaskAgenda | undefined;
  if (Object.hasOwn(view, 'agenda')) {
    const raw = view.agenda;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const value = raw as Record<string, unknown>;
    const days = value.days;
    if (Object.keys(value).length !== 2 || !timestamp(value.lastSuccessAt) || !Array.isArray(days) ||
        !days.every((day): day is string => typeof day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day) &&
          Number.isFinite(Date.parse(`${day}T00:00:00Z`)) && new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) === day) ||
        days.some((day, index) => index > 0 && day <= days[index - 1]!)) return null;
    agenda = { days: [...days], lastSuccessAt: value.lastSuccessAt };
  }
  for (const raw of view.entries) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const item = raw as Record<string, unknown>;
    const snapshot = validateSnapshot(item.snapshot);
    if (!isAlertId(item.id) || entries.some((entry) => entry.id === item.id) || !isTaskCategory(item.category as string) ||
        !snapshot || typeof item.subject !== 'string' || typeof item.room !== 'string' || !isTaskStatus(item.status) ||
        !(item.updatedAt === null || timestamp(item.updatedAt)) || !timestamp(item.firstSeenAt) || !timestamp(item.lastSeenAt)) return null;
    entries.push({ id: item.id, category: item.category as TaskEntry['category'], snapshot, subject: item.subject, room: item.room,
      status: item.status, updatedAt: item.updatedAt as string | null, firstSeenAt: item.firstSeenAt, lastSeenAt: item.lastSeenAt });
  }
  return { ok: view.ok, entries, ...(agenda ? { agenda } : {}) };
}
