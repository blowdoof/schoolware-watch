import { useEffect, useState, type FormEvent } from 'react';
import { recordPermissionResult } from './permission-log';
import { SCHOOLWARE_PERMISSION, validateAgendaRequest } from '../schoolware/agenda-request';
import { DISCOVERY_PERMISSIONS, validateDiscoveryView, type DiscoveryMessage, type DiscoveryView } from '../shared/agenda-discovery';
import { EMPTY_CONNECTION, validateConnectionState, type CheckStatus, type ConnectionMessage,
  type ConnectionState } from '../shared/connection';

const messages: Record<CheckStatus, string> = {
  success: 'De agenda is opgehaald en de response is gevalideerd.',
  'session-required': 'De sessie is niet beschikbaar. Log in bij Schoolware en probeer opnieuw.',
  redirected: 'Schoolware stuurt de request door. Controleer je login; de sessiekoppeling moet mogelijk worden aangepast.',
  'api-failure': 'Schoolware meldt dat de request niet geslaagd is.',
  'invalid-response': 'De response heeft een onverwachte vorm. Er is geen geschiedenis opgeslagen.',
  'network-error': 'Schoolware kon niet worden bereikt. Dit kan ook aan de toegang tot de browsersessie liggen.',
  timeout: 'De controle duurde te lang. Probeer later opnieuw.',
  'http-error': 'Schoolware gaf een serverfout. Probeer later opnieuw.',
  'rate-limited': 'Schoolware vraagt om minder requests. Wacht even voordat je opnieuw controleert.',
  'invalid-request': 'De agendalink is ongeldig.',
  'permission-required': 'Geef Schoolware Watch toegang tot de Schoolware-site om te controleren.',
  busy: 'Er loopt al een controle. Open dit scherm opnieuw zodra die klaar is.',
  'storage-error': 'De lokale instellingen konden niet worden gelezen of opgeslagen.',
};

async function send(message: ConnectionMessage): Promise<ConnectionState> {
  const result: unknown = await chrome.runtime.sendMessage(message);
  const state = validateConnectionState(result);
  if (!state) throw new Error('Invalid connection state');
  return state;
}

export function ConnectionPanel({ showSetup, refreshToken, onHistoryChanged }: { showSetup: boolean; refreshToken: number; onHistoryChanged?: () => void }) {
  const extensionAvailable = typeof chrome !== 'undefined' && Boolean(chrome.runtime?.id);
  const [connection, setConnection] = useState(EMPTY_CONNECTION);
  const [requestUrl, setRequestUrl] = useState('');
  const [working, setWorking] = useState(false);
  const [loading, setLoading] = useState(extensionAvailable);
  const [error, setError] = useState('');
  const [discovery, setDiscovery] = useState<DiscoveryView>({ status: 'idle', id: null });
  const [confirmedId, setConfirmedId] = useState<string | null>(null);

  useEffect(() => {
    if (!extensionAvailable) return;
    let mounted = true;
    const refresh = async () => {
      try {
        const view = validateDiscoveryView(await chrome.runtime.sendMessage({ type: 'connection.discovery.read' } satisfies DiscoveryMessage));
        if (mounted && view) setDiscovery(view);
      } catch { /* Keep the last safe status while the worker wakes. */ }
    };
    void refresh();
    const timer = ['waiting', 'found'].includes(discovery.status) ? setInterval(() => { void refresh(); }, 1000) : null;
    return () => { mounted = false; if (timer !== null) clearInterval(timer); };
  }, [extensionAvailable, discovery.status, refreshToken]);

  useEffect(() => {
    if (!extensionAvailable) return;
    let mounted = true;
    void send({ type: 'connection.read' }).then((state) => {
      if (mounted) { setConnection(state); setRequestUrl(state.requestUrl ?? ''); }
    }).catch(() => {
      if (mounted) setError('De koppeling kon niet worden geladen. Herlaad de extension.');
    }).finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, [extensionAvailable]);

  useEffect(() => {
    if (!extensionAvailable) return;
    let mounted = true;
    void send({ type: 'connection.read' }).then((state) => { if (mounted) setConnection(state); }).catch(() => {});
    return () => { mounted = false; };
  }, [extensionAvailable, refreshToken]);

  async function check(event: FormEvent, manual = false) {
    event.preventDefault();
    const url = validateAgendaRequest(manual ? requestUrl : connection.requestUrl);
    if (!url) { setError('Gebruik de volledige Request URL van de AgendaPunt-request, met de vijf agenda- en datumparameters.'); return; }
    setError('');
    setWorking(true);
    try {
      // Request host access directly in the user gesture, before other awaits.
      const granted = await chrome.permissions.request({ origins: [SCHOOLWARE_PERMISSION] });
      await recordPermissionResult('schoolware', granted);
      if (!granted) {
        setError('Er is geen toestemming gegeven voor toegang tot Schoolware.');
        return;
      }
      const state = await send({ type: 'agenda.check', requestUrl: url });
      onHistoryChanged?.();
      if (state.requestUrl) { setConnection(state); setRequestUrl(state.requestUrl); }
      else if (state.lastCheck) setError(messages[state.lastCheck.status]);
      else { setConnection(EMPTY_CONNECTION); setRequestUrl(''); }
    } catch {
      setError('De controle kon niet worden afgerond. Herlaad de extension en probeer opnieuw.');
    } finally { setWorking(false); }
  }

  async function disconnect() {
    setWorking(true);
    setError('');
    try {
      const state = await send({ type: 'connection.clear' });
      if (state.requestUrl || state.lastCheck) throw new Error('Disconnect failed');
      setConnection(state);
      setRequestUrl('');
      onHistoryChanged?.();
    } catch { setError('De koppeling kon niet worden gewist. Probeer opnieuw.'); }
    finally { setWorking(false); }
  }

  async function discover(type: 'connection.discovery.start' | 'connection.discovery.cancel') {
    setWorking(true); setError(''); setConfirmedId(null);
    try {
      if (type === 'connection.discovery.start') {
        const granted = await chrome.permissions.request(DISCOVERY_PERMISSIONS);
        await recordPermissionResult('schoolware', granted);
        if (!granted) { setError('Geef toestemming om je agenda in Schoolware te herkennen.'); return; }
      }
      const view = validateDiscoveryView(await chrome.runtime.sendMessage({ type } satisfies DiscoveryMessage));
      if (!view || view.status === 'error' || view.status === 'permission-required') throw new Error('Discovery unavailable');
      setDiscovery(view);
    } catch { setError('Schoolware kon niet worden geopend. Herlaad de extensie en probeer opnieuw.'); }
    finally { setWorking(false); }
  }
  async function confirmDiscovery() {
    if (!discovery.id || confirmedId !== discovery.id) return;
    setWorking(true); setError('');
    try {
      const state = await send({ type: 'connection.discovery.confirm', id: discovery.id });
      if (!state.requestUrl) throw new Error('Discovery changed');
      setConnection(state); setRequestUrl(state.requestUrl);
      setDiscovery({ status: 'idle', id: null });
      onHistoryChanged?.();
    } catch { setError('De agendaselectie is veranderd of de koppeling is verlopen. Open de gewenste agenda opnieuw en probeer nogmaals.'); }
    finally { setWorking(false); }
  }

  const lastCheck = connection.lastCheck;
  return (
    <section aria-label="Schoolware-koppeling" className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="font-medium">Schoolware-koppeling</h2>
      {!extensionAvailable ? (
        <p className="mt-2 text-sm leading-6 text-slate-600">Laad de gebouwde extension in Chrome om Schoolware te verbinden.</p>
      ) : loading ? (
        <p className="mt-2 text-sm text-slate-600">Koppeling laden…</p>
      ) : (
        <>
          {connection.requestUrl ? <div role="status" className="mt-3 rounded-lg bg-teal-50 p-3 text-sm leading-6 text-teal-900">
            <p className="font-semibold">Je agenda is al gekoppeld aan Schoolware Watch.</p>
            <p>Gebruik Nu controleren om de gekoppelde agenda opnieuw op te halen.</p>
          </div> : <p className="mt-2 text-sm leading-6 text-slate-600">Schoolware is nog niet verbonden. Log in bij Schoolware in deze browser om je agenda te koppelen.</p>}
          {(showSetup || !connection.requestUrl) && <div className="mt-4 space-y-3 text-sm">
            <p>{connection.requestUrl ? 'Wil je een andere agenda of leerling volgen? Klik op Andere agenda koppelen.' : 'Verbind met Schoolware, meld je aan en open de agenda van de gewenste leerling. Keer daarna terug naar dit scherm om de koppeling te bevestigen.'}</p>
            <button type="button" disabled={working} onClick={() => { void discover('connection.discovery.start'); }}
              className="rounded-lg bg-teal-700 px-4 py-2 font-medium text-white disabled:opacity-50">
              {connection.requestUrl ? 'Andere agenda koppelen' : 'Schoolware verbinden'}
            </button>
            {discovery.status === 'waiting' && <p role="status">Open de agenda in het Schoolware-tabblad dat zojuist is geopend. De herkenning blijft vijf minuten actief.</p>}
            {discovery.status === 'found' && <div className="space-y-2 rounded-lg bg-teal-50 p-3">
              <p role="status">Agenda herkend. Controleer dat in het geopende Schoolware-tabblad de juiste leerling en agenda zichtbaar zijn.</p>
              <label className="flex items-start gap-2"><input type="checkbox" checked={confirmedId === discovery.id}
                onChange={(event) => setConfirmedId(event.target.checked ? discovery.id : null)} />Dit is de agenda van de leerling die ik wil volgen.</label>
              <button type="button" disabled={working || confirmedId !== discovery.id} onClick={() => { void confirmDiscovery(); }}
                className="rounded-lg bg-teal-700 px-4 py-2 font-medium text-white disabled:opacity-50">Deze agenda koppelen</button>
            </div>}
            {['waiting', 'found'].includes(discovery.status) && <button type="button" disabled={working}
              onClick={() => { void discover('connection.discovery.cancel'); }} className="text-teal-700">Herkenning annuleren</button>}
            {discovery.status === 'expired' && <p role="status">De herkenning is verlopen. Klik opnieuw op verbinden om het nogmaals te proberen.</p>}
          </div>}
          <form onSubmit={(event) => { void check(event); }} className="mt-4">
            {showSetup && (
              <details>
                <summary className="cursor-pointer text-sm text-slate-600">Geavanceerd: agendalink handmatig instellen</summary>
                <label htmlFor="agenda-url" className="block text-sm font-medium">Agendalink</label>
                <p id="agenda-help" className="mt-1 text-xs leading-5 text-slate-500">
                  Kopieer in Schoolware bij Network → AgendaPunt → Headers alleen de Request URL.
                  De agenda- en leerlingselectie wordt overgenomen; de gecontroleerde periode schuift mee met vandaag.
                  Deze koppeling ondersteunt schoolware_siw.ksgwl.be.
                </p>
                <textarea id="agenda-url" value={requestUrl} onChange={(event) => setRequestUrl(event.target.value)}
                  aria-describedby="agenda-help" rows={4} spellCheck={false} autoComplete="off" disabled={working}
                  className="mt-2 w-full rounded-lg border border-slate-300 p-3 text-sm focus-visible:outline-2 focus-visible:outline-teal-700" />
                <button type="button" onClick={(event) => { void check(event, true); }} disabled={working} className="mt-2 rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:opacity-50">Handmatige link controleren</button>
              </details>
            )}
            {connection.requestUrl && (
              <button type="submit" disabled={working}
                className="mt-3 rounded-lg bg-teal-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
                {working ? 'Bezig…' : 'Nu controleren'}
              </button>
            )}
          </form>
          <div aria-live="polite" className="mt-4 text-sm leading-6">
            {lastCheck && (
              <>
                <p>{messages[lastCheck.status]}</p>
                {lastCheck.status === 'success' && <p>{lastCheck.count} agendapunten ontvangen.</p>}
                {lastCheck.status === 'success' && lastCheck.typeCounts && (
                  <>
                    <dl className="my-3 grid grid-cols-2 gap-x-4 gap-y-1 rounded-lg bg-slate-50 p-3">
                      <dt>Toetsen</dt><dd className="text-right font-medium">{lastCheck.typeCounts.tests}</dd>
                      <dt>Taken</dt><dd className="text-right font-medium">{lastCheck.typeCounts.assignments}</dd>
                      <dt>Nog te beoordelen</dt><dd className="text-right font-medium">{lastCheck.typeCounts.review}</dd>
                      <dt>Overige punten</dt><dd className="text-right font-medium">{lastCheck.typeCounts.other}</dd>
                    </dl>
                    <p className="text-xs leading-5 text-slate-500">
                      Bij ‘Nog te beoordelen’ staan lesbeschrijvingen die ook opdrachten kunnen bevatten.
                      Die tellen nog niet automatisch als taken. Andere taak- of toetssoorten kunnen bij ‘Overige punten’ staan.
                    </p>
                  </>
                )}
                <p className="text-xs text-slate-500">Laatste poging: {new Date(lastCheck.checkedAt).toLocaleString('nl-BE', { timeZone: 'Europe/Brussels' })}</p>
              </>
            )}
            {error && <p className="text-red-700">{error}</p>}
          </div>
          {showSetup && connection.requestUrl && (
            <button type="button" onClick={() => { void disconnect(); }} disabled={working}
              className="mt-4 rounded-sm text-sm font-medium text-teal-700 disabled:opacity-50">
              Koppeling en alle geschiedenis wissen
            </button>
          )}
        </>
      )}
      <p className="mt-4 text-xs leading-5 text-slate-500">
        Geslaagde controles bewaren lokaal een beginpunt en wijzigingen. Automatische controle kun je bij Instellingen aanpassen.
      </p>
    </section>
  );
}
