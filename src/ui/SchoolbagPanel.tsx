import { useEffect, useState } from 'react';
import { agendaText, packingChoiceId, schoolbagOverview, type BagMaterial, type BagPoint } from '../domain/schoolbag';
import { validateSchoolbagView, type SchoolbagView } from '../shared/schoolbag';
import type { ConnectionMessage } from '../shared/connection';
import { validatePreferencesView } from '../shared/preferences';
import { useNow } from './useNow';
import { PlanningSharingStatus } from './PlanningSharingStatus';

const dateLabel = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString('nl-BE', {
  timeZone: 'Europe/Brussels', weekday: 'long', day: 'numeric', month: 'long',
});

type PackingState = 'packed' | 'hidden' | 'open';
function PackingList({ materials, points, day, direction, choices, working, onChange }: {
  materials: BagMaterial[]; points: BagPoint[]; day: string | null; direction: 'school' | 'home';
  choices: SchoolbagView['choices']; working: boolean; onChange: ((id: string, state: PackingState) => Promise<void>) | undefined;
}) {
  const [resolved, setResolved] = useState<{ context: string; ids: Record<string, string> } | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  const evidence = JSON.stringify(materials);
  const context = JSON.stringify([day, direction, evidence]);
  const ids = resolved?.context === context ? resolved.ids : {};
  useEffect(() => {
    let active = true;
    const currentMaterials = JSON.parse(evidence) as BagMaterial[];
    if (day) void Promise.all([null, ...currentMaterials].map(async (material) =>
      [material?.key ?? 'laptop', await packingChoiceId(day, direction, material)] as const))
      .then((entries) => { if (active) setResolved({ context, ids: Object.fromEntries(entries) }); }).catch(() => {});
    return () => { active = false; };
  }, [day, direction, evidence, context]);
  const stateFor = (key: string) => choices?.find((choice) => choice.id === ids[key])?.state ?? 'open';
  const hiddenCount = [null, ...materials].filter((material) => stateFor(material?.key ?? 'laptop') === 'hidden').length;
  const controls = (key: string, label: string) => onChange && day && <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
    <label className="flex items-center gap-2"><input type="checkbox" aria-label={`${label} ingepakt`} checked={stateFor(key) === 'packed'}
      disabled={working || !ids[key]} onChange={(event) => { void onChange(ids[key]!, event.target.checked ? 'packed' : 'open'); }} />Ingepakt</label>
    <button type="button" disabled={working || !ids[key]} className="text-teal-800 underline disabled:opacity-50"
      onClick={() => { void onChange(ids[key]!, stateFor(key) === 'hidden' ? 'open' : 'hidden'); }}>{stateFor(key) === 'hidden' ? 'Terugzetten' : 'Verbergen'}</button>
  </div>;
  const covered = new Set(materials.flatMap((material) => material.sources.map((source) => source.id)));
  const unspecified = points.filter((point) => !covered.has(point.id));
  return <>
    <ul className="mt-3 space-y-3 text-sm">
      {(showHidden || stateFor('laptop') !== 'hidden') && <li className="rounded-lg bg-white p-3"><span className="font-semibold">Laptop</span><span className="ml-2 text-xs text-slate-500">Altijd meenemen</span>{controls('laptop', 'Laptop')}</li>}
      {materials.filter((material) => showHidden || stateFor(material.key) !== 'hidden').map((material) => <li key={material.key} className="rounded-lg bg-white p-3">
        <p className="font-semibold">{material.subject ? `${material.subject} · ` : ''}{material.label}</p>
        {material.pages.length > 0 && <p className="mt-1 text-sm text-teal-800">{material.pages.join(' · ')}</p>}
        {material.uncertain && <p className="mt-1 text-xs text-amber-800">De agenda noemt pagina’s, maar geen duidelijk boek of cursus.</p>}
        {controls(material.key, `${material.subject} ${material.label}`.trim())}
        <details className="mt-1">
          <summary className="cursor-pointer text-xs font-medium text-teal-800">Bekijk agendatekst ({material.sources.length})</summary>
          <ul className="mt-2 space-y-2">{material.sources.map((source, index) => <li key={`${source.id}-${index}`}>
            <p className="break-words text-xs font-medium">{source.title || 'Zonder titel'}</p>
            <p className="whitespace-pre-wrap break-words text-sm text-slate-600">{source.text}</p>
          </li>)}</ul>
        </details>
      </li>)}
    </ul>
    {hiddenCount > 0 && <button type="button" className="mt-2 text-xs font-medium text-teal-800 underline" onClick={() => setShowHidden(!showHidden)}>{showHidden ? 'Verborgen suggesties sluiten' : `Verborgen suggesties tonen (${hiddenCount})`}</button>}
    {!materials.length && <p className="mt-2 text-xs text-slate-600">{unspecified.length > 0
      ? 'Controleer de agendapunten hieronder: het benodigde materiaal kon nog niet automatisch worden bepaald.'
      : 'Controleer zelf welk extra materiaal je nodig hebt; de opgehaalde agenda geeft hierover geen uitsluitsel.'}</p>}
    {unspecified.length > 0 && <details open={materials.length === 0 ? true : undefined} className="mt-3 text-xs">
      <summary className="cursor-pointer font-medium text-amber-800">Materiaal zelf controleren ({unspecified.length} agendapunten)</summary>
      <ul className="mt-2 space-y-3">{unspecified.map((point) => <li key={point.id}>
        <p className="break-words font-medium">{point.subject ? `${point.subject} · ` : ''}{agendaText(point.title) || 'Zonder titel'}</p>
        <p className="mt-1 whitespace-pre-wrap break-words text-slate-600">{agendaText(point.instructions) || 'Geen instructies opgegeven.'}</p>
      </li>)}</ul>
    </details>}
  </>;
}

export function SchoolbagOverview({ view, now, working = false, onChange }: { view: SchoolbagView | null; now: Date; working?: boolean; onChange?: (id: string, state: PackingState) => Promise<void> }) {
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const overview = view ? schoolbagOverview(view, now, selectedDay) : null;
  return <section aria-label="Boekentas" className="mt-6 rounded-2xl border border-teal-200 bg-teal-50 p-5 shadow-sm">
    <h2 className="text-lg font-semibold">Boekentas</h2>
    <PlanningSharingStatus status={view?.sharing} />
    <p className="mt-2 text-xs leading-5 text-slate-600">Suggesties uit je agenda. Controleer welk boek bedoeld wordt en of de pagina’s op papier of digitaal nodig zijn.</p>
    <p className="mt-2 text-xs leading-5 text-slate-600">Laptop is een vaste suggestie. Ander materiaal wordt herkend in titels en instructies; bekijk de agendatekst voor de reden. Met Voortgang delen worden Ingepakt en Verbergen gedeeld per lesdag en leerling. Gewijzigde materiaalinstructies vragen een nieuwe controle. Elke computer leest zelf Schoolware in: controleer de laatste ophaal- en synchronisatietijd als lijsten verschillen.</p>
    {!overview ? <p className="mt-3 text-sm">Boekentas laden…</p> : <>
      <div className="mt-4">
        <h3 className="font-semibold">{overview.special?.kind === 'home-study' ? 'Nodig voor thuisstudie' : 'Mee naar school'}</h3>
        {overview.special && <p className="mt-2 whitespace-pre-wrap text-sm text-teal-800">{overview.special.title}{overview.special.useTimetable ? ' — gewoon lesrooster' : ' — afwijkend programma'}{overview.special.notes ? `\n${overview.special.notes}` : ''}</p>}
        {overview.days.length > 0 && <label className="mt-2 block text-sm">Lesdag
          <select value={overview.targetDay ?? ''} onChange={(event) => setSelectedDay(event.target.value)} className="mt-1 block w-full rounded-lg border border-slate-300 bg-white p-2">
            {overview.targetDay === null && <option value="">Kies een bekende lesdag</option>}
            {overview.days.map((day) => <option key={day} value={day}>{dateLabel(day)}</option>)}
          </select>
        </label>}
        <p className="mt-2 text-xs text-slate-600">{overview.targetDay ? `Voor ${dateLabel(overview.targetDay)}${overview.special?.useTimetable === false ? ' — materiaal uit je speciale checklist.' : ' — ook materiaal uit gewone lessen.'}` : 'Geen volgende lesdag bekend in de ingelezen agenda. Controleer je agenda opnieuw.'}</p>
        <PackingList materials={overview.school} points={overview.schoolPoints} day={overview.targetDay} direction="school" choices={view?.choices} working={working} onChange={onChange} />
      </div>
      <div className="mt-5 border-t border-teal-200 pt-4">
        <h3 className="font-semibold">Mee naar huis</h3>
        {overview.homePackingDay && <p className="mt-2 text-xs text-slate-600">Meenemen naar huis op {dateLabel(overview.homePackingDay)}.</p>}
        {overview.preparations.map((entry) => <p key={entry.id} className="mt-2 text-sm font-medium text-amber-800">Voorbereiden voor {entry.title} op {dateLabel(entry.day)}.{entry.kind === 'home-study' && entry.useTimetable ? ' Ook materiaal uit gewone lessen en afgeronde taken meenemen.' : ''}</p>)}
        <p className="mt-2 text-xs text-slate-600">{overview.homeDay ? `Voor nog openstaande taken en toetsen tegen ${dateLabel(overview.homeDay)}. Neem het benodigde materiaal mee naar huis.` : 'Geen latere lesdag bekend na de gekozen lesdag. Controleer je agenda opnieuw.'}</p>
        <PackingList materials={overview.homework} points={overview.homeworkPoints} day={overview.homePackingDay} direction="home" choices={view?.choices} working={working} onChange={onChange} />
        <p className="mt-2 text-xs text-slate-500">Voor gewone huiswerktaken telt Klaar niet mee. Voor thuisstudie telt het hele bekende lesrooster mee. Controleer ook materiaal dat niet in de agenda staat.</p>
      </div>
      {view?.lastSuccessAt && <p className="mt-4 text-xs text-slate-500">Gebaseerd op je agenda van {new Date(view.lastSuccessAt).toLocaleString('nl-BE', { timeZone: 'Europe/Brussels' })}. Alleen laatst opgehaalde punten; een lege dag bewijst niet dat er geen les is.</p>}
    </>}
  </section>;
}

export function SchoolbagPanel({ refreshToken }: { refreshToken: number }) {
  const [working, setWorking] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [view, setView] = useState<SchoolbagView | null>(null);
  const [error, setError] = useState('');
  const now = useNow();
  const available = typeof chrome !== 'undefined' && Boolean(chrome.runtime?.id);
  useEffect(() => {
    if (!available) return;
    let active = true;
    void (async () => {
      const preferences = validatePreferencesView(await chrome.runtime.sendMessage({ type: 'preferences.read' } satisfies ConnectionMessage));
      if (!preferences?.ok) throw new Error('Preferences unavailable');
      if (!active) return;
      setEnabled(preferences.preferences.schoolbagEnabled);
      if (!preferences.preferences.schoolbagEnabled) { setView(null); setError(''); return; }
      const raw: unknown = await chrome.runtime.sendMessage({ type: 'schoolbag.read' } satisfies ConnectionMessage);
      const next = validateSchoolbagView(raw);
      if (!next?.ok) throw new Error('Schoolbag unavailable');
      if (active) { setView(next); setError(''); }
    })().catch(() => { if (active) { setView(null); setError('De boekentas kon niet worden geladen. Probeer het overzicht opnieuw te openen.'); } });
    return () => { active = false; };
  }, [available, refreshToken]);
  if (!available || !enabled) return null;
  if (error) return <section aria-label="Boekentas" className="mt-6 rounded-2xl border border-teal-200 p-5"><h2 className="font-semibold">Boekentas</h2><p role="alert" className="mt-2 text-sm text-red-700">{error}</p></section>;
  async function update(id: string, state: PackingState) {
    setWorking(true);
    try {
      const next = validateSchoolbagView(await chrome.runtime.sendMessage({ type: 'schoolbag.update', choiceId: id, state } satisfies ConnectionMessage));
      if (!next?.ok) throw new Error('Packing choice unavailable');
      setView(next); setError('');
    } catch { setError('De boekentaskeuze kon niet worden opgeslagen. Open het overzicht opnieuw en probeer opnieuw.'); }
    finally { setWorking(false); }
  }
  return <SchoolbagOverview view={view} now={now} working={working} onChange={update} />;
}
