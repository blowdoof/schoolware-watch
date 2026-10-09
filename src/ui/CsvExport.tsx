import { useState } from 'react';
import type { TasksView } from '../shared/tasks';
import { validateTasksView } from '../shared/tasks';
import { filterCsvTasks, tasksCsv, type CsvFilter } from '../domain/csv';
import type { ConnectionMessage } from '../shared/connection';

export function CsvExport({ view }: { view: TasksView | null }) {
  const [filter, setFilter] = useState<CsvFilter>({ from: '', to: '', status: 'all' });
  const [error, setError] = useState('');
  const [working, setWorking] = useState(false);
  const [result, setResult] = useState('');
  let count = 0;
  let valid = true;
  try { count = filterCsvTasks(view?.entries ?? [], filter).length; } catch { valid = false; }
  async function download() {
    setWorking(true); setError(''); setResult('');
    try {
      const current = validateTasksView(await chrome.runtime.sendMessage({ type: 'tasks.read' } satisfies ConnectionMessage));
      if (!current?.ok) throw new Error('Tasks unavailable');
      const entries = filterCsvTasks(current.entries, filter);
      if (!entries.length) { setResult('Geen taken voor deze exportselectie.'); return; }
      const url = URL.createObjectURL(new Blob([tasksCsv(entries)], { type: 'text/csv;charset=utf-8' }));
      try {
        const anchor = document.createElement('a');
        anchor.href = url; anchor.download = 'schoolware-watch-taken.csv'; anchor.click();
        setResult(`${entries.length} taken aangeboden als download. Bewaar het bestand op een veilige plaats.`);
      } finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
    } catch { setError('CSV-export is niet gelukt. Controleer de datums en probeer opnieuw.'); }
    finally { setWorking(false); }
  }
  return <details className="mt-4 rounded-lg border border-slate-200 p-3 text-sm">
    <summary className="cursor-pointer font-medium text-teal-800">Taken exporteren (CSV)</summary>
    <p className="mt-2 text-xs text-slate-600">Export bevat lokale taken en voortgang, ook buiten de zichtbare lijst. Het bestand bevat agendatekst en kan persoonlijke informatie bevatten. Er wordt niets geüpload. Lege datumvelden nemen alle bewaarde taken mee.</p>
    <fieldset disabled={working} className="mt-3 flex flex-wrap gap-3">
      <legend className="sr-only">CSV-selectie</legend>
      <label>Vanaf <input type="date" value={filter.from} onChange={(event) => setFilter({ ...filter, from: event.target.value })} className="block rounded border p-2" /></label>
      <label>Tot en met <input type="date" value={filter.to} onChange={(event) => setFilter({ ...filter, to: event.target.value })} className="block rounded border p-2" /></label>
      <label>Status <select value={filter.status} onChange={(event) => setFilter({ ...filter, status: event.target.value as CsvFilter['status'] })} className="block rounded border p-2">
        <option value="all">Alle statussen</option><option value="open">Open</option><option value="in-progress">Bezig</option><option value="done">Klaar</option>
      </select></label>
      <button type="button" disabled={!view || !valid || count === 0} onClick={() => { void download(); }} className="self-end rounded-lg bg-teal-700 px-3 py-2 text-white disabled:opacity-50">CSV downloaden ({count})</button>
    </fieldset>
    {!valid && <p role="alert" className="mt-2 text-red-700">De einddatum moet op of na de begindatum liggen.</p>}
    {error && <p role="alert" className="mt-2 text-red-700">{error}</p>}
    {result && <p role="status" className="mt-2 text-xs">{result}</p>}
  </details>;
}
