import { useEffect, useState } from 'react';
import { validateConnectionState, type ConnectionMessage, type ConnectionState } from '../shared/connection';

export function connectionHealth(state: ConnectionState): string {
  const status = state.lastCheck?.status;
  if (!state.requestUrl) return 'Je agenda is nog niet gekoppeld.';
  if (status === 'session-required' || status === 'redirected') return 'Opnieuw aanmelden bij Schoolware nodig.';
  if (status === 'permission-required') return 'Toegang tot je Schoolware-website nodig.';
  if (!status) return 'Agenda gekoppeld; nog geen controle uitgevoerd.';
  if (status === 'success') return 'Agenda gekoppeld. Laatste controle geslaagd.';
  if (status === 'busy') return 'Agendacontrole bezig.';
  return 'De laatste agendacontrole is niet geslaagd.';
}

export function ConnectionNotice({ refreshToken, onSettings, navigationPending }: {
  refreshToken: number; onSettings: () => void; navigationPending: boolean;
}) {
  const available = typeof chrome !== 'undefined' && Boolean(chrome.runtime?.id);
  const [connection, setConnection] = useState<ConnectionState | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    if (!available) return;
    let mounted = true;
    void chrome.runtime.sendMessage({ type: 'connection.read' } satisfies ConnectionMessage).then((raw: unknown) => {
      const state = validateConnectionState(raw);
      if (!state) throw new Error('Connection unavailable');
      if (mounted) { setConnection(state); setError(false); }
    }).catch(() => { if (mounted) { setConnection(null); setError(true); } });
    return () => { mounted = false; };
  }, [available, refreshToken]);

  const connected = connection?.requestUrl ? true : connection ? false : null;
  const needsLogin = ['session-required', 'redirected'].includes(connection?.lastCheck?.status ?? '');
  const lastSuccessAt = connection?.lastSuccessAt ?? (connection?.lastCheck?.status === 'success' ? connection.lastCheck.checkedAt : null);
  if (!available || (connection === null && !error)) return null;
  return <section aria-label="Koppelingsstatus" className="mt-6 rounded-2xl border border-teal-200 bg-teal-50 p-5 text-sm leading-6 text-teal-900">
    <h2 className="font-semibold">{connection ? connectionHealth(connection) : 'De koppelingsstatus kon niet worden geladen.'}</h2>
    {connected && <p className="mt-1 text-xs">Laatste geslaagde controle: {lastSuccessAt ? new Date(lastSuccessAt).toLocaleString('nl-BE', { timeZone: 'Europe/Brussels' }) : 'nog geen'}. Je ziet de laatst opgehaalde agenda.</p>}
    {needsLogin && <p className="mt-1">Open je Schoolware-website, meld je opnieuw aan en voer daarna via Instellingen een nieuwe controle uit. Je lokale geschiedenis blijft bewaard.</p>}
    {!connected && <p className="mt-1">{connected === false ? 'Koppel je Schoolware-agenda om hier je taken, toetsen en voortgang te zien.' :
      'Open de instellingen om je Schoolware-koppeling te controleren.'}</p>}
    <button type="button" disabled={navigationPending} onClick={onSettings}
      className="mt-2 font-medium text-teal-700 underline underline-offset-2 disabled:opacity-50">Naar Instellingen</button>
    {connected === false && <ol className="mt-3 list-decimal space-y-1 pl-5">
      <li>Kies bij Instellingen voor <strong>Schoolware verbinden</strong>.</li>
      <li>Meld je aan in het geopende Schoolware-tabblad en open de agenda van de gewenste leerling.</li>
      <li>Keer terug naar Instellingen, controleer de leerling en bevestig met <strong>Deze agenda koppelen</strong>.</li>
    </ol>}
  </section>;
}
