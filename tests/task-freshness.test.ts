import { describe, expect, it } from 'vitest';
import { compareObservations } from '../src/domain/observations';
import { createTasksView, validateTasksView } from '../src/shared/tasks';
import { todoOverview, todoReminderSelection } from '../src/domain/todo';
import { check, point } from './fixtures/observations';
import { tasksCsv } from '../src/domain/csv';

const coverage = { minTot: '2026-10-01', maxVan: '2026-10-20' };
const initial = () => compareObservations(null, check({ coverage, points: [{ ...point, localId: '11111111-1111-4111-8111-111111111111' }] }));
const missing = () => compareObservations(initial(), check({ checkId: 'next', observedAt: '2026-10-03T08:00:00Z', coverage, points: [] }));

describe('retained tasks missing from a successful response', () => {
  it('keeps history and progress while excluding an unconfirmed task from todo/reminders', () => {
    const baseline = initial(); baseline.items[0]!.taskStatus = 'in-progress';
    const scope = compareObservations(baseline, check({ checkId: 'next', observedAt: '2026-10-03T08:00:00Z', coverage, points: [] }));
    const view = createTasksView(scope);
    expect(validateTasksView(view)).toEqual(view);
    expect(view.entries[0]).toMatchObject({ missingFromLatestCheck: true, status: 'in-progress' });
    expect(tasksCsv(view.entries)).toContain('"Niet teruggevonden bij laatste controle"');
    expect(tasksCsv(view.entries)).toContain('"Bezig";"Nee";"Ja"');
    expect(scope.items[0]!.present).toBe(true);
    expect(scope.events.some((event) => event.kind === 'disappeared')).toBe(false);
    view.agenda!.days = ['2026-10-05'];
    expect(todoOverview(view, new Date('2026-10-03T17:00:00Z')).upcoming).toEqual([]);
    expect(todoReminderSelection(view, new Date('2026-10-03T17:00:00Z'), ['assignments'])).toBeNull();
  });
  it('does not flag retained tasks outside the fetched window or on uncertain boundaries', () => {
    for (const minTot of ['2026-10-05', '2026-10-06']) {
      const scope = compareObservations(initial(), check({ checkId: 'next', observedAt: '2026-10-03T08:00:00Z', coverage: { minTot, maxVan: '2026-10-20' }, points: [] }));
      expect(createTasksView(scope).entries[0]!.missingFromLatestCheck).toBeUndefined();
    }
  });
  it('does not invent absence from legacy metadata or an unsuccessful check', () => {
    const scope = initial();
    expect(createTasksView(scope).entries[0]!.missingFromLatestCheck).toBeUndefined();
    scope.checks = [];
    scope.lastSuccessAt = '2026-10-03T08:00:00Z';
    expect(createTasksView(scope).entries[0]!.missingFromLatestCheck).toBeUndefined();
  });
  it('restores a positively observed task without losing its saved completion', () => {
    const scope = missing(); scope.items[0]!.taskStatus = 'done';
    const returned = compareObservations(scope, check({ checkId: 'return', observedAt: '2026-10-04T08:00:00Z', coverage }));
    expect(createTasksView(returned).entries[0]).toMatchObject({ status: 'done' });
    expect(createTasksView(returned).entries[0]!.missingFromLatestCheck).toBeUndefined();
    expect(returned.items[0]!.localId).toBe(scope.items[0]!.localId);
  });
  it('does not revive a missing task when the next fetched window moves past it', () => {
    const scope = compareObservations(missing(), check({ checkId: 'later-window', observedAt: '2026-10-15T08:00:00Z',
      coverage: { minTot: '2026-10-08', maxVan: '2026-10-30' }, points: [] }));
    expect(createTasksView(scope).entries[0]!.missingFromLatestCheck).toBe(true);
  });
  it('rejects malformed freshness metadata at the message boundary', () => {
    const view = createTasksView(missing());
    expect(validateTasksView({ ...view, entries: [{ ...view.entries[0], missingFromLatestCheck: 'yes' }] })).toBeNull();
  });
  it.each([false, true])('does not keep a previous task date in current todo after refresh (new source tuple: %s)', (changedIdentity) => {
    const oldPoint = { ...point, localId: '11111111-1111-4111-8111-111111111111', category: 'tests' as const,
      snapshot: { ...point.snapshot, typePunt: 100, startsAt: '2026-10-14 09:00:00', endsAt: '2026-10-14 09:50:00' } };
    const baseline = compareObservations(null, check({ points: [oldPoint], coverage, observedAt: '2026-10-11T08:00:00Z' }));
    const currentPoint = { ...oldPoint, sourceKey: changedIdentity ? 'synthetic-new-tuple' : oldPoint.sourceKey,
      localId: changedIdentity ? '22222222-2222-4222-8222-222222222222' : oldPoint.localId,
      snapshot: { ...oldPoint.snapshot, startsAt: '2026-10-09 09:00:00', endsAt: '2026-10-09 09:50:00' } };
    const scope = compareObservations(baseline, check({ checkId: 'correct-date', coverage, observedAt: '2026-10-13T17:00:00Z', points: [currentPoint] }));
    const view = createTasksView(scope); view.agenda!.days = ['2026-10-14'];
    expect(todoOverview(view, new Date('2026-10-13T17:00:00Z')).upcoming).toEqual([]);
    expect(view.entries.filter((entry) => !entry.missingFromLatestCheck).map((entry) => entry.snapshot.startsAt)).toEqual(['2026-10-09 09:00:00']);
    if (changedIdentity) expect(view.entries.find((entry) => entry.snapshot.startsAt.startsWith('2026-10-14'))!.missingFromLatestCheck).toBe(true);
  });
});
