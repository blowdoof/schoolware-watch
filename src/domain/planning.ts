import { brusselsWallTime } from './notification-window';

/** Bound only the visible window; ongoing tasks must remain visible. */
export function planningWindow(agendaDays: string[], tasks: { startsAt: string; endsAt: string }[], now: Date, dayLimit: number) {
  const today = brusselsWallTime(now).slice(0, 10);
  const days = [...new Set([...agendaDays, ...tasks.map((task) => {
    const start = task.startsAt.slice(0, 10);
    return start < today ? task.endsAt.slice(0, 10) : start;
  })])].filter((day) => day >= today).sort();
  return { days, cutoffDay: days.slice(0, dayLimit).at(-1) ?? null };
}
