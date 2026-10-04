import { addCalendarDays, brusselsWallTime } from '../domain/notification-window';
import { validateAgendaRequest } from './agenda-request';

export function requestCoverage(requestUrl: string): { minTot: string; maxVan: string } {
  const url = new URL(requestUrl);
  return { minTot: url.searchParams.get('MinTot')!, maxVan: url.searchParams.get('MaxVan')! };
}

export function monitoringRequest(requestUrl: string, now: Date, notificationDays: number): string {
  const validated = validateAgendaRequest(requestUrl);
  if (!validated) throw new Error('Invalid monitoring scope');
  const url = new URL(validated);
  const wallTime = brusselsWallTime(now);
  url.searchParams.set('MinTot', addCalendarDays(wallTime, -7).slice(0, 10));
  url.searchParams.set('MaxVan', addCalendarDays(wallTime, Math.max(14, notificationDays) + 1).slice(0, 10));
  return validateAgendaRequest(url.href)!;
}
