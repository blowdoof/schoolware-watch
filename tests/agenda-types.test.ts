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

describe('installation-specific agenda categories', () => {
  it('excludes ordinary lesson content regardless of homework-like titles', () => {
    expect(summarizeAgendaTypes(SCHOOLWARE_ORIGIN, syntheticPoints)).toEqual({
      tests: 1, assignments: 1, review: 0, other: 4,
    });
    // Both homework-like and lesson-like titles are unmarked lesson content.
    expect(classifyAgendaType(SCHOOLWARE_ORIGIN, 2)).toBe('other');
  });

  it('does not extrapolate confirmed values to other installations or unknown codes', () => {
    expect(summarizeAgendaTypes('https://other-school.example', syntheticPoints)).toEqual({
      tests: 0, assignments: 0, review: 0, other: 6,
    });
    expect(classifyAgendaType(SCHOOLWARE_ORIGIN, 100)).toBe('tests');
    expect(classifyAgendaType(SCHOOLWARE_ORIGIN, 1002)).toBe('assignments');
    expect(classifyAgendaType(SCHOOLWARE_ORIGIN, 9)).toBe('review');
    expect(classifyAgendaType(SCHOOLWARE_ORIGIN, 102)).toBe('other');
  });

  it('includes flags and stars in progress while excluding unmarked lesson information', () => {
    const types = [100, 101, 1001, 1002, 9, 1, 2, 9876];
    const scope = compareObservations(null, check({ points: types.map((typePunt) => ({
      ...point, sourceKey: `synthetic-${typePunt}`,
      category: classifyAgendaType(SCHOOLWARE_ORIGIN, typePunt),
      snapshot: { ...point.snapshot, typePunt },
    })) }));
    scope.items.forEach((item) => { item.localId = crypto.randomUUID(); });
    const view = createTasksView(scope);
    expect(view.entries.map((entry) => entry.snapshot.typePunt).sort((a, b) => a - b)).toEqual([9, 100, 101, 1001, 1002]);
    expect(types.filter(hasAgendaMarker)).toEqual([100, 101, 1001, 1002, 9]);
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
