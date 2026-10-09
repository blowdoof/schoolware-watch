import { useEffect, useState } from 'react';
import type { LessonItem, NotificationDetails } from '../domain/notification-details';
import type { ConnectionMessage } from '../shared/connection';
import { validateNotificationDetailsView, type NotificationDetailsView } from '../shared/notification-details';
import { DEFAULT_PREFERENCES, validatePreferencesView } from '../shared/preferences';
import { displaySnapshotValue, snapshotLabels } from './agenda-presentation';
import { TaskControls } from './TaskControls';
import { useTasks } from './useTasks';
import type { TaskStatus } from '../domain/tasks';
import type { TaskEntry } from '../shared/tasks';
import { TodoOverview } from './TodoPanel';
import { useNow } from './useNow';

const categories = { tests: 'Toets', assignments: 'Taak', review: 'Nog te beoordelen', other: 'Lesinhoud / overig' };
const kinds = { unchanged: 'Ongewijzigd', observed: 'Nieuw waargenomen', changed: 'Gewijzigd',
  disappeared: 'Niet meer zichtbaar', reappeared: 'Opnieuw waargenomen' };
type Colors = Pick<typeof DEFAULT_PREFERENCES, 'newColor' | 'changedColor'>;

function Item({ item, colors, task, working = false, onStatus }: {
  item: LessonItem; colors: Colors; task?: TaskEntry; working?: boolean; onStatus?: (id: string, status: TaskStatus) => void;
}) {
  const color = item.kind === 'observed' ? colors.newColor : item.kind === 'changed' ? colors.changedColor : null;
  return (
    <li className="rounded-xl border border-slate-200 p-4"
      style={color ? { borderLeft: `5px solid ${color}`, backgroundColor: `${color}0d` } : undefined}>
      <p className="text-xs font-semibold">{kinds[item.kind]} · {categories[item.category]}</p>
      <h3 className="mt-1 font-semibold">{item.after.title || 'Zonder titel'}</h3>
      {item.kind === 'disappeared' && <p className="mt-2 text-sm text-amber-800">Niet meer zichtbaar na een volledige, vergelijkbare controle. Hieronder staat de laatst bekende inhoud; dit bewijst geen verwijdering in Schoolware.</p>}
      {item.taskReopened && <p role="status" className="mt-2 text-sm font-medium text-teal-700">Deze taak stond op Klaar en is door de wijziging weer op Bezig gezet.</p>}
      <p className="mt-2 whitespace-pre-wrap break-words text-sm">{displaySnapshotValue('instructions', item.after.instructions) || 'Geen instructies opgegeven.'}</p>
      <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-xs text-slate-600">
        <div><dt className="font-medium">Geldig vanaf (bronveld)</dt><dd>{item.after.validFrom}</dd></div>
        {item.after.recurrence && <div><dt className="font-medium">Herhaling</dt><dd>{item.after.recurrence}</dd></div>}
        {item.after.hidden && <div><dt>Verborgen</dt><dd>Ja</dd></div>}
        {item.after.cancelled && <div><dt>Vervallen</dt><dd>Ja</dd></div>}
      </dl>
      {task && onStatus && item.kind !== 'disappeared' && !item.after.hidden && !item.after.cancelled &&
        <TaskControls status={task.status} disabled={working} onChange={(status) => onStatus(task.id, status)} />}
      {item.kind === 'changed' && item.before && <div className="mt-4 border-t border-slate-200 pt-3">
        <p className="text-sm font-semibold">Wat is gewijzigd?</p>
        <dl className="mt-2 space-y-3 text-sm">
          {item.fields.map((field) => <div key={field}>
            <dt className="font-medium">{snapshotLabels[field]}</dt>
            <dd className="whitespace-pre-wrap break-words text-slate-600">Voor: {displaySnapshotValue(field, item.before![field]) || '(leeg)'}</dd>
            <dd className="whitespace-pre-wrap break-words font-medium">Na: {displaySnapshotValue(field, item.after[field]) || '(leeg)'}</dd>
          </div>)}
        </dl>
      </div>}
    </li>
  );
}

export function LessonDetails({ details, colors, tasks = [], working = false, onStatus }: {
  details: NotificationDetails; colors: Colors; tasks?: TaskEntry[]; working?: boolean; onStatus?: (id: string, status: TaskStatus) => void;
}) {
  return <div className="mt-6 space-y-6">
    {details.lessons.map((lesson, index) => <section key={index} aria-label={`Lesuur ${index + 1}`}
      className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-lg font-semibold">{lesson.subject || 'Lesuur'}</h2>
      <p className="mt-1 text-sm text-slate-600">{lesson.startsAt} – {lesson.endsAt}</p>
      {lesson.room && <p className="mt-1 text-sm text-slate-600">Lokaal: {lesson.room}</p>}
      <ol className="mt-4 space-y-3">{lesson.items.map((item, itemIndex) => {
        const task = tasks.find((entry) => entry.id === item.itemId);
        return <Item key={itemIndex} item={item} colors={colors} working={working}
          {...(task ? { task } : {})} {...(onStatus ? { onStatus } : {})} />;
      })}</ol>
    </section>)}
  </div>;
}

export function NotificationDetailsPanel({ target, refreshToken }: { target: string; refreshToken: number }) {
  const [view, setView] = useState<NotificationDetailsView | null>(null);
  const [colors, setColors] = useState<Colors>(DEFAULT_PREFERENCES);
  const [error, setError] = useState('');
  const tasks = useTasks(refreshToken, target !== 'test');
  const now = useNow();
  useEffect(() => {
    let mounted = true;
    void chrome.runtime.sendMessage({ type: 'notifications.details', target } satisfies ConnectionMessage).then((raw: unknown) => {
      const next = validateNotificationDetailsView(raw);
      if (!next?.ok) throw new Error('Details unavailable');
      if (mounted) { setView(next); setError(''); }
    }).catch(() => { if (mounted) setError('De lesdetails konden niet worden geladen. Herlaad de extensie en probeer opnieuw.'); });
    void chrome.runtime.sendMessage({ type: 'preferences.read' } satisfies ConnectionMessage).then((raw: unknown) => {
      const next = validatePreferencesView(raw);
      if (mounted && next?.ok) setColors(next.preferences);
    }).catch(() => {});
    return () => { mounted = false; };
  }, [target, refreshToken]);
  return <div>
    {view?.status === 'todo' && <>
      <TodoOverview view={tasks.view} now={now} working={tasks.working} update={tasks.update} updateMany={tasks.updateMany} updateHelp={tasks.updateHelp} />
      {tasks.error && <p role="alert" className="mt-3 text-sm text-red-700">{tasks.error}</p>}
    </>}
    {error && <p role="alert" className="mt-6 text-sm text-red-700">{error}</p>}
    {!view && !error && <p className="mt-6 text-sm">Lesdetails laden…</p>}
    {view?.status === 'missing' && <p className="mt-6 text-sm">Deze melding heeft geen bewaarde lesdetails meer. De gegevens kunnen gewist of verlopen zijn, of bij een andere agendaselectie horen. Open het overzicht voor de huidige geschiedenis.</p>}
    {view?.status === 'test' && <p role="status" className="mt-6 rounded-xl border border-teal-200 bg-teal-50 p-4 text-sm">
      Testmelding: dit zijn uitsluitend voorbeeldgegevens. Er is niets aan je agendageschiedenis toegevoegd.
    </p>}
    {view?.details && <>
      <p className="mt-4 text-sm text-slate-600">Waargenomen: {new Date(view.details.observedAt).toLocaleString('nl-BE', { timeZone: 'Europe/Brussels' })}.
        {' '}Dit toont de opgehaalde punten van de betrokken lesuren op het moment van deze melding, ook de ongewijzigde punten.</p>
      {tasks.error && <p role="alert" className="mt-3 text-sm text-red-700">{tasks.error}</p>}
      <LessonDetails details={view.details} colors={colors} tasks={tasks.view?.entries ?? []} working={tasks.working}
        onStatus={(id, status) => { void tasks.update(id, status); }} />
      {target !== 'test' && <p className="mt-3 break-all font-mono text-xs text-slate-500">Correlation-ID: {target}</p>}
      <p className="mt-4 text-xs text-slate-500">Geldig vanaf is een bronveld en geeft geen aanmaaktijdstip aan.</p>
    </>}
  </div>;
}
