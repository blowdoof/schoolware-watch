import { useEffect, useState } from 'react';
import { useSettingsChanges } from './SettingsChanges';
import type { Category, EventKind, Snapshot } from '../domain/observations';
import { validateHistoryView, type HistoryView } from '../shared/history';
import type { ConnectionMessage } from '../shared/connection';
import { DEFAULT_PREFERENCES, validatePreferencesView } from '../shared/preferences';

const kinds: Record<EventKind, string> = { baseline: 'Beginpunt', observed: 'Voor het eerst waargenomen',
  changed: 'Gewijzigd', disappeared: 'Niet meer zichtbaar', reappeared: 'Opnieuw waargenomen' };
const categories: Record<Category | 'all', string> = { all: 'Alle punten', tests: 'Toetsen', assignments: 'Taken', review: 'Nog te beoordelen', other: 'Overige punten' };
const fields: Record<keyof Snapshot, string> = { title: 'Titel', instructions: 'Instructies', typePunt: 'Soort punt',
  startsAt: 'Van', endsAt: 'Tot', validFrom: 'Geldig vanaf', hidden: 'Verborgen', cancelled: 'Vervallen', recurrence: 'Herhaling' };
const localTime = (value: string) => new Date(value).toLocaleString('nl-BE', { timeZone: 'Europe/Brussels' });

function displayValue(field: keyof Snapshot, value: Snapshot[keyof Snapshot]): string {
  if (typeof value === 'boolean') return value ? 'Ja' : 'Nee';
  if (field !== 'instructions') return String(value);
  // Presentation only; preserve the exact source string in history. Render as
  // React text, never HTML, so source markup cannot execute or load resources.
  return String(value).replace(/<br\s*\/?\s*>|<\/p>/gi, '\n').replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&amp;/gi, '&');
}

async function send(message: ConnectionMessage): Promise<HistoryView> {
  const result: unknown = await chrome.runtime.sendMessage(message);
  const view = validateHistoryView(result);
  if (!view?.ok) throw new Error('History unavailable');
  return view;
}

export function HistoryPanel({ settings, refreshToken }: { settings: boolean; refreshToken: number }) {
  const extensionAvailable = typeof chrome !== 'undefined' && Boolean(chrome.runtime?.id);
  const [view, setView] = useState<HistoryView | null>(null);
  const [category, setCategory] = useState<Category | 'all'>('all');
  const [error, setError] = useState('');
  const [working, setWorking] = useState(false);
  const [retentionDraft, setRetentionDraft] = useState<number | null>(null);
  useSettingsChanges('privacy', settings && retentionDraft !== null && retentionDraft !== view?.retentionDays);
  const [colors, setColors] = useState({ newColor: DEFAULT_PREFERENCES.newColor, changedColor: DEFAULT_PREFERENCES.changedColor });

  useEffect(() => {
    if (!extensionAvailable) return;
    let mounted = true;
    void chrome.runtime.sendMessage({ type: 'preferences.read' } satisfies ConnectionMessage).then((result: unknown) => {
      const next = validatePreferencesView(result);
      if (mounted && next?.ok) setColors({ newColor: next.preferences.newColor, changedColor: next.preferences.changedColor });
    }).catch(() => {});
    void send({ type: 'history.read', category }).then((next) => {
      if (mounted) { setView(next); setError(''); }
    }).catch(() => { if (mounted) setError('De lokale geschiedenis kon niet worden geladen.'); });
    return () => { mounted = false; };
  }, [extensionAvailable, category, refreshToken]);

  async function act(message: ConnectionMessage) {
    setWorking(true);
    try {
      const saved = await send(message);
      if (message.type === 'history.retention') { setView(saved); setRetentionDraft(null); }
      setView(await send({ type: 'history.read', category })); setError('');
    }
    catch { setError('De geschiedenis kon niet worden bijgewerkt. Probeer opnieuw.'); }
    finally { setWorking(false); }
  }

  if (!extensionAvailable) return null;
  return (
    <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" aria-label="Lokale geschiedenis">
      <h2 className="text-lg font-semibold">{settings ? 'Bewaren en wissen' : 'Lokale geschiedenis'}</h2>

      {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
      {!view ? <p className="mt-4 text-sm">Geschiedenis laden…</p> : settings ? (
        <div className="mt-4 space-y-4 text-sm">
          <label className="block">Bewaartermijn voor oude waarnemingen
            <select value={retentionDraft ?? view.retentionDays} disabled={working} onChange={(event) => { const days = Number(event.target.value); setRetentionDraft(days); void act({ type: 'history.retention', days }); }}
              className="ml-3 rounded-lg border border-slate-300 p-2">
              {[30, 90, 180, 365].map((days) => <option key={days} value={days}>{days} dagen</option>)}
            </select>
          </label>
          <p className="text-slate-600">Oude versies worden bij laden en controleren opgeruimd. Punten die recent nog zijn waargenomen, blijven bewaard.</p>
          <button type="button" disabled={working} onClick={() => { void act({ type: 'history.clear' }); }}
            className="rounded-lg border border-red-200 px-4 py-2 font-medium text-red-700 disabled:opacity-50">
            Geschiedenis van deze selectie wissen
          </button>
          <p className="text-xs text-slate-500">De volgende controle begint opnieuw. De koppeling blijft ingesteld.</p>
        </div>
      ) : (
        <>
          {view.baselineAt ? (
            <p className="mt-4 text-sm text-slate-600">Beginpunt: {localTime(view.baselineAt)} · {view.itemCount} punten in lokale geschiedenis.</p>
          ) : <p className="mt-4 text-sm">Nog geen beginpunt. Ga naar Instellingen en klik op Nu controleren om de eerste waarneming vast te leggen.</p>}
          {view.lastCounts && <p className="mt-2 text-sm">Laatste controle: {view.lastCounts.baseline} beginpunten,
            {' '}{view.lastCounts.observed} eerste waarnemingen, {view.lastCounts.changed} wijzigingen,
            {' '}{view.lastCounts.disappeared} niet meer zichtbaar, {view.lastCounts.reappeared} opnieuw waargenomen.</p>}
          <div className="mt-4 flex items-center gap-3">
            <label htmlFor="history-category" className="text-sm">Toon</label>
            <select id="history-category" value={category} onChange={(event) => setCategory(event.target.value as Category | 'all')}
              className="rounded-lg border border-slate-300 p-2 text-sm">
              {Object.entries(categories).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </select>
            <button type="button" disabled={working} onClick={() => { void act({ type: 'history.read', category }); }}
              className="text-sm font-medium text-teal-700">Vernieuwen</button>
          </div>
          <p className="mt-2 text-xs text-slate-500">{view.entries.length} van {view.eventCount} waarnemingen in deze categorie; maximaal de 100 meest recente.</p>
          <ol className="mt-4 space-y-3">
            {view.entries.map((entry) => {
              const current = entry.after ?? entry.before;
              const color = entry.kind === 'observed' ? colors.newColor : entry.kind === 'changed' ? colors.changedColor : null;
              return (
                <li key={entry.id} className="rounded-xl border border-slate-200 p-4"
                  style={color ? { borderLeft: `5px solid ${color}`, backgroundColor: `${color}0d` } : undefined}>
                  <p className="text-xs font-medium text-teal-700">{kinds[entry.kind]} · {categories[entry.category]}</p>
                  <h3 className="mt-1 font-medium">{current?.title || 'Zonder titel'}</h3>
                  {entry.taskReopened && <p className="mt-2 text-sm font-medium text-teal-700">Door deze wijziging teruggezet van Klaar naar Bezig.</p>}
                  {entry.kind === 'disappeared' && <p className="mt-2 text-sm text-amber-800">Laatst bekende inhoud. Niet meer zichtbaar betekent niet noodzakelijk verwijderd in Schoolware.</p>}
                  {entry.after?.cancelled && <p className="mt-2 text-sm text-amber-800">Vervallen in Schoolware.</p>}
                  {entry.after?.hidden && <p className="mt-2 text-sm text-amber-800">Verborgen in Schoolware.</p>}
                  <p className="mt-1 text-xs text-slate-500">Waargenomen: {localTime(entry.observedAt)}</p>
                  <p className="mt-1 text-sm text-slate-600">Planning: {current?.startsAt} – {current?.endsAt}</p>
                  {entry.fields.length > 0 && entry.before && entry.after && (
                    <details className="mt-2 text-sm">
                      <summary className="cursor-pointer text-teal-700">Wijzigingen bekijken</summary>
                      <dl className="mt-2 space-y-3">
                        {entry.fields.map((field) => <div key={field}>
                          <dt className="font-medium">{fields[field]}</dt>
                          <dd className="whitespace-pre-wrap break-words text-slate-600">Voor: {displayValue(field, entry.before![field]) || '(leeg)'}</dd>
                          <dd className="whitespace-pre-wrap break-words">Na: {displayValue(field, entry.after![field]) || '(leeg)'}</dd>
                        </div>)}
                      </dl>
                    </details>
                  )}
                </li>
              );
            })}
          </ol>
        </>
      )}
    </section>
  );
}
