import { describe, expect, it } from 'vitest';
import { compareObservations, pruneHistory } from '../src/domain/observations';
import { createObservationInput } from '../src/schoolware/observation-input';
import { validateAgendaResponse } from '../src/schoolware/agenda-response';
import { requestUrl } from './fixtures/agenda-request';
import fixture from './fixtures/synthetic-agenda.json';
import { point, check } from './fixtures/observations';

describe('observation comparison', () => {
  it('ignores GeldigVan and formatting-only changes without reopening completed tasks or notifying', () => {
    const initial = compareObservations(null, check({ points: [{ ...point, snapshot: { ...point.snapshot, instructions: 'Line one\nLine two' } }] }));
    initial.items[0]!.taskStatus = 'done';
    const next = compareObservations(initial, check({ checkId: 'synthetic-formatting', notificationSelection: { days: 3, categories: ['assignments'] },
      points: [{ ...point, snapshot: { ...point.snapshot, validFrom: '2026-10-01 00:00:00', instructions: 'Line\u00a0one  \r\nLine two  \r\n' } }] }));
    expect(next.events).toEqual(initial.events);
    expect(next.items[0]!.taskStatus).toBe('done');
    expect(next.items[0]!.snapshot.validFrom).toBe('2026-10-01 00:00:00');
    expect(next.checks.at(-1)!.counts.changed).toBe(0);
  });
  it('accepts truthful rollback timestamps only for an explicitly serialized fresh check', () => {
    const initial = compareObservations(null, check());
    const input = check({ checkId: 'fresh-after-clock-change', observedAt: '2026-10-01T08:00:00.000Z', allowClockRollback: true,
      points: [{ ...point, snapshot: { ...point.snapshot, title: 'Synthetic new instruction' } }] });
    const next = compareObservations(initial, input);
    expect(next.lastSuccessAt).toBe(input.observedAt);
    expect(next.events.at(-1)!.kind).toBe('changed');
    expect(compareObservations(next, input)).toEqual(next);
  });
  it('reopens only completed active tasks on meaningful changes, retaining timestamps and status on metadata-only updates', () => {
    for (const status of ['open', 'in-progress', 'done'] as const) {
      const first = compareObservations(null, check());
      first.items[0]!.taskStatus = status;
      first.items[0]!.taskUpdatedAt = first.lastSuccessAt;
      const next = compareObservations(first, check({ checkId: 'changed', observedAt: '2026-10-02T09:00:00Z',
        points: [{ ...point, snapshot: { ...point.snapshot, instructions: 'Additional synthetic work' } }] }));
      expect(next.items[0]!.taskStatus).toBe(status === 'done' ? 'in-progress' : status);
      expect(next.events.at(-1)!.taskReopened).toBe(status === 'done' ? true : undefined);
      expect(next.items[0]!.taskUpdatedAt).toBe(status === 'done' ? next.lastSuccessAt : first.lastSuccessAt);
      expect(compareObservations(next, check({ checkId: 'changed' }))).toEqual(next);
      const metadata = compareObservations(first, check({ checkId: 'metadata',
        points: [{ ...point, snapshot: { ...point.snapshot, validFrom: '2026-10-01 00:00:00' } }] }));
      expect(metadata.items[0]!.taskStatus).toBe(status);
      expect(metadata.events.at(-1)!.taskReopened).toBeUndefined();
      for (const unavailable of [{ hidden: true }, { cancelled: true }]) {
        const removed = compareObservations(first, check({ checkId: 'unavailable',
          points: [{ ...point, snapshot: { ...point.snapshot, ...unavailable } }] }));
        expect(removed.items[0]!.taskStatus).toBe(status);
        expect(removed.events.at(-1)!.taskReopened).toBeUndefined();
      }
    }
  });

  it('detects missing tasks and tests only inside comparable verified coverage and never repeats a disappearance', () => {
    const coverage = { minTot: '2026-10-01', maxVan: '2026-10-07' };
    const test = { ...point, sourceKey: 'synthetic-test', category: 'tests' as const };
    const edge = { ...point, sourceKey: 'boundary', snapshot: { ...point.snapshot, startsAt: '2026-10-01 09:00:00' } };
    const first = compareObservations(null, check({ coverage, points: [point, test, edge] }));
    const input = check({ checkId: 'missing', coverage, points: [], complete: true, identityVerified: true });
    const missing = compareObservations(first, input);
    expect(missing.checks.at(-1)!.counts.disappeared).toBe(2);
    expect(missing.items.find((item) => item.sourceKey === 'boundary')!.present).toBe(true);
    expect(compareObservations(missing, input)).toEqual(missing);
    const repeated = compareObservations(missing, { ...input, checkId: 'missing-again' });
    expect(repeated.checks.at(-1)!.counts.disappeared).toBe(0);
  });

  it('treats newly covered days as baseline, while recording new points inside prior coverage as observed', () => {
    const coverage = { minTot: '2026-10-01', maxVan: '2026-10-07' };
    const first = compareObservations(null, check({ coverage }));
    const expanded = compareObservations(first, check({ checkId: 'expanded', coverage: { ...coverage, maxVan: '2026-10-15' },
      points: [point, { ...point, sourceKey: 'new-inside' }, { ...point, sourceKey: 'new-outside',
        snapshot: { ...point.snapshot, startsAt: '2026-10-08 09:00:00', endsAt: '2026-10-08 09:50:00' } }] }));
    expect(expanded.events.slice(1).map((event) => event.kind)).toEqual(['observed', 'baseline']);
    expect(expanded.checks.at(-1)?.coverage?.maxVan).toBe('2026-10-15');
    const next = compareObservations(expanded, check({ checkId: 'next', coverage: expanded.checks.at(-1)!.coverage!,
      points: [{ ...point, sourceKey: 'later-inside', snapshot: { ...point.snapshot,
        startsAt: '2026-10-08 09:00:00', endsAt: '2026-10-08 09:50:00' } }] }));
    expect(next.events.at(-1)?.kind).toBe('observed');
  });

  it('uses configured coverage for legacy checks and never infers disappearance when coverage changes', () => {
    const legacy = compareObservations(null, check());
    const coverage = { minTot: '2026-10-01', maxVan: '2026-10-07' };
    const migrated = compareObservations(legacy, check({ checkId: 'rolling', coverage, legacyCoverage: coverage,
      points: [point, { ...point, sourceKey: 'new-inside' }] }));
    expect(migrated.events.at(-1)?.kind).toBe('observed');
    const moved = compareObservations(migrated, check({ checkId: 'shifted', points: [],
      coverage: { minTot: '2026-10-02', maxVan: '2026-10-08' }, complete: true, identityVerified: true }));
    expect(moved.items.every((item) => item.present)).toBe(true);
    expect(moved.checks.at(-1)?.counts.disappeared).toBe(0);
  });

  it('creates a baseline with observation time, never GeldigVan as creation time', () => {
    const scope = compareObservations(null, check());
    expect(scope.events[0]?.kind).toBe('baseline');
    expect(scope.items[0]?.firstSeenAt).toBe('2026-10-02T08:00:00.000Z');
    expect(scope.items[0]?.snapshot.validFrom).toBe('2026-09-01 00:00:00');
    expect(scope.checks[0]?.counts.observed).toBe(0);
  });

  it('does not manufacture a baseline from a valid but unverified empty response', () => {
    const empty = compareObservations(null, check({ points: [] }));
    expect(empty.baselineAt).toBeNull();
    expect(empty.events).toEqual([]);
    const next = compareObservations(empty, check({ checkId: 'next', observedAt: '2026-10-02T09:00:00.000Z' }));
    expect(next.events[0]?.kind).toBe('baseline');
  });

  it('advances lastSeenAt without generating versions for unchanged content or retrying a check', () => {
    const first = compareObservations(null, check());
    const second = compareObservations(first, check({ checkId: 'next', observedAt: '2026-10-02T09:00:00.000Z' }));
    expect(second.items[0]?.firstSeenAt).toBe(first.items[0]?.firstSeenAt);
    expect(second.items[0]?.lastSeenAt).toBe('2026-10-02T09:00:00.000Z');
    expect(second.events).toHaveLength(1);
    expect(compareObservations(second, check({ checkId: 'next' }))).toEqual(second);
  });

  it('records first observation of a new source tuple and changed title/planning/instructions', () => {
    const first = compareObservations(null, check());
    const changed = { ...point, snapshot: { ...point.snapshot, title: 'Synthetic updated title',
      startsAt: '2026-10-06 09:00:00', instructions: 'Synthetic revised instructions' } };
    const second = compareObservations(first, check({ checkId: 'next', observedAt: '2026-10-02T09:00:00.000Z',
      points: [changed, { ...point, sourceKey: 'synthetic-source-2' }] }));
    expect(second.events.map((event) => event.kind)).toEqual(['baseline', 'changed', 'observed']);
    expect(second.events[1]?.fields).toEqual(['title', 'instructions', 'startsAt']);
    expect(second.events[1]?.before?.title).toBe('Synthetic assignment');
    expect(second.items[0]?.firstSeenAt).toBe(first.items[0]?.firstSeenAt);
  });

  it('never interprets missing items as disappeared without completeness AND verified identity', () => {
    const first = compareObservations(null, check());
    for (const flags of [{ complete: false, identityVerified: false }, { complete: true, identityVerified: false },
      { complete: false, identityVerified: true }]) {
      const next = compareObservations(first, check({ checkId: 'next', points: [], ...flags }));
      expect(next.events).toHaveLength(1);
      expect(next.items[0]?.present).toBe(true);
      expect(next.items[0]?.lastSeenAt).toBe(first.items[0]?.lastSeenAt);
    }
  });

  it('preserves first-seen time and versions on verified disappearance and reappearance', () => {
    const first = compareObservations(null, check());
    const missing = compareObservations(first, check({ checkId: 'missing', observedAt: '2026-10-02T09:00:00.000Z',
      points: [], complete: true, identityVerified: true }));
    expect(missing.events.at(-1)?.kind).toBe('disappeared');
    expect(missing.items[0]?.present).toBe(false);
    const returned = compareObservations(missing, check({ checkId: 'returned', observedAt: '2026-10-02T10:00:00.000Z' }));
    expect(returned.events.at(-1)?.kind).toBe('reappeared');
    expect(returned.items[0]?.firstSeenAt).toBe(first.items[0]?.firstSeenAt);
  });

  it('rejects duplicate source tuples, cross-scope comparison and stale observations', () => {
    const first = compareObservations(null, check());
    expect(() => compareObservations(first, check({ scopeId: 'other-profile' }))).toThrow('Scope mismatch');
    expect(() => compareObservations(null, check({ points: [point, point] }))).toThrow('Ambiguous source identity');
    expect(() => compareObservations(first, check({ checkId: 'older', observedAt: '2026-10-01T08:00:00.000Z' }))).toThrow('Stale observation');
  });

  it('prunes historical events while retaining recently observed current content', () => {
    const first = compareObservations(null, check());
    const second = compareObservations(first, check({ checkId: 'next', observedAt: '2026-10-03T08:00:00.000Z' }));
    expect(pruneHistory(second, '2026-10-03T00:00:00.000Z')?.events).toEqual([]);
    expect(pruneHistory(second, '2026-10-03T00:00:00.000Z')?.items).toHaveLength(1);
    expect(pruneHistory(first, '2026-10-03T00:00:00.000Z')).toBeNull();
  });
});

describe('Schoolware observation adapter', () => {
  it('keeps recurring source IDs separate and scope bound to the exact pupil/filter/window', () => {
    const result = validateAgendaResponse(fixture);
    if (!result.ok) throw new Error('Invalid synthetic fixture');
    const input = createObservationInput(requestUrl, result.points, 'synthetic-check', '2026-10-02T08:00:00.000Z');
    expect(input.points[0]?.sourceKey).not.toBe(input.points[1]?.sourceKey);
    expect(input.complete).toBe(false);
    expect(input.identityVerified).toBe(false);
    for (const different of [requestUrl.replace('CompletedTaskForLL=30', 'CompletedTaskForLL=40'),
      requestUrl.replace('MaxVan=2026-10-31', 'MaxVan=2026-11-30'), requestUrl.replace('AgendaID=10,10,20', 'AgendaID=20')]) {
      expect(createObservationInput(different, result.points, 'check', input.observedAt).scopeId).not.toBe(input.scopeId);
    }
    const first = compareObservations(null, input);
    const changedId = createObservationInput(requestUrl, [{ ...result.points[0]!, ID: 43000000000 }], 'next', input.observedAt);
    expect(compareObservations(first, changedId).events.at(-1)?.kind).toBe('observed');
  });
});
