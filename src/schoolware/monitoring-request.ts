import { addCalendarDays, brusselsWallTime } from '../domain/notification-window';
import { validateAgendaRequest } from './agenda-request';

export function requestCoverage(requestUrl: string): { minTot: string; maxVan: string } {
  const url = new URL(requestUrl);
  return { minTot: url.searchParams.get('MinTot')!.slice(0, 10), maxVan: url.searchParams.get('MaxVan')!.slice(0, 10) };
}

export function monitoringRequest(requestUrl: string, now: Date, notificationDays: number): string {
  const validated = validateAgendaRequest(requestUrl);
  if (!validated) throw new Error('Invalid monitoring scope');
  const url = new URL(validated);
  const wallTime = brusselsWallTime(now);
  const suffix = url.pathname.startsWith('/webleerling/') ? 'T00:00:00' : '';
  url.searchParams.set('MinTot', addCalendarDays(wallTime, -7).slice(0, 10) + suffix);
  url.searchParams.set('MaxVan', addCalendarDays(wallTime, Math.max(14, notificationDays) + 1).slice(0, 10) + suffix);
  return validateAgendaRequest(url.href)!;
}
