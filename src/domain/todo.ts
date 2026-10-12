import { brusselsWallTime } from './notification-window';
import { hasAgendaMarker } from './tasks';
import type { TaskEntry, TasksView } from '../shared/tasks';
import type { Category } from './observations';

export interface TodoReminderState {
  id: string; day: string; browserClaimedAt?: string; systemClaimedAt?: string;
}
export interface TodoReminderSelection { day: string; targetDay: string; pending: number }

/** Only fresh, positively observed planning can produce a daily reminder. */
export function todoReminderSelection(view: TasksView, now: Date, categories: Category[]): TodoReminderSelection | null {
  const wallTime = brusselsWallTime(now);
  const overview = todoOverview(view, now);
  if (wallTime.slice(11, 16) < '16:00' || !overview.nextDay || !view.agenda ||
      brusselsWallTime(new Date(view.agenda.lastSuccessAt)).slice(0, 10) !== overview.today) return null;
  const pending = overview.upcoming.filter((task) => categories.includes(task.category)).length;
  return pending ? { day: overview.today, targetDay: overview.nextDay, pending } : null;
}

/** A known agenda day is positive evidence, never proof that gaps are holidays. */
export function todoOverview(view: TasksView, now: Date, selectedDay: string | null = null) {
  const today = brusselsWallTime(now).slice(0, 10);
  const schoolDays = view.agenda?.days.filter((day) => {
    const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
    return day > today && weekday !== 0 && weekday !== 6;
  }) ?? [];
  const nextDay = schoolDays[0] ?? null;
  const targetDay = selectedDay && schoolDays.includes(selectedDay) ? selectedDay : nextDay;
  const browsing = targetDay !== nextDay;
  const pending = view.entries.filter((task) => !task.missingFromLatestCheck && task.status !== 'done' && hasAgendaMarker(task.snapshot.typePunt) &&
    !task.snapshot.hidden && !task.snapshot.cancelled);
  const chronological = (a: TaskEntry, b: TaskEntry) => a.snapshot.startsAt.localeCompare(b.snapshot.startsAt) || a.id.localeCompare(b.id);
  return { today, nextDay, schoolDays, targetDay, browsing,
    upcoming: pending.filter((task) => {
      const date = task.snapshot.startsAt.slice(0, 10);
      return date === (targetDay ?? today);
    }).sort(chronological),
    earlier: pending.filter((task) => task.snapshot.startsAt.slice(0, 10) < (nextDay ?? today)).sort(chronological),
  };
}
