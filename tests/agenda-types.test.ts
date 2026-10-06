import { describe, expect, it, vi } from 'vitest';
import { classifyAgendaType, summarizeAgendaTypes } from '../src/schoolware/agenda-types';
import { SCHOOLWARE_ORIGIN } from '../src/schoolware/agenda-request';
import { checkAgenda } from '../src/schoolware/agenda-client';
import fixture from './fixtures/synthetic-agenda.json';
import { hasAgendaMarker } from '../src/domain/tasks';
import { createTasksView } from '../src/shared/tasks';
import { compareObservations } from '../src/domain/observations';
import { check, point } from './fixtures/observations';
import { requestUrl } from './fixtures/agenda-request';

const syntheticPoints = [
  { TypePunt: 101, Titel: 'Synthetic test' },
  { TypePunt: 1001, Titel: 'Synthetic assignment' },
  { TypePunt: 2, Titel: 'Synthetic practice exercises' },
  { TypePunt: 2, Titel: 'Synthetic lesson introduction' },
  { TypePunt: 1, Titel: 'Synthetic timetable entry' },
  { TypePunt: 9876, Titel: 'Synthetic unknown entry' },
];

describe('standard Schoolware agenda categories', () => {
  it('excludes ordinary lesson content regardless of homework-like titles', () => {
    expect(summarizeAgendaTypes(SCHOOLWARE_ORIGIN, syntheticPoints)).toEqual({
      tests: 1, assignments: 1, review: 0, other: 4,
    });
    // Both homework-like and lesson-like titles are unmarked lesson content.
    expect(classifyAgendaType(SCHOOLWARE_ORIGIN, 2)).toBe('other');
  });

  it('uses verified ranges on other validated installations while preserving unknown types', () => {
    expect(summarizeAgendaTypes('https://other-school.example', syntheticPoints)).toEqual({
      tests: 1, assignments: 1, review: 0, other: 4,
    });
    expect(classifyAgendaType(SCHOOLWARE_ORIGIN, 100)).toBe('tests');
    expect(classifyAgendaType(SCHOOLWARE_ORIGIN, 1002)).toBe('assignments');
    expect(classifyAgendaType(SCHOOLWARE_ORIGIN, 9)).toBe('review');
    expect(classifyAgendaType(SCHOOLWARE_ORIGIN, 102)).toBe('tests');
  });

  it.each([
    [99, 'other'], [100, 'tests'], [102, 'tests'], [999, 'tests'],
    [1000, 'assignments'], [1500, 'assignments'], [1999, 'assignments'],
    [2000, 'other'], [2999, 'other'], [3000, 'other'], [9, 'review'],
    [1, 'other'], [2, 'other'], [-100, 'other'], [100.5, 'other'],
    [NaN, 'other'], [Infinity, 'other'],
  ])('classifies boundary %s consistently with task eligibility', (value, expected) => {
    for (const origin of [SCHOOLWARE_ORIGIN, 'https://kohamme-ouders.durme.be', 'https://webksotr.schoolware.be']) {
      expect(classifyAgendaType(origin, value)).toBe(expected);
    }
    expect(hasAgendaMarker(value)).toBe(expected !== 'other');
  });

  it.each(['http://other-school.example', 'https://localhost', 'https://school.example:8443', 'not-a-url'])(
    'does not classify points from rejected installation %s', (origin) => {
      expect(classifyAgendaType(origin, 1001)).toBe('other');
    });

  it('includes flags and stars in progress while excluding unmarked lesson information', () => {
    const types = [100, 101, 999, 1000, 1001, 1002, 1999, 9, 1, 2, 2000, 9876];
    const scope = compareObservations(null, check({ points: types.map((typePunt) => ({
      ...point, sourceKey: `synthetic-${typePunt}`,
      category: classifyAgendaType(SCHOOLWARE_ORIGIN, typePunt),
      snapshot: { ...point.snapshot, typePunt },
    })) }));
    scope.items.forEach((item) => { item.localId = crypto.randomUUID(); });
    const view = createTasksView(scope);
    expect(view.entries.map((entry) => entry.snapshot.typePunt).sort((a, b) => a - b)).toEqual([9, 100, 101, 999, 1000, 1001, 1002, 1999]);
    expect(types.filter(hasAgendaMarker)).toEqual([100, 101, 999, 1000, 1001, 1002, 1999, 9]);
  });

  it('includes every point exactly once, including empty responses', () => {
    const counts = summarizeAgendaTypes(SCHOOLWARE_ORIGIN, syntheticPoints);
    expect(Object.values(counts).reduce((total, count) => total + count, 0)).toBe(syntheticPoints.length);
    expect(summarizeAgendaTypes(SCHOOLWARE_ORIGIN, [])).toEqual({ tests: 0, assignments: 0, review: 0, other: 0 });
  });

  it('returns only counts from the client, without source titles or identifiers', async () => {
    const data = syntheticPoints.map((point, index) => ({ ...fixture.data[0], ...point, ID: 42000000000 + index }));
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ success: true, data }));
    const result = await checkAgenda(requestUrl, { fetch: fetcher });
    expect(result).toEqual({ status: 'success', count: 6, typeCounts: { tests: 1, assignments: 1, review: 0, other: 4 } });
    expect(JSON.stringify(result)).not.toContain('Synthetic');
    expect(result).not.toHaveProperty('points');
  });
});
