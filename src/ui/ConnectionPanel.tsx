import { useEffect, useState, type FormEvent } from 'react';
import { SCHOOLWARE_PERMISSION, validateAgendaRequest } from '../schoolware/agenda-request';
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

export function ConnectionPanel({ showSetup }: { showSetup: boolean }) {
  const extensionAvailable = typeof chrome !== 'undefined' && Boolean(chrome.runtime?.id);
  const [connection, setConnection] = useState(EMPTY_CONNECTION);
  const [requestUrl, setRequestUrl] = useState('');
  const [working, setWorking] = useState(false);
  const [loading, setLoading] = useState(extensionAvailable);
  const [error, setError] = useState('');

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

  async function check(event: FormEvent) {
    event.preventDefault();
    const url = validateAgendaRequest(showSetup ? requestUrl : connection.requestUrl);
    if (!url) { setError('Gebruik de volledige Request URL van de AgendaPunt-request, met de vijf agenda- en datumparameters.'); return; }
    setError('');
    setWorking(true);
    try {
      // Request host access directly in the user gesture, before other awaits.
      if (!await chrome.permissions.request({ origins: [SCHOOLWARE_PERMISSION] })) {
        setError('Er is geen toestemming gegeven voor toegang tot Schoolware.');
        return;
      }
      const state = await send({ type: 'agenda.check', requestUrl: url });
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
    } catch { setError('De koppeling kon niet worden gewist. Probeer opnieuw.'); }
    finally { setWorking(false); }
  }

  const lastCheck = connection.lastCheck;
  return (
    <section aria-label="Schoolware-koppeling" className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="font-medium">Handmatige agendacontrole</h2>
      {!extensionAvailable ? (
        <p className="mt-2 text-sm leading-6 text-slate-600">Laad de gebouwde extension in Chrome om Schoolware te verbinden.</p>
      ) : loading ? (
        <p className="mt-2 text-sm text-slate-600">Koppeling laden…</p>
      ) : (
        <>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            {connection.requestUrl ? 'Een agendalink is lokaal ingesteld.' : 'Schoolware is nog niet verbonden.'}
            {' '}Log eerst in bij Schoolware in deze browser.
          </p>
          <form onSubmit={(event) => { void check(event); }} className="mt-4">
            {showSetup && (
              <>
                <label htmlFor="agenda-url" className="block text-sm font-medium">Agendalink</label>
                <p id="agenda-help" className="mt-1 text-xs leading-5 text-slate-500">
                  Kopieer in Schoolware bij Network → AgendaPunt → Headers alleen de Request URL.
                  De datums in die link bepalen de gecontroleerde periode. Deze eerste koppeling ondersteunt schoolware_siw.ksgwl.be.
                </p>
                <textarea id="agenda-url" value={requestUrl} onChange={(event) => setRequestUrl(event.target.value)}
                  aria-describedby="agenda-help" rows={4} spellCheck={false} autoComplete="off" disabled={working}
                  className="mt-2 w-full rounded-lg border border-slate-300 p-3 text-sm focus-visible:outline-2 focus-visible:outline-teal-700" />
              </>
            )}
            {(showSetup || connection.requestUrl) && (
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
              Koppeling wissen en toegang intrekken
            </button>
          )}
        </>
      )}
      <p className="mt-4 text-xs leading-5 text-slate-500">
        Dit controleert alleen de verbinding. Automatische monitoring en geschiedenis zijn nog niet actief.
      </p>
    </section>
  );
}
