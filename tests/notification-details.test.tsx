import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { compareObservations, type ObservationPoint } from '../src/domain/observations';
import { createObservationInput } from '../src/schoolware/observation-input';
import { validateAgendaResponse } from '../src/schoolware/agenda-response';
import { isExtensionPage, validateConnectionMessage } from '../src/shared/connection';
import { notificationPage, notificationTarget, testNotificationDetails, validateNotificationDetailsView } from '../src/shared/notification-details';
import { LessonDetails } from '../src/ui/NotificationDetailsPanel';
import { DEFAULT_PREFERENCES } from '../src/shared/preferences';
import { check, point } from './fixtures/observations';
import { requestUrl } from './fixtures/agenda-request';
import fixture from './fixtures/synthetic-agenda.json';

const lesson = { key: 'synthetic-lesson', subject: 'Synthetic subject', room: 'Synthetic room' };
const planned = (overrides: Partial<ObservationPoint> = {}): ObservationPoint => ({ ...structuredClone(point), lesson, ...overrides });
const selection = { days: 3, categories: ['assignments' as const] };

describe('notification lesson details', () => {
  it('retains the last known lesson snapshot for verified disappearance and labels reopened tasks in notifications', () => {
    const original = planned({ localId: crypto.randomUUID() });
    const first = compareObservations(null, check({ points: [original] }));
    first.items[0]!.taskStatus = 'done';
    const gone = compareObservations(first, check({ checkId: 'gone', points: [], complete: true,
      identityVerified: true, notificationSelection: selection }));
    const details = gone.checks.at(-1)!.notificationDetails!;
    expect(details.lessons[0]!.items[0]).toMatchObject({ kind: 'disappeared', before: point.snapshot, after: point.snapshot });
    expect(validateNotificationDetailsView({ ok: true, status: 'available', details })?.details).toEqual(details);
    const removedHtml = renderToStaticMarkup(<LessonDetails details={details} colors={DEFAULT_PREFERENCES} />);
    expect(removedHtml).toContain('Niet meer zichtbaar');
    expect(removedHtml).toContain('laatst bekende inhoud');
    expect(removedHtml).not.toContain('aria-label="Taakstatus"');
    const returned = compareObservations(gone, check({ checkId: 'returned', points: [original], notificationSelection: selection }));
    const returnedDetails = returned.checks.at(-1)!.notificationDetails!;
    expect(returnedDetails.lessons[0]!.items[0]).toMatchObject({ kind: 'reappeared', taskReopened: true });
    expect(validateNotificationDetailsView({ ok: true, status: 'available', details: returnedDetails })?.details).toEqual(returnedDetails);
    const html = renderToStaticMarkup(<LessonDetails details={returnedDetails} colors={DEFAULT_PREFERENCES} />);
    expect(html).toContain('weer op Bezig gezet');
    const invalid = structuredClone(returnedDetails);
    invalid.lessons[0]!.items[0]!.taskReopened = 'yes' as never;
    expect(validateNotificationDetailsView({ ok: true, status: 'available', details: invalid })).toBeNull();
  });

  it('freezes all fetched points of affected lessons, highlighting only changes from that check', () => {
    const unchanged = planned({ sourceKey: 'lesson-content', category: 'other', snapshot: { ...point.snapshot, title: 'Synthetic lesson' } });
    const otherAgenda = planned({ sourceKey: 'other-agenda', lesson: { ...lesson, key: 'different-agenda' } });
    const old = compareObservations(null, check({ points: [planned(), unchanged, otherAgenda], notificationSelection: selection }));
    expect(old.checks[0]?.notificationDetails).toBeUndefined();
    const added = planned({ sourceKey: 'new-assignment', snapshot: { ...point.snapshot, title: 'Synthetic added assignment' } });
    const updated = planned({ snapshot: { ...point.snapshot, instructions: 'Synthetic updated instructions' } });
    const input = check({ checkId: 'next', points: [updated, unchanged, added, otherAgenda], notificationSelection: selection });
    const next = compareObservations(old, input);
    const details = next.checks.at(-1)!.notificationDetails!;
    expect(details.lessons).toHaveLength(1);
    expect(details.lessons[0]).toMatchObject({ subject: lesson.subject, room: lesson.room });
    expect(details.lessons[0]!.items.map((item) => item.kind)).toEqual(['changed', 'unchanged', 'observed']);
    expect(details.lessons[0]!.items[0]).toMatchObject({ before: point.snapshot, fields: ['instructions'] });
    expect(JSON.stringify(details)).not.toContain('synthetic-lesson');
    expect(JSON.stringify(details)).not.toContain('new-assignment');
    expect(compareObservations(next, input)).toEqual(next);
    const later = compareObservations(next, check({ checkId: 'later', observedAt: '2026-10-02T09:00:00Z',
      points: [planned(), unchanged, added, otherAgenda], notificationSelection: selection }));
    expect(later.checks[1]!.notificationDetails).toEqual(details);
    updated.snapshot.instructions = 'Mutation after commit';
    expect(details.lessons[0]!.items[0]!.after.instructions).toBe('Synthetic updated instructions');
  });

  it('separates different times and agendas, ignores non-qualifying events, and does not treat context enrichment as a change', () => {
    const old = compareObservations(null, check());
    const enriched = compareObservations(old, check({ checkId: 'enriched', points: [planned()], notificationSelection: selection }));
    expect(enriched.checks.at(-1)!.counts.changed).toBe(0);
    expect(enriched.checks.at(-1)!.notificationDetails).toBeUndefined();
    const later = planned({ sourceKey: 'later-hour', snapshot: { ...point.snapshot, startsAt: '2026-10-05 10:00:00', endsAt: '2026-10-05 10:50:00' } });
    const outside = planned({ sourceKey: 'outside', snapshot: { ...point.snapshot, startsAt: '2026-10-10 09:00:00' } });
    const other = planned({ sourceKey: 'other-profile', lesson: { ...lesson, key: 'another-agenda' } });
    const next = compareObservations(enriched, check({ checkId: 'added', points: [planned(), later, outside, other], notificationSelection: selection }));
    expect(next.checks.at(-1)!.notificationDetails!.lessons).toHaveLength(2);
    expect(next.checks.at(-1)!.notificationDetails!.lessons.map((group) => group.items.length)).toEqual([1, 1]);
    const differentProfile = compareObservations(null, check({ scopeId: 'separate-profile', points: [planned()], notificationSelection: selection }));
    expect(differentProfile.checks[0]!.notificationDetails).toBeUndefined();
  });

  it('keeps only subject/room and scoped lesson context from the source, without staff or pupil names', () => {
    const result = validateAgendaResponse({ success: true, data: [{ ...fixture.data[0], LesDataID: 123,
      VakNaam: 'Synthetic subject', LokaalCode: 'X1', LokaalOmschrijving: 'X1', PersoneelNaam: 'Synthetic private staff' }] });
    if (!result.ok) throw new Error('Invalid synthetic fixture');
    const input = createObservationInput(requestUrl, result.points, crypto.randomUUID(), '2026-10-02T08:00:00Z');
    expect(input.points[0]?.lesson).toMatchObject({ subject: 'Synthetic subject', room: 'X1' });
    expect(JSON.stringify(input)).not.toContain('Synthetic private staff');
    const invalid = validateAgendaResponse({ success: true, data: [{ ...fixture.data[0], LesDataID: '123' }] });
    expect(invalid).toMatchObject({ ok: false, field: 'LesDataID' });
  });

  it('validates projections and routes and rejects injected destinations or query parameters', () => {
    const details = testNotificationDetails(new Date('2026-10-02T08:00:00Z'));
    const view = { ok: true, status: 'test', details };
    expect(validateNotificationDetailsView(view)).toEqual(view);
    expect(validateNotificationDetailsView({ ...view, details: null })).toBeNull();
    expect(validateNotificationDetailsView({ ...view, status: 'missing' })).toBeNull();
    expect(validateNotificationDetailsView({ ...view, details: { ...details, lessons: [{ ...details.lessons[0], items: [{ ...details.lessons[0]!.items[0], kind: 'unknown' }] }] } })).toBeNull();
    expect(notificationPage('test')).toBe('dashboard.html?alert=test');
    expect(notificationTarget('?alert=test&url=https://example.test')).toBeNull();
    expect(notificationTarget('?alert=test&alert=test')).toBeNull();
    expect(validateConnectionMessage({ type: 'notifications.details', target: 'test' })).toEqual({ type: 'notifications.details', target: 'test' });
    expect(validateConnectionMessage({ type: 'notifications.details', target: 'test', scopeId: 'other' })).toBeNull();
    const id = crypto.randomUUID();
    expect(validateConnectionMessage({ type: 'browser.alerts.open', alertId: id })).toEqual({ type: 'browser.alerts.open', alertId: id });
    expect(validateConnectionMessage({ type: 'browser.alerts.open', alertId: 'invalid' })).toBeNull();
    const sender = { id: 'syntheticextension', url: 'chrome-extension://syntheticextension/dashboard.html?alert=test' };
    expect(isExtensionPage(sender, sender.id)).toBe(true);
    expect(isExtensionPage({ ...sender, url: `${sender.url}&scope=other` }, sender.id)).toBe(false);
    expect(isExtensionPage({ ...sender, url: sender.url.replace('/dashboard.html', '/options.html') }, sender.id)).toBe(false);
    expect(isExtensionPage({ ...sender, url: sender.url.replace('chrome-extension:', 'https:') }, sender.id)).toBe(false);
  });

  it('renders all lesson items with custom accents, accessible labels and before/after differences, without executing source HTML', () => {
    const details = testNotificationDetails(new Date('2026-10-02T08:00:00Z'));
    details.lessons[0]!.items[0]!.after.instructions = '<img src="https://example.test/track">Safe <script>alert(1)</script>';
    const html = renderToStaticMarkup(<LessonDetails details={details} colors={{ ...DEFAULT_PREFERENCES, newColor: '#123456', changedColor: '#654321' }} />);
    expect(html).toContain('Nieuw waargenomen');
    expect(html).toContain('Gewijzigd');
    expect(html).toContain('Ongewijzigd');
    expect(html).toContain('Voor: Leer hoofdstuk 1.');
    expect(html).toContain('Na: Leer hoofdstukken 1 en 2.');
    expect(html).toContain('5px solid #123456');
    expect(html).toContain('5px solid #654321');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('https://example.test/track');
  });
});
