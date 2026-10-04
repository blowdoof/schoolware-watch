import { describe, expect, it } from 'vitest';
import { addCalendarDays, brusselsWallTime, eligibleNotificationEvents, notificationEventSelection } from '../src/domain/notification-window';
import { monitoringRequest } from '../src/schoolware/monitoring-request';
import { DEFAULT_PREFERENCES, validatePreferences, validatePreferencesView } from '../src/shared/preferences';
import { validateConnectionMessage } from '../src/shared/connection';
import type { Category, EventKind, ObservationEvent } from '../src/domain/observations';
import { point } from './fixtures/observations';
import { requestUrl } from './fixtures/agenda-request';

const now = new Date('2026-10-02T08:00:00Z');
function event(startsAt: string, kind: EventKind = 'observed', category: Category = 'tests'): ObservationEvent {
  return { id: 'synthetic-event', sourceKey: 'synthetic-source', kind, category, observedAt: now.toISOString(),
    before: null, after: { ...point.snapshot, startsAt }, fields: [] };
}

describe('notification window', () => {
  it('counts exclusion reasons without changing selection or including agenda text in diagnostics', () => {
    const hidden = event('2026-10-03 09:00:00'); hidden.after!.hidden = true;
    const eligible = event('2026-10-03 09:00:00');
    const events = [event('2026-10-03 09:00:00', 'baseline'), event('2026-10-03 09:00:00', 'observed', 'other'),
      event('2026-10-10 09:00:00'), hidden, eligible];
    const { events: selected, ...counts } = notificationEventSelection(events, now, 3, ['tests']);
    expect(selected).toEqual([eligible]);
    expect(counts).toEqual({ baselineCount: 1, categoryExcludedCount: 1, outsideWindowCount: 1, inactiveCount: 1 });
    expect(eligibleNotificationEvents(events, now, 3, ['tests'])).toEqual(selected);
    expect(JSON.stringify(counts)).not.toContain('Synthetic');
  });
  it('includes now and the selected future limit, excludes past and later starts', () => {
    const events = ['2026-10-02 09:59:59', '2026-10-02 10:00:00', '2026-10-05 10:00:00', '2026-10-05 10:00:01'].map((time) => event(time));
    expect(eligibleNotificationEvents(events, now, 3, ['tests'])).toEqual(events.slice(1, 3));
  });

  it('excludes baseline, hidden/cancelled new points and unselected categories', () => {
    const events: ObservationEvent[] = [event('2026-10-03 09:00:00', 'baseline')];
    events.push(event('2026-10-03 09:00:00', 'observed', 'review'));
    const hidden = event('2026-10-03 09:00:00'); hidden.after!.hidden = true; events.push(hidden);
    const cancelled = event('2026-10-03 09:00:00'); cancelled.after!.cancelled = true; events.push(cancelled);
    expect(eligibleNotificationEvents(events, now, 3, ['tests'])).toEqual([]);
    expect(eligibleNotificationEvents([event('2026-10-03 09:00:00', 'changed')], now, 3, ['tests'])).toHaveLength(1);
  });

  it('notifies disappearance, cancellation, hiding, reappearance and moving out of the horizon using the previous active planning', () => {
    const before = { ...point.snapshot, startsAt: '2026-10-03 09:00:00' };
    const events: ObservationEvent[] = [
      { ...event(before.startsAt, 'disappeared'), before, after: null },
      { ...event(before.startsAt, 'changed'), before, after: { ...before, cancelled: true } },
      { ...event(before.startsAt, 'changed'), before, after: { ...before, hidden: true } },
      { ...event(before.startsAt, 'changed'), before, after: { ...before, startsAt: '2026-11-01 09:00:00' } },
      { ...event(before.startsAt, 'reappeared'), before },
    ];
    expect(eligibleNotificationEvents(events, now, 3, ['tests'])).toEqual(events);
    expect(eligibleNotificationEvents(events, now, 3, ['assignments'])).toEqual([]);
    expect(eligibleNotificationEvents([{ ...events[0]!, before: { ...before, cancelled: true } }], now, 3, ['tests'])).toEqual([]);
  });

  it('uses Brussels wall time across daylight saving and year boundaries independently of machine timezone', () => {
    expect(brusselsWallTime(now)).toBe('2026-10-02 10:00:00');
    expect(brusselsWallTime(new Date('2026-10-25T01:30:00Z'))).toBe('2026-10-25 02:30:00');
    const autumn = new Date('2026-10-24T08:00:00Z');
    expect(eligibleNotificationEvents([event('2026-10-25 10:00:00')], autumn, 1, ['tests'])).toHaveLength(1);
    expect(addCalendarDays('2026-12-31 10:00:00', 3)).toBe('2027-01-03 10:00:00');
  });
});

describe('rolling request', () => {
  it('preserves the profile/agenda selection and moves dates with today and the notification horizon', () => {
    const initial = new URL(requestUrl);
    const rolling = new URL(monitoringRequest(requestUrl, now, 30));
    for (const key of ['AgendaID', 'MapAgendasOp', 'CompletedTaskForLL']) {
      expect(rolling.searchParams.get(key)).toBe(initial.searchParams.get(key));
    }
    expect(rolling.searchParams.get('MinTot')).toBe('2026-09-25');
    expect(rolling.searchParams.get('MaxVan')).toBe('2026-11-02');
    expect(new URL(monitoringRequest(requestUrl, new Date('2026-10-03T08:00:00Z'), 3)).searchParams.get('MaxVan')).toBe('2026-10-18');
  });
});

describe('preferences and message validation', () => {
  it('accepts supported settings and rejects arbitrary fields, unsafe colors, limits and duplicate categories', () => {
    expect(validatePreferences(DEFAULT_PREFERENCES)).toEqual(DEFAULT_PREFERENCES);
    for (const changed of [{ intervalMinutes: 0 }, { intervalMinutes: '15' }, { notificationDays: 31 },
      { notificationDays: -1 }, { notificationDays: 1.5 }, { newColor: 'url(https://example.test)' },
      { notificationCategories: [] }, { notificationCategories: ['tests', 'tests'] }, { token: 'synthetic' }]) {
      expect(validatePreferences({ ...DEFAULT_PREFERENCES, ...changed })).toBeNull();
      expect(validateConnectionMessage({ type: 'preferences.save', preferences: { ...DEFAULT_PREFERENCES, ...changed } })).toBeNull();
    }
    expect(validateConnectionMessage({ type: 'notifications.test', url: 'https://example.test' })).toBeNull();
    expect(validatePreferencesView({ ok: true, preferences: DEFAULT_PREFERENCES, notificationPermission: true,
      monitoringScheduled: true, nextCheckAt: 'invalid', retryAt: null })).toBeNull();
  });
});
