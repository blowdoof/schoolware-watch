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
  const schoolDays = [...new Set([...(view.agenda?.days ?? []), ...(view.specialDays ?? [])
    .filter((entry) => entry.useTimetable || entry.kind !== 'other').map((entry) => entry.day)])].sort().filter((day) => {
    const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
    return day > today && weekday !== 0 && weekday !== 6;
  });
  const nextDay = schoolDays[0] ?? null;
  const targetDay = selectedDay && schoolDays.includes(selectedDay) ? selectedDay : nextDay;
  const browsing = targetDay !== nextDay;
  const dayAfter = targetDay ? schoolDays[schoolDays.indexOf(targetDay) + 1] ?? null : null;
  const pending = view.entries.filter((task) => !task.missingFromLatestCheck && task.status !== 'done' && hasAgendaMarker(task.snapshot.typePunt) &&
    !task.snapshot.hidden && !task.snapshot.cancelled);
  const chronological = (a: TaskEntry, b: TaskEntry) => a.snapshot.startsAt.localeCompare(b.snapshot.startsAt) || a.id.localeCompare(b.id);
  return { today, nextDay, schoolDays, targetDay, dayAfter, browsing,
    following: pending.filter((task) => dayAfter !== null && task.snapshot.startsAt.slice(0, 10) === dayAfter).sort(chronological),
    unconfirmed: view.entries.filter((task) => task.missingFromLatestCheck && task.status !== 'done' &&
      !task.snapshot.hidden && !task.snapshot.cancelled && hasAgendaMarker(task.snapshot.typePunt) &&
      [targetDay ?? today, dayAfter].includes(task.snapshot.startsAt.slice(0, 10))).sort(chronological),
    upcoming: pending.filter((task) => {
      const date = task.snapshot.startsAt.slice(0, 10);
      return date === (targetDay ?? today);
    }).sort(chronological),
    earlier: pending.filter((task) => task.snapshot.startsAt.slice(0, 10) < (nextDay ?? today)).sort(chronological),
  };
}

/** Deterministic local advice; no estimated duration, new deadlines or writes. */
export function todoPlanningProposal(view: TasksView, now: Date, selectedDay: string | null = null) {
  const overview = todoOverview(view, now, selectedDay);
  const rank = (task: TaskEntry) => task.help?.needed ? 0 : task.category === 'tests' ? 1 : task.category === 'assignments' ? 2 : 3;
  const prioritize = (tasks: TaskEntry[]) => [...tasks].sort((a, b) => rank(a) - rank(b) || a.snapshot.startsAt.localeCompare(b.snapshot.startsAt) || a.id.localeCompare(b.id));
  const tasks = [...prioritize(overview.upcoming), ...prioritize(overview.following)];
  return { tasks, preparations: (view.specialDays ?? []).filter((entry) =>
    entry.preparationDay === overview.today || [overview.targetDay, overview.dayAfter].includes(entry.day)),
    uncertain: overview.unconfirmed.length };
}
