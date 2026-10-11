import type { TaskEntry } from '../shared/tasks';
import type { TaskStatus } from './tasks';
import { agendaText } from './schoolbag';
import { isDay } from './special-days';

export interface CsvFilter { from: string; to: string; status: TaskStatus | 'all' }
export function filterCsvTasks(entries: TaskEntry[], filter: CsvFilter): TaskEntry[] {
  if ((filter.from && !isDay(filter.from)) || (filter.to && !isDay(filter.to)) ||
      (filter.from && filter.to && filter.from > filter.to) || !['all', 'open', 'in-progress', 'done'].includes(filter.status)) throw new Error('Invalid export filter');
  return entries.filter((entry) => (!filter.from || entry.snapshot.startsAt.slice(0, 10) >= filter.from) &&
    (!filter.to || entry.snapshot.startsAt.slice(0, 10) <= filter.to) && (filter.status === 'all' || entry.status === filter.status));
}
/** Quote every cell and neutralize spreadsheet formulas, including whitespace-prefixed ones. */
export function csvCell(value: string): string {
  let offset = 0;
  while (offset < value.length && (value.charCodeAt(offset) <= 32 || /\s/u.test(value[offset]!))) offset++;
  const safe = /^[=+\-@]/u.test(value.slice(offset)) || ['\t', '\r', '\n'].includes(value[0] ?? '') ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
}
export function tasksCsv(entries: TaskEntry[]): string {
  const statuses = { open: 'Open', 'in-progress': 'Bezig', done: 'Klaar' };
  const categories = { tests: 'Toets', assignments: 'Taak', review: 'Met sterretje' };
  const rows = [['Datum', 'Begin (Europe/Brussels)', 'Einde (Europe/Brussels)', 'Vak', 'Soort', 'Titel', 'Instructies', 'Status', 'Hulp nodig'],
    ...entries.map((entry) => [entry.snapshot.startsAt.slice(0, 10), entry.snapshot.startsAt, entry.snapshot.endsAt,
      agendaText(entry.subject).trim(), categories[entry.category], agendaText(entry.snapshot.title).trim(),
      agendaText(entry.snapshot.instructions).trim(), statuses[entry.status], entry.help?.needed ? 'Ja' : 'Nee'])];
  return '\uFEFF' + rows.map((row) => row.map(csvCell).join(';')).join('\r\n') + '\r\n';
}
