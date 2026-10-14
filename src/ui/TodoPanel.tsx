import { useState } from 'react';
import type { TaskStatus } from '../domain/tasks';
import { todoOverview, todoPlanningProposal } from '../domain/todo';
import type { TaskEntry, TasksView } from '../shared/tasks';
import { TaskControls } from './TaskControls';
import { useTasks } from './useTasks';
import { useNow } from './useNow';
import { displaySnapshotValue } from './agenda-presentation';
import { TaskHelpControls } from './TaskHelpControls';
import { compatibilityMessage } from './SyncVersionStatus';
import { TaskParticipation } from './TaskParticipation';
import { agendaText } from '../domain/schoolbag';

const dateLabel = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString('nl-BE', {
  timeZone: 'Europe/Brussels', weekday: 'long', day: 'numeric', month: 'long',
});

export function TodoOverview({ view, now, working, update, updateMany, updateHelp, updateReview }: {
  view: TasksView | null; now: Date; working: boolean; update: (id: string, status: TaskStatus) => Promise<void>;
  updateMany: (ids: string[], status: TaskStatus) => Promise<void>;
  updateHelp?: (id: string, needed: boolean, recipients: string[]) => Promise<void>;
  updateReview?: (id: string, kind: 'checked' | 'corrected', done: boolean) => Promise<void>;
}) {
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const overview = view ? todoOverview(view, now, selectedDay) : null;
  const unconfirmed = overview?.unconfirmed ?? [];
  const proposal = view ? todoPlanningProposal(view, now, selectedDay) : null;
  const focusHelp = view?.entries.filter((task) => task.help?.needed && !task.missingFromLatestCheck &&
    [overview?.targetDay, overview?.dayAfter].includes(task.snapshot.startsAt.slice(0, 10))) ?? [];
  const dayIndex = overview?.targetDay ? overview.schoolDays.indexOf(overview.targetDay) : -1;
  const followingDay = overview?.schoolDays[dayIndex + 1] ?? null;
  const previousDay = dayIndex > 0 ? overview?.schoolDays[dayIndex - 1] : null;
  const dayButton = 'rounded-lg border border-teal-300 bg-white px-3 py-2 text-xs font-medium text-teal-800 hover:bg-teal-100 disabled:cursor-default disabled:opacity-50';
  function rows(tasks: TaskEntry[]) {
    return <ol className="mt-3 divide-y divide-slate-200">{tasks.map((task) => <li key={task.id} className="py-3">
      <p className="text-xs text-slate-500">{dateLabel(task.snapshot.startsAt.slice(0, 10))}{task.subject ? ` · ${task.subject}` : ''}{task.category === 'tests' ? ' · Toets' : ''}</p>
      <details className="mt-1">
        <summary className="cursor-pointer break-words font-medium text-teal-800 focus-visible:outline-2 focus-visible:outline-teal-700">{task.snapshot.title || 'Zonder titel'}</summary>
        <p className="mt-2 whitespace-pre-wrap break-words text-sm">{displaySnapshotValue('instructions', task.snapshot.instructions) || 'Geen instructies opgegeven.'}</p>
      </details>
      <TaskControls status={task.status} disabled={working} onChange={(status) => { void update(task.id, status); }} />
      {view && updateHelp && <TaskHelpControls task={task} view={view} disabled={working} onChange={updateHelp} />}
      <TaskParticipation task={task} disabled={working} onReview={updateReview} />
    </li>)}</ol>;
  }
  return <section className="mt-6 rounded-2xl border border-teal-200 bg-teal-50 p-5 shadow-sm" aria-label="To-do voor de volgende schooldag">
    <h2 className="text-lg font-semibold">To-do</h2>
    {view?.syncIssue && <p role="status" className="mt-2 text-sm text-amber-800">{compatibilityMessage(view.syncIssue)}</p>}
    {!overview ? <p className="mt-2 text-sm">Taken laden…</p> : <>
      {focusHelp.length > 0 && <div className="mt-3 rounded-xl border border-amber-300 bg-amber-50 p-3" aria-label="Hulpvragen">
        <h3 className="font-semibold text-amber-900">Hulp nodig</h3>
        <p className="mt-1 text-xs text-slate-600">Hulpvragen voor de volgende twee schooldagen. Andere hulpvragen vind je bij Agenda.</p>
        {rows(focusHelp)}
      </div>}
      <p className="mt-1 text-sm font-medium" aria-live="polite">{overview.targetDay ? `Tegen ${dateLabel(overview.targetDay)}` : 'Voor vandaag'}</p>
      <p className="mt-2 text-xs leading-5 text-slate-600">{overview.browsing ?
        'Open en Bezig voor de gekozen schooldag in je agenda.' : overview.nextDay ?
        'Open en Bezig voor de volgende bekende schooldag in je agenda. Taken van vandaag staan bij eerder gepland.' :
        'Nog geen volgende schooldag gevonden in de ingelezen agenda. Controleer je agenda opnieuw; een lege periode bewijst geen vakantie.'}</p>
      <p className="mt-2 text-sm">{overview.upcoming.length ? `${overview.upcoming.length} open of onafgewerkte taken en toetsen.` :
        'Geen open of onafgewerkte taken gevonden voor deze periode.'}</p>
      {rows(overview.upcoming.slice(0, 5))}
      {overview.upcoming.length > 5 && <details className="mt-2">
        <summary className="cursor-pointer text-sm font-medium text-teal-800">Nog {overview.upcoming.length - 5} taken tonen</summary>
        {rows(overview.upcoming.slice(5))}
      </details>}
      {overview.dayAfter && <details className="mt-3 rounded-lg border border-teal-200 bg-white p-3" aria-label="Vooruitblik">
        <summary className="cursor-pointer text-sm font-medium text-teal-800">Daarna: {dateLabel(overview.dayAfter)} ({overview.following.length} open punten)</summary>
        {overview.following.length ? rows(overview.following) : <p className="mt-2 text-sm">Geen open punten gevonden voor deze schooldag.</p>}
      </details>}
      {proposal && overview.targetDay && <div className="mt-3 rounded-lg border border-teal-200 bg-white p-3" aria-label="Planningsvoorstel">
        <h3 className="text-sm font-semibold">Voorstel voor je planning</h3>
        <p className="mt-1 text-xs text-slate-600">{overview.browsing ? 'Voor de gekozen twee schooldagen.' : 'Pak eerst de volgende schooldag aan en kijk alvast één schooldag verder.'} Dit is advies; je deadlines en vinkjes veranderen niet.</p>
        <ol className="mt-2 list-decimal space-y-2 pl-5 text-sm">{proposal.tasks.slice(0, 6).map((task) => <li key={task.id}>
          {task.help?.needed ? 'Vraag hulp bij' : task.category === 'tests' ? 'Begin of ga verder met herhalen voor' : task.category === 'review' ? 'Houd rekening met' : task.status === 'in-progress' ? 'Werk verder aan' : 'Begin met'}{' '}
          <strong>{agendaText(task.snapshot.title).trim() || 'dit agendapunt'}</strong>{task.subject ? ` (${task.subject})` : ''} — {dateLabel(task.snapshot.startsAt.slice(0, 10))}.
        </li>)}</ol>
        {proposal.tasks.length > 6 && <p className="mt-2 text-xs text-slate-600">De overige punten staan in de dagoverzichten hierboven.</p>}
        {!proposal.tasks.length && <p className="mt-2 text-sm">Geen open punten gevonden voor deze twee schooldagen. Controleer je boekentas en de online agenda.</p>}
        {proposal.preparations.map((entry) => <p key={entry.id} className="mt-2 text-sm">
          <strong>{entry.title}</strong> — {dateLabel(entry.day)}.{entry.kind === 'home-study' ? ' Thuisstudie: controleer dat de benodigde boeken en kaften thuis zijn.' : ''}
          {entry.checklist.some((item) => !item.done) ? ` Nog ${entry.checklist.filter((item) => !item.done).length} voorbereidingspunten; bekijk Speciale dagen en Boekentas.` : ' Bekijk de afspraken bij Speciale dagen.'}
        </p>)}
        <p className="mt-2 text-xs text-slate-600">Controleer bij Boekentas wat mee naar school of mee naar huis moet.</p>
        {proposal.uncertain > 0 && <p className="mt-2 text-xs text-amber-800">Controleer ook de niet teruggevonden punten voor deze dagen voordat je je planning afrondt.</p>}
      </div>}
      {overview.nextDay && <div className="mt-3 border-t border-teal-200 pt-3" aria-label="Schooldag kiezen">
        <div className="flex flex-wrap gap-2">
          {overview.browsing && <button type="button" className={dayButton} disabled={working || !previousDay}
            onClick={() => setSelectedDay(previousDay ?? null)}>Vorige schooldag</button>}
          <button type="button" className={dayButton} disabled={working || !followingDay}
            onClick={() => setSelectedDay(followingDay)}>Volgende schooldag →</button>
          {overview.browsing && <button type="button" className={dayButton} disabled={working}
            onClick={() => setSelectedDay(null)}>Terug naar eerstvolgende schooldag</button>}
        </div>
        <p className="mt-2 text-xs text-slate-600">{followingDay ? `Volgende: ${dateLabel(followingDay)}.` :
          'Geen latere schooldag bekend. Controleer je agenda opnieuw om verder te kijken.'}</p>
      </div>}
      {overview.earlier.length > 0 && <details className="mt-3 border-t border-teal-200 pt-3">
        <summary className="cursor-pointer text-sm font-medium text-teal-800">Eerder gepland, nog niet klaar ({overview.earlier.length})</summary>
        <button type="button" disabled={working}
          onClick={() => { void updateMany(overview.earlier.map((task) => task.id), 'done'); }}
          className="mt-3 rounded-lg border border-teal-300 bg-white px-3 py-2 text-sm font-medium text-teal-800 hover:bg-teal-100 disabled:cursor-wait disabled:opacity-50">
          Alles als klaar markeren
        </button>
        {rows(overview.earlier)}
      </details>}
      {unconfirmed.length > 0 && <details className="mt-3 border-t border-teal-200 pt-3">
        <summary className="cursor-pointer text-sm font-medium text-amber-800">Niet teruggevonden bij laatste controle ({unconfirmed.length})</summary>
        <p className="mt-2 text-xs text-slate-600">Deze punten ontbreken in de opgehaalde periode en tellen niet mee als actuele to-do. Dit bewijst niet dat ze verwijderd zijn. Hun voortgang en geschiedenis blijven bewaard.</p>
        {rows(unconfirmed)}
      </details>}
      {view?.agenda && <details className="mt-3 text-xs leading-5 text-slate-500">
        <summary className="cursor-pointer">Over dit overzicht</summary>
        <p className="mt-1">Gebaseerd op je lokaal ingelezen agenda van {new Date(view.agenda.lastSuccessAt).toLocaleString('nl-BE', { timeZone: 'Europe/Brussels' })}. Weekends en lege agendadagen worden overgeslagen. Een lege dag bewijst niet dat er geen les is. Alleen bekende taken; controleer Schoolware voor de volledige planning.</p>
      </details>}
    </>}
  </section>;
}

export function TodoPanel({ refreshToken }: { refreshToken: number }) {
  const { view, working, error, update, updateMany, updateHelp, updateReview, available } = useTasks(refreshToken);
  const now = useNow();
  if (!available) return null;
  return <>
    <TodoOverview view={view} now={now} working={working} update={update} updateMany={updateMany} updateHelp={updateHelp} updateReview={updateReview} />
    {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
  </>;
}
