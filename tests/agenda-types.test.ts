import { describe, expect, it, vi } from 'vitest';
import { classifyAgendaType, summarizeAgendaTypes } from '../src/schoolware/agenda-types';
import { SCHOOLWARE_ORIGIN } from '../src/schoolware/agenda-request';
import { checkAgenda } from '../src/schoolware/agenda-client';
import fixture from './fixtures/synthetic-agenda.json';
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
  it('uses the confirmed examples while leaving mixed lesson content for review', () => {
    expect(summarizeAgendaTypes(SCHOOLWARE_ORIGIN, syntheticPoints)).toEqual({
      tests: 1, assignments: 1, review: 2, other: 2,
    });
    // Both homework-like and lesson-like titles stay ambiguous for TypePunt 2.
    expect(classifyAgendaType(SCHOOLWARE_ORIGIN, 2)).toBe('review');
  });

  it('does not extrapolate confirmed values to other installations or nearby codes', () => {
    expect(summarizeAgendaTypes('https://other-school.example', syntheticPoints)).toEqual({
      tests: 0, assignments: 0, review: 0, other: 6,
    });
    expect(classifyAgendaType(SCHOOLWARE_ORIGIN, 100)).toBe('other');
    expect(classifyAgendaType(SCHOOLWARE_ORIGIN, 1002)).toBe('other');
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
    expect(result).toEqual({ status: 'success', count: 6, typeCounts: { tests: 1, assignments: 1, review: 2, other: 2 } });
    expect(JSON.stringify(result)).not.toContain('Synthetic');
    expect(result).not.toHaveProperty('points');
  });
});
