import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { todoOverview, todoReminderSelection } from '../src/domain/todo';
import { compareObservations } from '../src/domain/observations';
import { createTasksView, validateTasksView, type TaskEntry, type TasksView } from '../src/shared/tasks';
import { TodoOverview } from '../src/ui/TodoPanel';
import { check, point } from './fixtures/observations';

function task(date: string, status: TaskEntry['status'] = 'open', typePunt = 1001): TaskEntry {
  return { id: crypto.randomUUID(), category: 'assignments',
    snapshot: { ...point.snapshot, startsAt: `${date} 09:00:00`, endsAt: `${date} 09:50:00`, typePunt },
    subject: 'Synthetic subject', room: '', status, updatedAt: null,
    firstSeenAt: '2026-10-02T08:00:00.000Z', lastSeenAt: '2026-10-02T08:00:00.000Z' };
}
function view(days: string[], entries: TaskEntry[] = []): TasksView {
  return { ok: true, entries, agenda: { days, lastSuccessAt: '2026-10-02T08:00:00.000Z' } };
}

describe('agenda-based to-do horizon', () => {
  it('browses only known future weekdays while keeping overdue work and the default reminder horizon separate', () => {
    const earlier = task('2026-10-01'); const today = task('2026-10-02');
    const monday = task('2026-10-05'); const wednesday = task('2026-10-07', 'in-progress');
    const candidate = view(['2026-10-02', '2026-10-03', '2026-10-05', '2026-10-07'],
      [earlier, today, monday, wednesday, task('2026-10-07', 'done')]);
    const now = new Date('2026-10-02T18:00:00Z');
    const selected = todoOverview(candidate, now, '2026-10-07');
    expect(selected.schoolDays).toEqual(['2026-10-05', '2026-10-07']);
    expect(selected.targetDay).toBe('2026-10-07');
    expect(selected.nextDay).toBe('2026-10-05');
    expect(selected.browsing).toBe(true);
    expect(selected.upcoming).toEqual([wednesday]);
    expect(selected.earlier).toEqual([earlier, today]);
    expect(todoOverview(candidate, now).upcoming).toEqual([monday]);
    expect(todoReminderSelection(candidate, now, ['assignments'])?.pending).toBe(1);
    for (const removedOrInvalidDay of ['2026-10-01', '2026-10-03', '2026-10-06', 'invalid']) {
      const fallback = todoOverview(candidate, now, removedOrInvalidDay);
      expect(fallback.targetDay).toBe('2026-10-05');
      expect(fallback.browsing).toBe(false);
      expect(fallback.upcoming).toEqual([monday]);
    }
  });
  it('reminds only after 16:00 Brussels time, for fresh known planning and selected unfinished categories', () => {
    const pending = task('2026-10-05', 'in-progress');
    const candidate = view(['2026-10-05'], [pending, task('2026-10-05', 'done'), task('2026-10-06')]);
    expect(todoReminderSelection(candidate, new Date('2026-10-02T13:59:59Z'), ['assignments'])).toBeNull();
    expect(todoReminderSelection(candidate, new Date('2026-10-02T14:00:00Z'), ['assignments'])).toEqual({
      day: '2026-10-02', targetDay: '2026-10-05', pending: 1,
    });
    expect(todoReminderSelection(candidate, new Date('2026-10-02T14:00:00Z'), ['tests'])).toBeNull();
    expect(todoReminderSelection(candidate, new Date('2026-10-03T14:00:00Z'), ['assignments'])).toBeNull();
    expect(todoReminderSelection(view([], [pending]), new Date('2026-10-02T14:00:00Z'), ['assignments'])).toBeNull();
    const winter = { ...candidate, agenda: { days: ['2026-11-12'], lastSuccessAt: '2026-11-10T08:00:00.000Z' }, entries: [task('2026-11-12')] };
    expect(todoReminderSelection(winter, new Date('2026-11-10T14:59:59Z'), ['assignments'])).toBeNull();
    expect(todoReminderSelection(winter, new Date('2026-11-10T15:00:00Z'), ['assignments'])?.targetDay).toBe('2026-11-12');
  });
  it.each(['2026-10-02T18:00:00Z', '2026-10-03T08:00:00Z', '2026-10-04T08:00:00Z'])(
    'includes Monday work from Friday and throughout the weekend (%s)', (date) => {
      const monday = task('2026-10-05');
      const result = todoOverview(view(['2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06'], [monday, task('2026-10-06')]), new Date(date));
      expect(result.nextDay).toBe('2026-10-05');
      expect(result.upcoming).toEqual([monday]);
    });

  it.each([
    ['2026-11-10', ['2026-11-10', '2026-11-12'], '2026-11-12'], // Agenda skips Armistice Day.
    ['2026-10-30', ['2026-10-30', '2026-11-09'], '2026-11-09'], // Autumn break.
    ['2027-05-05', ['2027-05-05', '2027-05-10'], '2027-05-10'], // Ascension bridge.
    ['2026-10-05', ['2026-10-05', '2026-10-07'], '2026-10-07'], // School-specific free day.
    ['2026-06-30', ['2026-06-30', '2026-09-01'], '2026-09-01'], // Summer break.
  ])('follows actual agenda gaps after %s', (today, days, expected) => {
    expect(todoOverview(view(days), new Date(`${today}T08:00:00Z`)).nextDay).toBe(expected);
  });

  it('keeps next-day Bezig, excludes completed, later, hidden, cancelled and unmarked work, and separates today and earlier work', () => {
    const earlier = task('2026-10-01'); const today = task('2026-10-02'); const busy = task('2026-10-05', 'in-progress');
    const hidden = task('2026-10-05'); hidden.snapshot.hidden = true;
    const cancelled = task('2026-10-05'); cancelled.snapshot.cancelled = true;
    const result = todoOverview(view(['2026-10-05'], [busy, earlier, today, task('2026-10-05', 'done'),
      task('2026-10-06'), task('2026-10-05', 'open', 2), hidden, cancelled]), new Date('2026-10-02T18:00:00Z'));
    expect(result.upcoming).toEqual([busy]); expect(result.earlier).toEqual([earlier, today]);
  });

  it('moves Monday work out of Tuesday preparation and reminder counts without completing it', () => {
    const monday = task('2026-10-05');
    const tuesday = task('2026-10-06', 'in-progress');
    const candidate = view(['2026-10-05', '2026-10-06'], [monday, tuesday]);
    candidate.agenda!.lastSuccessAt = '2026-10-05T14:00:00.000Z';
    const now = new Date('2026-10-05T15:00:00Z');
    const overview = todoOverview(candidate, now);
    expect(overview.targetDay).toBe('2026-10-06');
    expect(overview.upcoming).toEqual([tuesday]);
    expect(overview.earlier).toEqual([monday]);
    expect(monday.status).toBe('open');
    expect(todoReminderSelection(candidate, now, ['assignments'])?.pending).toBe(1);
    candidate.entries = [monday];
    expect(todoReminderSelection(candidate, now, ['assignments'])).toBeNull();
  });

  it('does not invent a next day from empty, weekend-only or old-client responses', () => {
    const now = new Date('2026-10-02T08:00:00Z'); const today = task('2026-10-02');
    for (const candidate of [view([]), view(['2026-10-03', '2026-10-04']), { ok: true, entries: [today] }]) {
      expect(todoOverview(candidate, now).nextDay).toBeNull();
    }
    expect(todoOverview({ ok: true, entries: [today, task('2026-10-05')] }, now).upcoming).toEqual([today]);
  });

  it('uses Brussels dates around midnight, year boundaries and daylight saving', () => {
    expect(todoOverview(view(['2026-10-05', '2026-10-06']), new Date('2026-10-04T22:30:00Z')).nextDay).toBe('2026-10-06');
    expect(todoOverview(view(['2026-12-31', '2027-01-04']), new Date('2026-12-31T22:30:00Z')).today).toBe('2026-12-31');
    expect(todoOverview(view(['2026-10-26']), new Date('2026-10-25T01:30:00Z')).nextDay).toBe('2026-10-26');
  });
});

describe('agenda metadata boundary', () => {
  it('uses all categories in the latest successful response, without inferring days from retained missing or inactive points', () => {
    const baseline = compareObservations(null, check({ points: [
      point, { ...point, sourceKey: 'synthetic-old-day', snapshot: { ...point.snapshot, startsAt: '2026-10-06 09:00:00' } },
    ] }));
    const next = compareObservations(baseline, check({ checkId: 'synthetic-next', observedAt: '2026-10-03T08:00:00.000Z', points: [
      { ...point, category: 'other', snapshot: { ...point.snapshot, typePunt: 1 } },
      { ...point, sourceKey: 'synthetic-same-day', snapshot: { ...point.snapshot, typePunt: 2 } },
      { ...point, sourceKey: 'synthetic-hidden', snapshot: { ...point.snapshot, startsAt: '2026-10-07 09:00:00', hidden: true } },
      { ...point, sourceKey: 'synthetic-cancelled', snapshot: { ...point.snapshot, startsAt: '2026-10-08 09:00:00', cancelled: true } },
    ] }));
    const projected = createTasksView(next);
    expect(projected.agenda).toEqual({ days: ['2026-10-05'], lastSuccessAt: '2026-10-03T08:00:00.000Z' });
    expect(next.items.find((item) => item.sourceKey === 'synthetic-old-day')?.present).toBe(true);
    expect(validateTasksView(projected)).toEqual(projected);
    expect(JSON.stringify(projected.agenda)).not.toContain('synthetic');
    expect(createTasksView(null)).toEqual({ ok: true, entries: [] });
    const other = compareObservations(null, check({ scopeId: 'synthetic-other-profile', points: [] }));
    expect(createTasksView(other).agenda?.days).toEqual([]);
  });

  it('rejects malformed dates, unsorted/duplicate days, invalid metadata and unexpected fields', () => {
    for (const days of [['2026-02-30'], ['2026-13-01'], ['not-a-date'], [5], ['2026-10-06', '2026-10-05'], ['2026-10-05', '2026-10-05']]) {
      expect(validateTasksView({ ok: true, entries: [], agenda: { days, lastSuccessAt: '2026-10-02T08:00:00.000Z' } })).toBeNull();
    }
    for (const agenda of [null, [], { days: [] }, { days: [], lastSuccessAt: 'invalid' },
      { days: [], lastSuccessAt: '2026-10-02T08:00:00.000Z', source: 'synthetic-private-value' }]) {
      expect(validateTasksView({ ok: true, entries: [], agenda })).toBeNull();
    }
    expect(validateTasksView({ ok: true, entries: [] })).toEqual({ ok: true, entries: [] });
  });
});

describe('compact to-do display', () => {
  it('renders today only in earlier work under a next-day heading', () => {
    const monday = task('2026-10-05'); monday.snapshot.title = 'Synthetic Monday work';
    const tuesday = task('2026-10-06'); tuesday.snapshot.title = 'Synthetic Tuesday work';
    const html = renderToStaticMarkup(<TodoOverview view={view(['2026-10-05', '2026-10-06'], [monday, tuesday])}
      now={new Date('2026-10-05T15:00:00Z')} working={false} update={async () => {}} updateMany={async () => {}} />);
    const divider = html.indexOf('Eerder gepland, nog niet klaar');
    expect(html).toContain('Tegen dinsdag 6 oktober');
    expect(html).toContain('1 open of onafgewerkte taken en toetsen.');
    expect(html.indexOf('Synthetic Tuesday work')).toBeLessThan(divider);
    expect(html.indexOf('Synthetic Monday work')).toBeGreaterThan(divider);
  });
  it('shows five tasks, expandable remaining and earlier work, instructions and existing controls', () => {
    const upcoming = Array.from({ length: 7 }, () => task('2026-10-05'));
    const html = renderToStaticMarkup(<TodoOverview view={view(['2026-10-05'], [...upcoming, task('2026-10-01')])}
      now={new Date('2026-10-02T08:00:00Z')} working={false} update={async () => {}} updateMany={async () => {}} />);
    expect(html).toContain('Tegen maandag 5 oktober'); expect(html).toContain('Nog 2 taken tonen');
    expect(html).toContain('Eerder gepland, nog niet klaar (1)'); expect(html).toContain('Synthetic instructions');
    expect(html).toContain('Alles als klaar markeren');
    expect(html.indexOf('Schooldag kiezen')).toBeLessThan(html.indexOf('Eerder gepland, nog niet klaar'));
    expect(html).toContain('Volgende schooldag');
    expect(html).toContain('Geen latere schooldag bekend');
    expect(html).toContain('Bezig'); expect(html).toContain('Klaar'); expect(html).toContain('Alleen bekende taken');
  });

  it('explains unknown dates and never promises a complete or holiday-free agenda', () => {
    const html = renderToStaticMarkup(<TodoOverview view={view([])} now={new Date('2026-10-02T08:00:00Z')}
      working={false} update={async () => {}} updateMany={async () => {}} />);
    expect(html).toContain('Nog geen volgende schooldag gevonden'); expect(html).toContain('Geen open of onafgewerkte taken gevonden');
    expect(html).not.toContain('Alles als klaar markeren');
  });
});
