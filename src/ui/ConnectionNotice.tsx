import { useEffect, useState, type ReactNode } from 'react';
import { validateConnectionState, type ConnectionMessage, type ConnectionState } from '../shared/connection';
import { validateSyncView, type SyncView } from '../shared/progress-sync';
import { WorkspaceSection } from './WorkspaceSection';
import { StatusIcon, type Status } from './StatusIcon';

export function summaryStatus(connection: ConnectionState | null, sync: SyncView | null, error: boolean): Status {
  if (connection?.lastCheck?.status === 'busy' || sync?.checking) return 'busy';
  if (error || sync?.enabled && (sync.error || sync.blocked || sync.membersError || sync.compatibility?.issue) ||
      connection?.lastCheck && connection.lastCheck.status !== 'success') return 'issue';
  if (sync?.enabled && (sync.pending || sync.receiving || sync.registrationPending || !sync.lastSuccessAt)) return 'unknown';
  return connection?.lastCheck?.status === 'success' ? 'ok' : 'unknown';
}

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

export function ConnectionNotice({ refreshToken, onSettings, navigationPending, compact = false, children }: {
  refreshToken: number; onSettings: () => void; navigationPending: boolean; compact?: boolean; children?: ReactNode;
}) {
  const available = typeof chrome !== 'undefined' && Boolean(chrome.runtime?.id);
  const [connection, setConnection] = useState<ConnectionState | null>(null);
  const [error, setError] = useState(false);
  const [sync, setSync] = useState<SyncView | null>(null);
  useEffect(() => {
    if (!available) return;
    let mounted = true;
    let reading = false;
    const refresh = async () => {
      if (reading) return;
      reading = true;
      try {
        const raw: unknown = await chrome.runtime.sendMessage({ type: 'status.read' } satisfies ConnectionMessage);
        if (!raw || typeof raw !== 'object' || Object.keys(raw).length !== 2) throw new Error('Invalid status');
        const snapshot = raw as Record<string, unknown>;
        const state = validateConnectionState(snapshot.connection);
        const sharing = validateSyncView(snapshot.sync);
        if (!state || !sharing?.ok) throw new Error('Connection unavailable');
        if (mounted) { setConnection(state); setSync(sharing); setError(false); }
      } catch { if (mounted) setError(true); }
      finally { reading = false; }
    };
    void refresh();
    const timer = window.setInterval(() => { if (!document.hidden) void refresh(); }, 2000);
    document.addEventListener('visibilitychange', refresh);
    return () => { mounted = false; window.clearInterval(timer); document.removeEventListener('visibilitychange', refresh); };
  }, [available, refreshToken]);

  const connected = connection?.requestUrl ? true : connection ? false : null;
  const needsLogin = ['session-required', 'redirected'].includes(connection?.lastCheck?.status ?? '');
  const lastSuccessAt = connection?.lastSuccessAt ?? (connection?.lastCheck?.status === 'success' ? connection.lastCheck.checkedAt : null);
  if (!available || (connection === null && !error)) return null;
  const notice = <section aria-label="Koppelingsstatus" className="mt-6 rounded-2xl border border-teal-200 bg-teal-50 p-5 text-sm leading-6 text-teal-900">
    {error && connection && <p role="alert" className="text-red-700">De actuele status kon niet worden geladen. Dit zijn de laatst bekende gegevens.</p>}
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
  if (!compact) return notice;
  const status = summaryStatus(connection, sync, error);
  const labels = { busy: 'Controle of synchronisatie bezig', ok: sync?.enabled ? 'Laatste controle en synchronisatie geslaagd' : 'Laatste agendacontrole geslaagd; delen staat uit', issue: 'Probleem bij controle of synchronisatie', unknown: 'Nog niet volledig bevestigd' };
  return <WorkspaceSection id="overview-status" title="Controle en synchronisatie" status={<StatusIcon status={status} label={labels[status]} />}>
    {notice}{children}
    <p className="px-5 py-3 text-xs text-slate-600" role="status">{sync?.enabled ?
      `Delen tussen toestellen: ${sync.checking ? 'synchronisatie bezig' : sync.error || sync.blocked || sync.membersError || sync.compatibility?.issue ? 'probleem — kijk bij Instellingen' : sync.receiving ? 'gedeelde wijzigingen worden nog opgehaald' : sync.pending ? `${sync.pending} wijzigingen wachten op synchronisatie` : sync.lastSuccessAt ? 'laatste synchronisatie geslaagd' : 'nog geen geslaagde synchronisatie'}.` : 'Delen tussen toestellen staat uit; wijzigingen blijven lokaal.'}</p>
  </WorkspaceSection>;
}
