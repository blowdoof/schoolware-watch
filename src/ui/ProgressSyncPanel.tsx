import { useEffect, useRef, useState } from 'react';
import { validateAgendaRequest } from '../schoolware/agenda-request';
import { validateConnectionState } from '../shared/connection';
import { hex } from '../domain/progress-sync';
import { extensionInvitation, progressInvitation } from '../shared/progress-invitation';
import { SYNC_PERMISSION, parsePairingCode, normalizeSyncLabel, validateSyncView, type SyncMessage, type SyncView } from '../shared/progress-sync';

export function ProgressSyncPanel({ refreshToken, initialMode = 'first' }: { refreshToken: number; initialMode?: 'first' | 'join' }) {
  const available = typeof chrome !== 'undefined' && Boolean(chrome.runtime?.id);
  const [compatible, setCompatible] = useState(false);
  const [view, setView] = useState<SyncView | null>(null);
  const [mode, setMode] = useState(initialMode);
  const [secret, setSecret] = useState('');
  const [pairing, setPairing] = useState('');
  const [invitation, setInvitation] = useState('');
  const [publicInvitation, setPublicInvitation] = useState('');
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [label, setLabel] = useState('');
  const labelEdited = useRef(false);
  const nameRevision = useRef(0);
  useEffect(() => {
    if (!available) return;
    let mounted = true;
    void chrome.runtime.sendMessage({ type: 'connection.read' }).then((raw: unknown) => {
      if (mounted) setCompatible(Boolean(validateAgendaRequest(validateConnectionState(raw)?.requestUrl)));
    }).catch(() => {});
    void chrome.runtime.sendMessage({ type: 'sync.read' } satisfies SyncMessage).then((raw: unknown) => {
      const next = validateSyncView(raw);
      if (mounted && next?.ok) {
        setView(next);
        if (!next.enabled) { setPairing(''); setInvitation(''); }
        if (next.enabled && !labelEdited.current) setLabel(next.displayName ?? '');
      }
    }).catch(() => {});
    return () => { mounted = false; };
  }, [available, refreshToken]);
  async function send(request: SyncMessage) {
    const next = validateSyncView(await chrome.runtime.sendMessage(request) as unknown);
    if (!next?.ok) throw new Error('Sync unavailable');
    setView(next); return next;
  }
  async function connect() {
    if (!compatible) { setMessage('Koppel eerst een ondersteunde Schoolware-agenda en voer een geslaagde controle uit.'); return; }
    setWorking(true); setMessage('');
    try {
      // Request optional host access directly from the user's click.
      if (!await chrome.permissions.request({ origins: [SYNC_PERMISSION] })) { setMessage('Geen toestemming voor de synchronisatieserver.'); return; }
      const code = mode === 'first' ? `sw1.${hex(crypto.getRandomValues(new Uint8Array(32)))}.${hex(crypto.getRandomValues(new Uint8Array(32)))}` : secret.trim();
      if (!parsePairingCode(code)) throw new Error('Invalid pairing');
      const name = normalizeSyncLabel(label);
      if (label.trim() && !name) throw new Error('Invalid name');
      const next = await send(mode === 'first' ? { type: 'sync.create', code, ...(name ? { label: name } : {}) } : { type: 'sync.connect', code, seed: false, ...(name ? { label: name } : {}) });
      setSecret('');
      if (mode === 'first') setPairing(code);
      setMessage(next.blocked ? 'De instelling is lokaal bewaard, maar de server weigert de koppeling. Bewaar je koppelcode en controleer de toegang. Automatische pogingen zijn gestopt; Nu synchroniseren probeert opnieuw.' :
        next.error ? 'De instelling is lokaal bewaard, maar de serververbinding is nog niet gelukt. Bewaar je koppelcode; Chrome probeert het automatisch opnieuw. Nieuwe groepen kunnen tijdelijk beperkt zijn.' : 'Voortgang synchroniseren is ingeschakeld.');
    } catch { setMessage('Koppelen is niet gelukt. Voer eerst een geslaagde agendacontrole uit en controleer de koppelcode.'); }
    finally { setWorking(false); }
  }
  async function act(type: 'sync.run' | 'sync.disconnect' | 'sync.delete') {
    setWorking(true); setMessage('');
    try {
      const next = await send({ type });
      if (type !== 'sync.run') { setPairing(''); setInvitation(''); setConfirmDelete(false); setLabel(''); labelEdited.current = false; }
      setMessage(next.error ? 'Synchronisatie is niet gelukt. Je lokale voortgang blijft bewaard.' :
        type === 'sync.run' ? 'Synchronisatie uitgevoerd.' : type === 'sync.delete' ? 'Gedeelde voortgang en deelnemermeldingen gewist; deze computer is ontkoppeld. Groepstoegang en revisieteller blijven op de server.' : 'Deze computer is ontkoppeld; lokale voortgang blijft bewaard.');
    } catch { setMessage('De actie is niet gelukt. Controleer de serververbinding.'); }
    finally { setWorking(false); }
  }
  async function showPairing() {
    setWorking(true); setMessage('');
    try {
      const next = await send({ type: 'sync.pairing' });
      if (next.pairingCode) setPairing(next.pairingCode);
    } catch { setMessage('De koppelcode kon niet worden opgehaald.'); }
    finally { setWorking(false); }
  }
  async function copyInvitation() {
    setWorking(true); setMessage(''); setPublicInvitation('');
    try {
      const next = await send({ type: 'sync.pairing' });
      if (!next.pairingCode) throw new Error('Not paired');
      const text = progressInvitation(next.pairingCode);
      setInvitation(text);
      try {
        await navigator.clipboard.writeText(text);
        setMessage('Uitnodiging gekopieerd. Plak het bericht in je e-mail of chat en stuur het alleen naar iemand die dezelfde leerling volgt.');
      } catch { setMessage('Automatisch kopiëren is niet gelukt. Selecteer en kopieer hieronder het uitnodigingsbericht.'); }
    } catch { setMessage('De uitnodiging kon niet worden gemaakt. Controleer of deze computer nog gekoppeld is.'); }
    finally { setWorking(false); }
  }
  async function shareExtension() {
    setWorking(true); setMessage(''); setInvitation(''); setPairing('');
    const text = extensionInvitation();
    setPublicInvitation(text);
    try {
      await navigator.clipboard.writeText(text);
      setMessage('Installatiebericht gekopieerd. Je kunt het vrij delen; het bevat alleen de installatielink en geen koppelcode.');
    } catch { setMessage('Automatisch kopiëren is niet gelukt. Kopieer hieronder het openbare installatiebericht.'); }
    finally { setWorking(false); }
  }
  async function saveName(value: string) {
    setLabel(value);
    labelEdited.current = true;
    const current = ++nameRevision.current;
    const name = normalizeSyncLabel(value);
    if (!name) { setMessage('Vul een geldige naam of rol in. Je eerder opgeslagen naam blijft bewaard.'); return; }
    setMessage('Naam wordt opgeslagen…');
    try {
      const next = await send({ type: 'sync.name', label: name });
      if (nameRevision.current === current) setMessage(next.enabled ?
        'Je naam is automatisch opgeslagen en wordt bij de volgende synchronisatie gedeeld.' : 'Deze computer is niet meer gekoppeld.');
    } catch { if (nameRevision.current === current) setMessage('Je naam kon niet worden opgeslagen. Probeer opnieuw.'); }
  }
  if (!available) return null;
  return <section aria-label="Voortgang synchroniseren" className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
    <h2 className="font-semibold">Voortgang delen tussen computers</h2>
    <div className="mt-4 grid gap-3 sm:grid-cols-2">
      <div className="rounded-lg border border-slate-200 p-3 text-sm">
        <button type="button" disabled={working} onClick={() => { void shareExtension(); }} className="rounded-lg border border-slate-300 px-3 py-2 font-medium">Extensie delen</button>
        <p className="mt-2 text-xs leading-5 text-slate-600">Deel alleen de installatielink. De ontvanger gebruikt of test de extensie zelfstandig met een eigen Schoolware-account.</p>
      </div>
      <div className="rounded-lg border border-teal-200 bg-teal-50 p-3 text-sm">
        <button type="button" disabled={working || !view?.enabled} onClick={() => { void copyInvitation(); }} className="rounded-lg border border-teal-300 px-3 py-2 font-medium text-teal-800 disabled:opacity-50">Leerlingvoortgang delen</button>
        <p className="mt-2 text-xs leading-5 text-slate-600">Privé-uitnodiging met koppelcode voor dezelfde leerling. De ontvanger kan gedeelde taakstatussen lezen en wijzigen; agenda-inhoud blijft lokaal.</p>
        {!view?.enabled && <p className="mt-1 text-xs text-slate-600">Maak hieronder eerst een leerlinggroep aan of koppel een bestaande groep.</p>}
      </div>
    </div>
    <p className="mt-2 text-sm leading-6 text-slate-600">Deel Open, Bezig en Klaar via schoolware.bumper.be. Titels, instructies en Schoolware-inloggegevens blijven lokaal.
      Koppel alleen computers die de agenda van dezelfde leerling bekijken. Elke leerling heeft een eigen deelgroep en koppelcode; verschillende gezinnen blijven gescheiden.</p>
    {!compatible && <p role="status" className="mt-3 text-sm text-amber-800">Koppel eerst een ondersteunde Schoolware-agenda en voer een geslaagde controle uit om voortgang te delen.</p>}
    {view?.enabled ? <>
      {view.blocked && <p role="status" className="mt-3 text-sm text-amber-800">Automatische synchronisatie is gestopt: de server weigert deze koppeling. Controleer de koppelcode of vraag de beheerder om hulp. Nu synchroniseren probeert opnieuw; lokale voortgang blijft bewaard.</p>}
      <p className="mt-3 text-sm">{view.registrationPending ? view.blocked ? 'Je nieuwe leerlinggroep is nog niet geregistreerd; automatische pogingen zijn gestopt.' : 'Je nieuwe leerlinggroep wacht nog op registratie; Chrome probeert het automatisch opnieuw.' : 'Ingeschakeld voor de agendaselectie waarmee je hebt gekoppeld.'} {view.pending} wijzigingen wachten op verzending.</p>
      <p className="mt-2 text-xs text-slate-500">{view.lastSuccessAt ? `Laatst gesynchroniseerd: ${new Date(view.lastSuccessAt).toLocaleString('nl-BE', { timeZone: 'Europe/Brussels' })}` : 'Nog geen geslaagde synchronisatie.'}</p>
      {view.error && <p role="status" className="mt-2 text-sm text-amber-800">{view.registrationPending ? 'De server is niet bereikbaar of laat tijdelijk geen nieuwe groepen toe. Je lokale voortgang blijft bewaard.' : 'De laatste poging is mislukt. Controleer je internetverbinding, koppelcode en Chrome-toestemming.'}</p>}
      <div className="mt-4 rounded-lg bg-teal-50 p-3 text-sm">
        <h3 className="font-semibold">Met wie deel je voortgang?</h3>
        {view.displayName && <p className="mt-1">Jouw naam op deze computer: <strong>{view.displayName}</strong></p>}
        {view.members?.some((member) => !member.self) ? <ul className="mt-2 space-y-2">
          {view.members.filter((member) => !member.self).map((member) => <li key={member.id}>
            <span className="font-medium">{member.label}</span>
            <span className="block text-xs text-slate-600">Laatst gemeld: {new Date(member.lastSeenAt).toLocaleString('nl-BE', { timeZone: 'Europe/Brussels' })}</span>
          </li>)}
        </ul> : <p className="mt-2">{view.displayName ? 'Nog geen andere deelnemers gemeld. Laat de andere computer een naam instellen en synchroniseren.' : 'Stel hieronder jouw naam of rol in om deelnemers herkenbaar te delen.'}</p>}
        <p className="mt-2 text-xs text-slate-600">Dit zijn zelfgekozen namen van computers die zich bij deze groep hebben gemeld. Ze bevestigen geen Schoolware-identiteit of actuele online status. Oudere extensieversies melden geen naam.</p>
        {view.membersError && <p role="status" className="mt-2 text-amber-800">De deelnemers konden niet worden bijgewerkt. Eerder ontvangen namen blijven zichtbaar. Controleer of de server is bijgewerkt.</p>}
      </div>
      <div className="mt-3 text-sm">
        <label className="block">{view.displayName ? 'Jouw naam of rol wijzigen' : 'Jouw naam of rol'}
          <input type="text" autoComplete="off" maxLength={48} disabled={working} value={label} placeholder="Bijvoorbeeld Papa of Emma"
            onChange={(event) => { void saveName(event.target.value); }} className="mt-1 block w-full rounded-lg border border-slate-300 p-2" />
        </label>
        <p className="mt-2 text-xs text-slate-500">Je naam of rol wordt automatisch opgeslagen.</p>
      </div>
      <div className="mt-3 flex flex-wrap gap-3 text-sm">
        <button type="button" disabled={working} onClick={() => { void act('sync.run'); }} className="rounded-lg border border-slate-300 px-3 py-2">Nu synchroniseren</button>
        <button type="button" disabled={working} onClick={() => { void showPairing(); }} className="rounded-lg border border-slate-300 px-3 py-2">Koppelcode tonen</button>
        <button type="button" disabled={working} onClick={() => { void act('sync.disconnect'); }} className="rounded-lg border border-slate-300 px-3 py-2">Deze computer ontkoppelen</button>
      </div>
      <details className="mt-4 text-sm"><summary className="cursor-pointer text-red-700">Gedeelde servergegevens wissen</summary>
        <p className="mt-2">Ontkoppel eerst de andere computers, anders kunnen die opnieuw gegevens versturen. Lokale voortgang wordt niet gewist.</p>
        <label className="mt-2 flex items-center gap-2"><input type="checkbox" checked={confirmDelete} onChange={(e) => setConfirmDelete(e.target.checked)} />Ik wil de gedeelde servergegevens van deze leerlinggroep wissen.</label>
        <button type="button" disabled={working || !confirmDelete} onClick={() => { void act('sync.delete'); }} className="mt-2 rounded-lg border border-red-200 px-3 py-2 text-red-700 disabled:opacity-50">Wissen en ontkoppelen</button>
      </details>
    </> : <div className="mt-4 space-y-3 text-sm">
      <label className="block">Deze computer
        <select value={mode} onChange={(e) => { setMode(e.target.value === 'first' ? 'first' : 'join'); setSecret(''); }} className="mt-1 block rounded-lg border border-slate-300 p-2">
          <option value="first">Eerste computer instellen</option><option value="join">Koppelen aan een bestaande computer</option>
        </select>
      </label>
      <label className="block">Jouw naam of rol op deze computer (optioneel)
        <input type="text" autoComplete="off" maxLength={48} value={label} placeholder="Bijvoorbeeld Papa of Emma"
          onChange={(event) => { labelEdited.current = true; setLabel(event.target.value); }} className="mt-1 block w-full rounded-lg border border-slate-300 p-2" />
      </label>
      {mode === 'first' ? <p>Maak automatisch een nieuwe leerlinggroep aan. Je ontvangt een koppelcode voor de andere computers. Gebruik dit eenmaal per leerling.</p> : <label className="block">Koppelcode van de eerste computer
        <input type="password" autoComplete="off" spellCheck={false} value={secret} onChange={(e) => setSecret(e.target.value)} className="mt-1 block w-full rounded-lg border border-slate-300 p-2" />
      </label>}
      <button type="button" disabled={working || !compatible || (Boolean(label.trim()) && !normalizeSyncLabel(label)) || (mode !== 'first' && !parsePairingCode(secret.trim()))}
        onClick={() => { void connect(); }} className="rounded-lg bg-teal-700 px-4 py-2 font-medium text-white disabled:opacity-50">{mode === 'first' ? 'Nieuwe leerlinggroep aanmaken' : 'Koppelen'}</button>
    </div>}
    {publicInvitation && <div className="mt-4 text-sm">
      <label className="block font-medium">Openbaar installatiebericht — alleen de extensie
        <textarea readOnly rows={6} value={publicInvitation} onFocus={(event) => event.currentTarget.select()} className="mt-2 block w-full rounded-lg border border-slate-300 p-2 text-xs" />
      </label>
      <button type="button" onClick={() => setPublicInvitation('')} className="mt-2 text-teal-700">Installatiebericht verbergen</button>
    </div>}
    {invitation && <div className="mt-4 text-sm">
      <label className="block font-medium">Privé-uitnodiging met installatielink en koppelcode
        <textarea readOnly rows={10} value={invitation} onFocus={(event) => event.currentTarget.select()} className="mt-2 block w-full rounded-lg border border-slate-300 p-2 text-xs" />
      </label>
      <p className="mt-2 text-xs text-slate-500">Iedereen met deze code kan de gedeelde voortgang lezen en wijzigen. Controleer de ontvanger voordat je het bericht verstuurt.</p>
      <button type="button" onClick={() => setInvitation('')} className="mt-2 text-teal-700">Uitnodiging verbergen</button>
    </div>}
    {pairing && <div className="mt-4 text-sm">
      <label className="block font-medium">Bewaar deze koppelcode privé en voer hem op de tweede computer in.
        <textarea readOnly value={pairing} onFocus={(e) => e.currentTarget.select()} className="mt-2 block w-full rounded-lg border border-slate-300 p-2 font-mono text-xs" />
      </label>
      <p className="mt-2 text-xs text-slate-500">De code geeft toegang tot gedeelde voortgang. Deel hem alleen met computers die dezelfde leerling volgen. Je kunt hem later opnieuw tonen op een gekoppelde computer.</p>
      <button type="button" onClick={() => setPairing('')} className="mt-2 text-teal-700">Koppelcode verbergen</button>
    </div>}
    <p className="mt-4 text-xs leading-5 text-slate-500">Bij een open Chrome wordt ongeveer elke minuut gecontroleerd. Een vinkje wordt direct aangeboden; offline wijzigingen wachten lokaal.
      Bij gelijktijdige wijzigingen geldt de laatst door de server ontvangen wijziging. Bestaande afmeldingen worden alleen van de eerste computer overgenomen.
      Gewijzigde bron-ID’s kunnen voorlopig niet worden gekoppeld. Alleen overeenkomende inhoudsversies delen voortgang.</p>
    {message && <p role="status" className="mt-3 text-sm">{message}</p>}
  </section>;
}
