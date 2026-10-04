import type { Category, ObservationEvent } from './observations';

/** Source timestamps are interpreted as Brussels wall time for this installation. */
export function brusselsWallTime(now: Date): string {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Brussels', year: 'numeric', month: '2-digit',
    day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const get = (name: string) => parts.find((part) => part.type === name)!.value;
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}:${get('second')}`;
}

export function addCalendarDays(wallTime: string, days: number): string {
  const date = new Date(`${wallTime.replace(' ', 'T')}Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

export function notificationEventSelection(events: ObservationEvent[], now: Date, days: number, categories: Category[]) {
  const start = brusselsWallTime(now);
  const end = addCalendarDays(start, days);
  const selection = { events: [] as ObservationEvent[], baselineCount: 0, categoryExcludedCount: 0, outsideWindowCount: 0, inactiveCount: 0 };
  for (const event of events) {
    if (event.kind === 'baseline') { selection.baselineCount++; continue; }
    if (!categories.includes(event.category)) { selection.categoryExcludedCount++; continue; }
    // Include the previous planning for removals, cancellations and moves out
    // of the selected horizon; otherwise these changes would silently vanish.
    const snapshots = [event.after, ...((event.kind === 'changed' || event.kind === 'disappeared') ? [event.before] : [])]
      .filter((snapshot) => snapshot && !snapshot.hidden && !snapshot.cancelled);
    if (!snapshots.length) { selection.inactiveCount++; continue; }
    if (!snapshots.some((snapshot) => snapshot!.startsAt >= start && snapshot!.startsAt <= end)) {
      selection.outsideWindowCount++; continue;
    }
    selection.events.push(event);
  }
  return selection;
}

export function eligibleNotificationEvents(events: ObservationEvent[], now: Date, days: number, categories: Category[]): ObservationEvent[] {
  return notificationEventSelection(events, now, days, categories).events;
}
