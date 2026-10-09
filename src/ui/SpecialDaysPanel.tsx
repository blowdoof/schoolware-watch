import { useEffect, useState } from 'react';
import { brusselsWallTime } from '../domain/notification-window';
import { validateSpecialDay, type SpecialDay } from '../domain/special-days';
import { validateSpecialDaysView, type SpecialDaysView, type SpecialDaysMessage } from '../shared/special-days';
import { useNow } from './useNow';
import { PlanningSharingStatus } from './PlanningSharingStatus';

const kinds: Record<SpecialDay['kind'], string> = { 'home-study': 'Thuisstudie', sports: 'Sportdag', trip: 'Uitstap', other: 'Andere speciale dag' };
const dateLabel = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString('nl-BE', { timeZone: 'Europe/Brussels', weekday: 'long', day: 'numeric', month: 'long' });
const inputClass = 'mt-1 block w-full rounded-lg border border-slate-300 bg-white p-2';

export function SpecialDaysOverview({ view, now, working = false, onEdit, onSave, onDelete }: {
  view: SpecialDaysView | null; now: Date; working?: boolean; onEdit?: (entry: SpecialDay) => void;
  onSave?: (entry: SpecialDay) => void; onDelete?: (entry: SpecialDay) => void;
}) {
  const today = brusselsWallTime(now).slice(0, 10);
  const [showPast, setShowPast] = useState(false);
  const entries = view?.entries.filter((entry) => showPast || entry.day >= today) ?? [];
  return <>
    {!view ? <p className="mt-3 text-sm">Speciale dagen laden…</p> : !view.connected ? <p className="mt-3 text-sm">Koppel een agenda en voer een succesvolle controle uit om speciale dagen voor die leerling te bewaren.</p> : !entries.length ? <p className="mt-3 text-sm">Geen speciale dagen in deze selectie.</p> : null}
    <label className="mt-3 flex items-center gap-2 text-xs"><input type="checkbox" checked={showPast} onChange={(event) => setShowPast(event.target.checked)} />Ook eerdere speciale dagen tonen</label>
    <ul className="mt-3 space-y-3">{entries.map((entry) => <li key={entry.id} className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm">
      <h3 className="font-semibold">{entry.title} — {dateLabel(entry.day)}</h3>
      <p className="mt-1 text-xs">{kinds[entry.kind]} · {entry.useTimetable ? 'Gewoon lesrooster volgen' : 'Afwijkend programma'}</p>
      {entry.preparationDay && <p className={`mt-2 text-xs ${entry.preparationDay <= today && entry.day >= today ? 'font-semibold text-amber-900' : ''}`}>Voorbereiden / meenemen naar huis: {dateLabel(entry.preparationDay)}</p>}
      {entry.notes && <p className="mt-2 whitespace-pre-wrap break-words">{entry.notes}</p>}
      <ul className="mt-2 space-y-2">{entry.checklist.map((item) => <li key={item.id}>
        <label className="flex items-start gap-2"><input type="checkbox" className="mt-1" checked={item.done} disabled={working || !onSave} onChange={(event) => onSave?.({ ...entry, checklist: entry.checklist.map((point) => point.id === item.id ? { ...point, done: event.target.checked } : point) })} />
          <span className="break-words">{item.text}{item.pack && <span className="ml-2 text-xs text-slate-500">Boekentas</span>}</span>
        </label>
      </li>)}</ul>
      <div className="mt-3 flex gap-4 text-xs">
        {onEdit && <button type="button" disabled={working} onClick={() => onEdit(entry)} className="text-teal-800 underline">Bewerken</button>}
        {onDelete && <button type="button" disabled={working} onClick={() => onDelete(entry)} className="text-red-700 underline">Verwijderen</button>}
      </div>
    </li>)}</ul>
  </>;
}

export function SpecialDaysPanel({ refreshToken }: { refreshToken: number }) {
  const [view, setView] = useState<SpecialDaysView | null>(null);
  const [draft, setDraft] = useState<{ profileId: string; entry: SpecialDay } | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const now = useNow();
  const available = typeof chrome !== 'undefined' && Boolean(chrome.runtime?.id);
  async function send(message: SpecialDaysMessage) {
    const next = validateSpecialDaysView(await chrome.runtime.sendMessage(message));
    if (!next?.ok) throw new Error('Special days unavailable');
    return next;
  }
  useEffect(() => {
    if (!available) return;
    let active = true;
    void send({ type: 'specialDays.read' }).then((next) => { if (active) setView(next); })
      .catch(() => { if (active) setError('Speciale dagen konden niet worden geladen. Probeer te vernieuwen.'); });
    return () => { active = false; };
  }, [available, refreshToken, reload]);
  if (!available) return null;
  async function save(entry: SpecialDay, profileId = view?.profileId, closeDraft = false) {
    if (!profileId || !validateSpecialDay(entry)) { setError('Controleer de datum, titel, voorbereidingsdatum en checklist.'); return; }
    setWorking(true); setError('');
    try {
      setView(await send({ type: 'specialDays.save', profileId, entry }));
      if (closeDraft) setDraft(null);
    } catch { setError('Opslaan is niet gelukt. De leerling of dag kan intussen gewijzigd zijn. Vernieuw het overzicht en controleer je invoer; per datum kan één speciale dag bestaan.'); }
    finally { setWorking(false); }
  }
  async function remove(entry: SpecialDay) {
    if (!view?.profileId) return;
    setWorking(true); setError('');
    try {
      setView(await send({ type: 'specialDays.delete', profileId: view.profileId, id: entry.id, revision: entry.revision }));
      if (draft?.entry.id === entry.id) setDraft(null);
    } catch { setError('Verwijderen is niet gelukt. Vernieuw het overzicht en probeer opnieuw.'); }
    finally { setWorking(false); }
  }
  const patch = (value: Partial<SpecialDay>) => { if (draft) setDraft({ ...draft, entry: { ...draft.entry, ...value } }); };
  function create() {
    if (!view?.profileId) return;
    setError('');
    setDraft({ profileId: view.profileId, entry: { id: crypto.randomUUID(), revision: 0, day: brusselsWallTime(now).slice(0, 10),
      kind: 'home-study', title: 'Thuisstudie', notes: '', useTimetable: true, preparationDay: null, checklist: [] } });
  }
  const entry = draft?.entry;
  return <section aria-label="Speciale dagen" className="mt-6 rounded-2xl border border-amber-200 bg-white p-5 shadow-sm">
    <h2 className="text-lg font-semibold">Speciale dagen</h2>
    <PlanningSharingStatus status={view?.sharing} />
    <p className="mt-2 text-xs text-slate-600">Aanvullingen voor deze leerling. Met Voortgang delen worden speciale dagen, opmerkingen, checklistpunten en vinkjes versleuteld gedeeld met de gekoppelde computers. Kies wanneer je voorbereidt en welke punten ook in de boekentas horen. Schoolware blijft ongewijzigd.</p>
    <p className="mt-2 text-xs text-slate-600">Een herinnering volgt vanaf 16 uur op de voorbereidingsdatum, of op de speciale dag als die datum leeg is. Zet systeemmeldingen en dagelijkse to-do herinneringen aan bij Instellingen. Chrome moet draaien; hervatten op dezelfde dag kan de melding later bezorgen.</p>
    <div className="mt-3 flex gap-3 text-sm">
      <button type="button" disabled={!view?.connected || working || Boolean(draft)} onClick={create} className="rounded-lg bg-teal-700 px-3 py-2 text-white disabled:opacity-50">Speciale dag toevoegen</button>
      <button type="button" disabled={working} onClick={() => { setReload(reload + 1); setError(''); }} className="text-teal-800 underline">Vernieuwen</button>
    </div>
    {entry && <form className="mt-4 rounded-xl border border-slate-200 p-3 text-sm" onSubmit={(event) => { event.preventDefault(); void save(entry, draft.profileId, true); }}>
      <fieldset disabled={working} className="space-y-3">
        <legend className="font-semibold">{entry.revision ? 'Speciale dag bewerken' : 'Nieuwe speciale dag'}</legend>
        {draft.profileId !== view?.profileId && <p role="alert" className="text-red-700">De actieve leerling is gewijzigd. Sluit deze invoer en open de gewenste leerling.</p>}
        <label className="block">Datum<input type="date" required value={entry.day} onChange={(event) => patch({ day: event.target.value })} className={inputClass} /></label>
        <label className="block">Soort<select value={entry.kind} onChange={(event) => {
          const kind = event.target.value as SpecialDay['kind'];
          patch({ kind, useTimetable: kind === 'home-study', title: Object.values(kinds).includes(entry.title) ? kinds[kind] : entry.title });
        }} className={inputClass}>{Object.entries(kinds).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label className="block">Titel<input required maxLength={120} value={entry.title} onChange={(event) => patch({ title: event.target.value })} className={inputClass} /></label>
        <label className="block">Opmerkingen<textarea maxLength={4000} rows={3} value={entry.notes} onChange={(event) => patch({ notes: event.target.value })} className={inputClass} /></label>
        <label className="flex gap-2"><input type="checkbox" checked={entry.useTimetable} onChange={(event) => patch({ useTimetable: event.target.checked })} />Gewoon lesrooster gebruiken voor materiaal</label>
        <label className="block">Voorbereiden / meenemen naar huis op<input type="date" max={entry.day} value={entry.preparationDay ?? ''} onChange={(event) => patch({ preparationDay: event.target.value || null })} className={inputClass} /></label>
        <p className="text-xs text-slate-600">Voor thuisstudie op maandag kies je bijvoorbeeld vrijdag. Met gewoon lesrooster telt ook materiaal uit gewone lessen en afgeronde taken mee bij Mee naar huis. Voeg ontbrekende boeken of kaften zelf toe.</p>
        <ul className="space-y-3">{entry.checklist.map((item, index) => <li key={item.id} className="rounded-lg bg-slate-50 p-2">
          <label className="block">Checklistpunt {index + 1}<input required maxLength={200} value={item.text} onChange={(event) => patch({ checklist: entry.checklist.map((point) => point.id === item.id ? { ...point, text: event.target.value } : point) })} className={inputClass} /></label>
          <label className="mt-2 flex gap-2"><input type="checkbox" checked={item.pack} onChange={(event) => patch({ checklist: entry.checklist.map((point) => point.id === item.id ? { ...point, pack: event.target.checked } : point) })} />Ook tonen in boekentas</label>
          <button type="button" onClick={() => patch({ checklist: entry.checklist.filter((point) => point.id !== item.id) })} className="mt-2 text-xs text-red-700 underline">Punt verwijderen</button>
        </li>)}</ul>
        <button type="button" disabled={entry.checklist.length >= 40} onClick={() => patch({ checklist: [...entry.checklist, { id: crypto.randomUUID(), text: '', done: false, pack: false }] })} className="text-teal-800 underline">Checklistpunt toevoegen</button>
        <div className="flex gap-4"><button type="submit" disabled={draft.profileId !== view?.profileId} className="rounded-lg bg-teal-700 px-3 py-2 text-white disabled:opacity-50">Opslaan</button><button type="button" onClick={() => setDraft(null)} className="text-teal-800 underline">Annuleren</button></div>
      </fieldset>
    </form>}
    {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
    <SpecialDaysOverview view={view} now={now} working={working || Boolean(draft)} onEdit={(value) => { if (view?.profileId) setDraft({ profileId: view.profileId, entry: structuredClone(value) }); }} onSave={(value) => { void save(value); }} onDelete={(value) => { void remove(value); }} />
  </section>;
}
