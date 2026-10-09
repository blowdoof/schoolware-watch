import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { csvCell, filterCsvTasks, tasksCsv } from '../src/domain/csv';
import { createTasksView } from '../src/shared/tasks';
import { CsvExport } from '../src/ui/CsvExport';
import { compareObservations } from '../src/domain/observations';
import { check, point } from './fixtures/observations';

const entry = createTasksView(compareObservations(null, check({ points: [{ ...point, localId: crypto.randomUUID(),
  snapshot: { ...point.snapshot, startsAt: '2026-10-12 09:00:00', title: 'Synthetic "title"; accents é', instructions: '<p>Line one</p><p>Line two</p><script>secret</script>' } }] }))).entries[0]!;

describe('local task CSV export', () => {
  it('exports Excel-friendly BOM, semicolons, CRLF and quoted multiline text without markup or identifiers', () => {
    const csv = tasksCsv([entry]);
    expect(csv.startsWith('\uFEFF"Datum";')).toBe(true);
    expect(csv).toContain('"Synthetic ""title""; accents é"');
    expect(csv).toContain('"Line one\nLine two"');
    expect(csv.endsWith('\r\n')).toBe(true);
    expect(csv).not.toContain('<p>'); expect(csv).not.toContain('secret'); expect(csv).not.toContain(entry.id);
    expect(csv).toContain('Europe/Brussels'); expect(csv).toContain('"Open"');
  });
  it.each(['=HYPERLINK("synthetic")', '+1', '-1', '@SUM(1)', '  =1', '\t=1', '\rvalue', '\nvalue', '\u0000=1'])('neutralizes spreadsheet formula/control prefixes: %j', (value) => {
    expect(csvCell(value)).toBe(`"'${value.replaceAll('"', '""')}"`);
  });
  it('applies inclusive date and independent status filters across the full retained selection', () => {
    const entries = [entry, { ...entry, status: 'done' as const }, { ...entry, snapshot: { ...entry.snapshot, startsAt: '2026-10-13 09:00:00' } }];
    expect(filterCsvTasks(entries, { from: '2026-10-12', to: '2026-10-12', status: 'open' })).toEqual([entry]);
    expect(filterCsvTasks(entries, { from: '', to: '', status: 'all' })).toHaveLength(3);
    expect(() => filterCsvTasks(entries, { from: '2026-02-30', to: '', status: 'all' })).toThrow();
    expect(() => filterCsvTasks(entries, { from: '2026-10-13', to: '2026-10-12', status: 'all' })).toThrow();
    expect(renderToStaticMarkup(<CsvExport view={{ ok: true, entries }} />)).toContain('CSV downloaden (3)');
  });
});
