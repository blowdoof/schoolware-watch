import { useEffect, useState } from 'react';
import { validateConnectionState, type ConnectionMessage } from '../shared/connection';

/** Non-settings views need only a connection warning, never setup/status data. */
export function ConnectionNotice({ refreshToken, onSettings, navigationPending }: {
  refreshToken: number; onSettings: () => void; navigationPending: boolean;
}) {
  const available = typeof chrome !== 'undefined' && Boolean(chrome.runtime?.id);
  const [connected, setConnected] = useState<boolean | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    if (!available) return;
    let mounted = true;
    void chrome.runtime.sendMessage({ type: 'connection.read' } satisfies ConnectionMessage).then((raw: unknown) => {
      const state = validateConnectionState(raw);
      if (!state) throw new Error('Connection unavailable');
      if (mounted) { setConnected(state.requestUrl !== null); setError(false); }
    }).catch(() => { if (mounted) setError(true); });
    return () => { mounted = false; };
  }, [available, refreshToken]);

  if (!available || connected === true || (connected === null && !error)) return null;
  return <section aria-label="Agenda koppelen" className="mt-6 rounded-2xl border border-teal-200 bg-teal-50 p-5 text-sm leading-6 text-teal-900">
    <h2 className="font-semibold">{connected === false ? 'Je agenda is nog niet gekoppeld.' : 'De koppelingsstatus kon niet worden geladen.'}</h2>
    <p className="mt-1">{connected === false ? 'Koppel je Schoolware-agenda om hier je taken, toetsen en voortgang te zien.' :
      'Open de instellingen om je Schoolware-koppeling te controleren.'}</p>
    <button type="button" disabled={navigationPending} onClick={onSettings}
      className="mt-2 font-medium text-teal-700 underline underline-offset-2 disabled:opacity-50">Naar Instellingen</button>
    {connected === false && <ol className="mt-3 list-decimal space-y-1 pl-5">
      <li>Kies bij Instellingen voor <strong>Schoolware verbinden</strong>.</li>
      <li>Meld je aan in het geopende Schoolware-tabblad en open de agenda van de gewenste leerling.</li>
      <li>Keer terug naar Instellingen, controleer de leerling en bevestig met <strong>Deze agenda koppelen</strong>.</li>
    </ol>}
  </section>;
}
