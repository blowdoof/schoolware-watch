import { useState } from 'react';
import type { TaskEntry, TasksView } from '../shared/tasks';

export function TaskHelpControls({ task, view, disabled, onChange }: {
  task: TaskEntry; view: TasksView; disabled: boolean;
  onChange: (id: string, needed: boolean, recipients: string[]) => Promise<void>;
}) {
  const [choosing, setChoosing] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const members = view.helpRecipients ?? [];
  const needed = task.help?.needed ?? false;
  function choose() {
    setSelected((task.help?.recipients ?? []).filter((id) => members.some((member) => member.id === id))); setChoosing(true);
  }
  return <fieldset disabled={disabled} className="mt-2 rounded-lg border border-amber-200 p-2 text-sm">
    <legend className="sr-only">Hulp bij deze taak</legend>
    <label className="flex items-center gap-2"><input type="checkbox" checked={needed || choosing}
      onChange={(event) => {
        if (!event.target.checked) { setChoosing(false); void onChange(task.id, false, []); }
        else if (members.length) choose();
        else void onChange(task.id, true, []);
      }} />Hulp nodig</label>
    {task.helpForYou && <p role="status" className="mt-1 font-semibold text-amber-900">Hulp aan jou gevraagd</p>}
    {needed && !choosing && <>
      <p className="mt-1 text-xs text-slate-600">{task.help!.recipients.length ?
        `Gevraagd aan: ${task.help!.recipients.map((id) => members.find((member) => member.id === id)?.label ?? 'gekoppelde deelnemer').join(', ')}.` :
        'Bewaard zonder ontvanger.'}</p>
      {members.length > 0 && <button type="button" onClick={choose} className="mt-1 font-medium text-teal-800">Ontvangers wijzigen</button>}
    </>}
    {choosing && <div className="mt-2 space-y-2">
      <p className="text-xs text-slate-600">Aan wie wil je hulp vragen? Je kunt meerdere personen kiezen, of zonder ontvanger opslaan.</p>
      {members.map((member) => <label key={member.id} className="flex items-center gap-2"><input type="checkbox"
        checked={selected.includes(member.id)} onChange={(event) => setSelected(event.target.checked ? [...selected, member.id] : selected.filter((id) => id !== member.id))} />
        {member.label}</label>)}
      <button type="button" onClick={() => { setChoosing(false); void onChange(task.id, true, selected); }}
        className="mr-3 rounded-lg bg-teal-700 px-3 py-1.5 text-white">Hulpvraag opslaan</button>
      <button type="button" onClick={() => setChoosing(false)} className="text-slate-600">Annuleren</button>
    </div>}
    {view.helpMembersError && <p className="mt-1 text-xs text-amber-800">De deelnemerslijst kon niet vernieuwd worden. Eerder ontvangen namen blijven beschikbaar.</p>}
    {!members.length && needed && <p className="mt-1 text-xs text-slate-500">Geen andere gekoppelde deelnemers met een gedeelde naam bekend. Controleer de koppeling en deelnemernamen bij Instellingen.</p>}
  </fieldset>;
}
