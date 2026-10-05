import { useState } from 'react';
import { useTasks } from './useTasks';
import { TaskControls } from './TaskControls';
import { displaySnapshotValue, snapshotLabels } from './agenda-presentation';
import { hasAgendaMarker, isPastTask } from '../domain/tasks';
import { useNow } from './useNow';
import { planningWindow } from '../domain/planning';

export function TasksPanel({ refreshToken }: { refreshToken: number }) {
  const { view, working, error, update, available } = useTasks(refreshToken);
  const [hideDone, setHideDone] = useState(false);
  const [planning, setPlanning] = useState('upcoming');
  const [limit, setLimit] = useState(20);
  const [dayLimit, setDayLimit] = useState(5);
  const now = useNow();
  if (!available) return null;
  const entries = view?.entries.filter((task) => hasAgendaMarker(task.snapshot.typePunt) && (!hideDone || task.status !== 'done') &&
    (planning === 'all' || (planning === 'upcoming' ? !isPastTask(task.snapshot.endsAt, now) : isPastTask(task.snapshot.endsAt, now)))) ?? [];
  const { days, cutoffDay } = planningWindow(view?.agenda?.days ?? [], entries.map((task) => task.snapshot), now, dayLimit);
  const visibleEntries = planning === 'upcoming' ? entries.filter((task) => cutoffDay !== null && task.snapshot.startsAt.slice(0, 10) <= cutoffDay) : entries;
  return <>
    <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" aria-label="Taken, toetsen en voortgang">
    <h2 className="text-lg font-semibold">Taken, toetsen en voortgang</h2>
    <p className="mt-2 text-sm text-slate-600">Vink Bezig of Klaar aan. Uitvinken zet de taak weer open. Een gewijzigde of opnieuw verschenen voltooide taak gaat automatisch terug naar Bezig. Deze status blijft lokaal en wijzigt niets in Schoolware.</p>
    <div className="mt-4 flex flex-wrap items-center gap-4 text-sm">
      <label>Planning <select value={planning} onChange={(event) => { setPlanning(event.target.value); setLimit(20); setDayLimit(5); }} className="ml-2 rounded-lg border border-slate-300 p-2">
        <option value="upcoming">Nog gepland</option><option value="past">Eerdere taken</option><option value="all">Alle taken</option>
      </select></label>
      <label className="flex items-center gap-2"><input type="checkbox" checked={hideDone} onChange={(event) => setHideDone(event.target.checked)} />Verberg afgeronde taken</label>
    </div>
    <p className="mt-2 text-xs text-slate-500">Afgelopen taken verdwijnen uit Nog gepland. Hun status, geschiedenis en logs blijven bewaard volgens de bewaartermijn.</p>
    {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
    {!view ? <p className="mt-4 text-sm">Taken laden…</p> : <>
      <p className="mt-3 text-xs text-slate-500">{entries.length} taken in deze selectie. Alleen punten met een vlagje of sterretje.</p>
      {planning === 'upcoming' && <p className="mt-2 text-xs text-slate-500">Eerst de komende {Math.min(dayLimit, days.length)} bekende schooldagen. Lege dagen bewijzen niet dat er geen les is.</p>}
      {!entries.length && <p className="mt-3 text-sm">Geen taken in deze selectie.</p>}
      <ol className="mt-4 space-y-3">{visibleEntries.slice(0, limit).map((task) => <li key={task.id} className="rounded-xl border border-slate-200 p-4">
        <details className="group">
          <summary className="cursor-pointer rounded-lg focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-teal-700">
            <span className="text-xs text-slate-500">{task.category === 'tests' ? 'Toets - ' : task.category === 'review' ? 'Met sterretje · ' : ''}{task.subject}{task.room ? ` · ${task.room}` : ''}</span>
            <h3 className="mt-1 font-medium text-teal-800 group-hover:underline">{task.snapshot.title || 'Zonder titel'}</h3>
            <p className="mt-1 text-sm text-slate-600">{task.snapshot.startsAt} – {task.snapshot.endsAt}</p>
            <span className="mt-2 inline-block text-xs font-medium text-teal-700 group-open:hidden">Details bekijken</span>
            <span className="mt-2 hidden text-xs font-medium text-teal-700 group-open:inline-block">Details sluiten</span>
          </summary>
          <div className="mt-3 border-t border-slate-200 pt-3">
            <h4 className="text-sm font-semibold">Instructies</h4>
            <p className="mt-2 whitespace-pre-wrap break-words text-sm">{displaySnapshotValue('instructions', task.snapshot.instructions) || 'Geen instructies opgegeven.'}</p>
            <dl className="mt-4 space-y-2 text-sm">
              {(['validFrom', 'recurrence', 'typePunt', 'hidden', 'cancelled'] as const).map((field) => <div key={field}>
                <dt className="font-medium">{snapshotLabels[field]}</dt>
                <dd className="break-words text-slate-600">{displaySnapshotValue(field, task.snapshot[field]) || 'Niet opgegeven'}</dd>
              </div>)}
              <div><dt className="font-medium">Voor het eerst lokaal waargenomen</dt>
                <dd className="text-slate-600">{new Date(task.firstSeenAt).toLocaleString('nl-BE', { timeZone: 'Europe/Brussels' })}</dd></div>
              <div><dt className="font-medium">Laatst lokaal waargenomen</dt>
                <dd className="text-slate-600">{new Date(task.lastSeenAt).toLocaleString('nl-BE', { timeZone: 'Europe/Brussels' })}</dd></div>
            </dl>
            <p className="mt-3 text-xs text-slate-500">Geldig vanaf en de eerste lokale waarneming bewijzen geen aanmaaktijdstip.</p>
            <p className="mt-2 break-all font-mono text-xs text-slate-500">Lokaal item-ID: {task.id}</p>
          </div>
        </details>
        <TaskControls status={task.status} disabled={working} onChange={(status) => { void update(task.id, status); }} />
        {task.updatedAt && <p className="mt-2 text-xs text-slate-500">Status gewijzigd: {new Date(task.updatedAt).toLocaleString('nl-BE', { timeZone: 'Europe/Brussels' })}</p>}
      </li>)}</ol>
      {visibleEntries.length > limit && <button type="button" onClick={() => setLimit(limit + 20)} className="mt-4 mr-4 text-sm font-medium text-teal-700">Meer taken tonen</button>}
      {planning === 'upcoming' && days.length > dayLimit && <button type="button" onClick={() => { setDayLimit(dayLimit + 5); setLimit(limit + 20); }} className="mt-4 text-sm font-medium text-teal-700">Verder vooruit kijken (+5 schooldagen)</button>}
    </>}
  </section></>;
}
