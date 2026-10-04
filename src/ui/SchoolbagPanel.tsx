import { useEffect, useState } from 'react';
import { agendaText, schoolbagOverview, type BagMaterial, type BagPoint } from '../domain/schoolbag';
import { validateSchoolbagView, type SchoolbagView } from '../shared/schoolbag';
import type { ConnectionMessage } from '../shared/connection';
import { useNow } from './useNow';

const dateLabel = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString('nl-BE', {
  timeZone: 'Europe/Brussels', weekday: 'long', day: 'numeric', month: 'long',
});

function PackingList({ materials, points }: { materials: BagMaterial[]; points: BagPoint[] }) {
  const covered = new Set(materials.flatMap((material) => material.sources.map((source) => source.id)));
  const unspecified = points.filter((point) => !covered.has(point.id));
  return <>
    <ul className="mt-3 space-y-3 text-sm">
      <li className="rounded-lg bg-white p-3"><span className="font-semibold">Laptop</span><span className="ml-2 text-xs text-slate-500">Altijd meenemen</span></li>
      {materials.map((material) => <li key={material.key} className="rounded-lg bg-white p-3">
        <p className="font-semibold">{material.subject ? `${material.subject} · ` : ''}{material.label}</p>
        {material.pages.length > 0 && <p className="mt-1 text-sm text-teal-800">{material.pages.join(' · ')}</p>}
        {material.uncertain && <p className="mt-1 text-xs text-amber-800">De agenda noemt pagina’s, maar geen duidelijk boek of cursus.</p>}
        <details className="mt-1">
          <summary className="cursor-pointer text-xs font-medium text-teal-800">Bekijk agendatekst ({material.sources.length})</summary>
          <ul className="mt-2 space-y-2">{material.sources.map((source, index) => <li key={`${source.id}-${index}`}>
            <p className="break-words text-xs font-medium">{source.title || 'Zonder titel'}</p>
            <p className="whitespace-pre-wrap break-words text-sm text-slate-600">{source.text}</p>
          </li>)}</ul>
        </details>
      </li>)}
    </ul>
    {!materials.length && <p className="mt-2 text-xs text-slate-600">Geen materiaalverwijzingen herkend. Dat betekent niet dat je verder niets nodig hebt.</p>}
    {unspecified.length > 0 && <details className="mt-3 text-xs">
      <summary className="cursor-pointer font-medium text-amber-800">Materiaal zelf controleren ({unspecified.length} agendapunten)</summary>
      <ul className="mt-2 space-y-3">{unspecified.map((point) => <li key={point.id}>
        <p className="break-words font-medium">{point.subject ? `${point.subject} · ` : ''}{agendaText(point.title) || 'Zonder titel'}</p>
        <p className="mt-1 whitespace-pre-wrap break-words text-slate-600">{agendaText(point.instructions) || 'Geen instructies opgegeven.'}</p>
      </li>)}</ul>
    </details>}
  </>;
}

export function SchoolbagOverview({ view, now }: { view: SchoolbagView | null; now: Date }) {
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const overview = view ? schoolbagOverview(view, now, selectedDay) : null;
  return <section aria-label="Boekentas" className="mt-6 rounded-2xl border border-teal-200 bg-teal-50 p-5 shadow-sm">
    <h2 className="text-lg font-semibold">Boekentas</h2>
    <p className="mt-2 text-xs leading-5 text-slate-600">Suggesties uit je agenda. Controleer welk boek bedoeld wordt en of de pagina’s op papier of digitaal nodig zijn.</p>
    {!overview ? <p className="mt-3 text-sm">Boekentas laden…</p> : <>
      <div className="mt-4">
        <h3 className="font-semibold">Mee naar school</h3>
        {overview.days.length > 0 && <label className="mt-2 block text-sm">Lesdag
          <select value={overview.targetDay ?? ''} onChange={(event) => setSelectedDay(event.target.value)} className="mt-1 block w-full rounded-lg border border-slate-300 bg-white p-2">
            {overview.targetDay === null && <option value="">Kies een bekende lesdag</option>}
            {overview.days.map((day) => <option key={day} value={day}>{dateLabel(day)}</option>)}
          </select>
        </label>}
        <p className="mt-2 text-xs text-slate-600">{overview.targetDay ? `Voor ${dateLabel(overview.targetDay)} — ook materiaal uit gewone lessen.` : 'Geen volgende lesdag bekend in de ingelezen agenda. Controleer je agenda opnieuw.'}</p>
        <PackingList materials={overview.school} points={overview.schoolPoints} />
      </div>
      <div className="mt-5 border-t border-teal-200 pt-4">
        <h3 className="font-semibold">Mee naar huis</h3>
        <p className="mt-2 text-xs text-slate-600">{overview.homeDay ? `Voor nog openstaande taken en toetsen tegen ${dateLabel(overview.homeDay)}. Neem het benodigde materiaal mee naar huis.` : 'Geen latere lesdag bekend na de gekozen lesdag. Controleer je agenda opnieuw.'}</p>
        <PackingList materials={overview.homework} points={overview.homeworkPoints} />
        <p className="mt-2 text-xs text-slate-500">Klaar gemarkeerde taken tellen hier niet mee. Controleer ook werk voor latere dagen.</p>
      </div>
      {view?.lastSuccessAt && <p className="mt-4 text-xs text-slate-500">Gebaseerd op je agenda van {new Date(view.lastSuccessAt).toLocaleString('nl-BE', { timeZone: 'Europe/Brussels' })}. Alleen laatst opgehaalde punten; een lege dag bewijst niet dat er geen les is.</p>}
    </>}
  </section>;
}

export function SchoolbagPanel({ refreshToken }: { refreshToken: number }) {
  const [view, setView] = useState<SchoolbagView | null>(null);
  const [error, setError] = useState('');
  const now = useNow();
  const available = typeof chrome !== 'undefined' && Boolean(chrome.runtime?.id);
  useEffect(() => {
    if (!available) return;
    let active = true;
    void chrome.runtime.sendMessage({ type: 'schoolbag.read' } satisfies ConnectionMessage).then((raw: unknown) => {
      const next = validateSchoolbagView(raw);
      if (!next?.ok) throw new Error('Schoolbag unavailable');
      if (active) { setView(next); setError(''); }
    }).catch(() => { if (active) { setView(null); setError('De boekentas kon niet worden geladen. Probeer het overzicht opnieuw te openen.'); } });
    return () => { active = false; };
  }, [available, refreshToken]);
  if (!available) return null;
  if (error) return <section aria-label="Boekentas" className="mt-6 rounded-2xl border border-teal-200 p-5"><h2 className="font-semibold">Boekentas</h2><p role="alert" className="mt-2 text-sm text-red-700">{error}</p></section>;
  return <SchoolbagOverview view={view} now={now} />;
}
