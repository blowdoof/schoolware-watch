import { useEffect, useState } from 'react';
import { MAX_ACTIVITY_ENTRIES, validateActivityView, type ActivityView } from '../shared/activity';
import { isAlertId } from '../shared/browser-alerts';
import type { ConnectionMessage } from '../shared/connection';

async function send(message: ConnectionMessage): Promise<ActivityView> {
  const next = validateActivityView(await chrome.runtime.sendMessage(message) as unknown);
  if (!next?.ok) throw new Error('Activity unavailable');
  return next;
}
const phases = { started: 'Gestart', succeeded: 'Geslaagd', failed: 'Mislukt', skipped: 'Overgeslagen', info: 'Info' };

export function ActivityPanel({ refreshToken = 0 }: { refreshToken?: number }) {
  const [view, setView] = useState<ActivityView | null>(null);
  const [correlation, setCorrelation] = useState('');
  const [itemId, setItemId] = useState('');
  const [error, setError] = useState('');
  const [working, setWorking] = useState(false);
  const available = typeof chrome !== 'undefined' && Boolean(chrome.runtime?.id);
  useEffect(() => {
    if (!available || (correlation && !isAlertId(correlation)) || (itemId && !isAlertId(itemId))) return;
    let mounted = true;
    void send({ type: 'activity.read', ...(correlation ? { correlationId: correlation } : {}), ...(itemId ? { itemId } : {}) }).then((next) => { if (mounted) setView(next); })
      .catch(() => { if (mounted) setError('Het activiteitenlog kon niet worden geladen.'); });
    return () => { mounted = false; };
  }, [available, refreshToken, correlation, itemId]);
  async function act(operation: 'read' | 'export' | 'clear') {
    if (operation !== 'clear' && ((correlation && !isAlertId(correlation)) || (itemId && !isAlertId(itemId)))) {
      setError('Gebruik een volledig correlation-ID of lokaal item-ID uit het log.'); return;
    }
    setWorking(true); setError('');
    try {
      const next = await send(operation === 'clear' ? { type: 'activity.clear' } : { type: 'activity.read',
        limit: operation === 'export' ? MAX_ACTIVITY_ENTRIES : 500,
        ...(correlation ? { correlationId: correlation } : {}), ...(itemId ? { itemId } : {}) });
      if (operation === 'export') {
        const url = URL.createObjectURL(new Blob([JSON.stringify({ formatVersion: 1, exportedAt: new Date().toISOString(), ...next }, null, 2)], { type: 'application/json' }));
        const anchor = document.createElement('a'); anchor.href = url; anchor.download = `schoolware-watch-activity-${new Date().toISOString().slice(0, 10)}.json`;
        anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
        await chrome.runtime.sendMessage({ type: 'activity.exported', count: next.entries.length } satisfies ConnectionMessage);
      } else { setView(next); if (operation === 'clear') { setCorrelation(''); setItemId(''); } }
    } catch { setError('De logactie is niet gelukt. Probeer opnieuw.'); }
    finally { setWorking(false); }
  }
  if (!available) return null;
  return <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" aria-label="Activiteitenlog">
    <h2 className="text-lg font-semibold">Activiteitenlog</h2>
    <p className="mt-2 text-sm text-slate-600">Controles, automatische en handmatige voortgangssync, meldingen, klikken en taakstatussen met tijdstippen en correlation-ID’s. Alles blijft lokaal; agenda-inhoud, namen, koppelcodes, leerling-ID’s en sessiegegevens komen niet in dit log.</p>
    <p className="mt-2 text-xs text-slate-500">Het log volgt je bewaartermijn en bewaart maximaal {MAX_ACTIVITY_ENTRIES.toLocaleString('nl-BE')} regels. Een aangemaakte systeemmelding bevestigt geen zichtbare Windows-pop-up.</p>
    <div className="mt-4 space-y-3 text-sm">
      <label className="block">Correlation-ID <input value={correlation} onChange={(event) => setCorrelation(event.target.value.trim())} className="mt-1 block w-full rounded-lg border border-slate-300 p-2 font-mono text-xs" /></label>
      <label className="block">Lokaal item-ID <input value={itemId} onChange={(event) => setItemId(event.target.value.trim())} className="mt-1 block w-full rounded-lg border border-slate-300 p-2 font-mono text-xs" /></label>
      <div className="flex flex-wrap gap-3">
        <button disabled={working} type="button" onClick={() => { void act('read'); }} className="rounded-lg border border-slate-300 px-3 py-2">Vernieuwen / filteren</button>
        <button disabled={working} type="button" onClick={() => { void act('export'); }} className="rounded-lg border border-slate-300 px-3 py-2">Logs exporteren (JSON)</button>
        <button disabled={working} type="button" onClick={() => { void act('clear'); }} className="rounded-lg border border-red-200 px-3 py-2 text-red-700">Alle logs wissen</button>
      </div>
    </div>
    {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
    {view && !view.healthy && <p role="alert" className="mt-3 text-sm text-red-700">Niet alle logregels konden worden bewaard. De beschikbare loggegevens kunnen onvolledig zijn.</p>}
    {view && <p className="mt-3 text-xs text-slate-500">{view.entries.length} van {view.total} regels · {view.retentionDays} dagen. Export bevat alle bewaarde regels die aan de filters voldoen.</p>}
    <ol className="mt-4 max-h-[36rem] space-y-3 overflow-auto">{view?.entries.map((entry) => <li key={entry.sequence} className="rounded-lg border border-slate-200 p-3 text-xs">
      <p>{new Date(entry.timestamp).toLocaleString('nl-BE', { timeZone: 'Europe/Brussels' })} · #{entry.sequence} · {phases[entry.phase]}</p>
      <p className="mt-1 font-mono font-semibold">{entry.action} · {entry.context}</p>
      <button type="button" title="Gebruik dit correlation-ID als filter" onClick={() => setCorrelation(entry.correlationId)} className="mt-1 break-all text-left font-mono text-teal-700">Correlation-ID: {entry.correlationId}</button>
      {entry.itemId && <button type="button" onClick={() => setItemId(entry.itemId!)} className="mt-1 block break-all text-left font-mono text-teal-700">Item-ID: {entry.itemId}</button>}
      <details className="mt-2"><summary className="cursor-pointer">Logdetails</summary><pre className="mt-2 whitespace-pre-wrap break-all">{JSON.stringify({ timestamp: entry.timestamp, spanId: entry.spanId, ...entry.data }, null, 2)}</pre></details>
    </li>)}</ol>
  </section>;
}
