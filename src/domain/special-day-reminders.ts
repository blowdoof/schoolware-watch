import type { SpecialDay } from './special-days';
import { brusselsWallTime } from './notification-window';

export const specialReminderKey = (entry: SpecialDay): string => `${entry.id}:${entry.preparationDay ?? entry.day}`;
/** 16:00 is outside DST transition hours. Derive the Brussels offset on the chosen date. */
function reminderTime(day: string): number {
  const candidate = Date.parse(`${day}T16:00:00Z`);
  const local = Date.parse(`${brusselsWallTime(new Date(candidate)).replace(' ', 'T')}Z`);
  return candidate - (local - candidate);
}
export function specialReminderPlan(entries: SpecialDay[], claimed: string[], now: Date) {
  const today = brusselsWallTime(now).slice(0, 10);
  const pending = entries.filter((entry) => (entry.preparationDay ?? entry.day) >= today && !claimed.includes(specialReminderKey(entry)));
  const due = pending.filter((entry) => reminderTime(entry.preparationDay ?? entry.day) <= now.getTime());
  const future = pending.filter((entry) => reminderTime(entry.preparationDay ?? entry.day) > now.getTime());
  return { due, nextAt: due.length ? now.getTime() + 60000 : future.length ? Math.min(...future.map((entry) => reminderTime(entry.preparationDay ?? entry.day))) : null };
}
