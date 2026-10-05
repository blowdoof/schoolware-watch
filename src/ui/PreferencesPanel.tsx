import { useEffect, useRef, useState } from 'react';
import type { Category } from '../domain/observations';
import { DEFAULT_PREFERENCES, validatePreferences, validatePreferencesView, type Preferences, type PreferencesView } from '../shared/preferences';
import type { ConnectionMessage } from '../shared/connection';
import { notificationTestMessage, validateNotificationTestResult } from '../shared/notifications';
import { browserPermissions, validateBrowserAlertsView } from '../shared/browser-alerts';
import { SCHOOLWARE_ORIGIN } from '../schoolware/agenda-request';
import { validateConnectionState } from '../shared/connection';
import { recordPermissionResult } from './permission-log';
import { NotificationDiagnostics } from './NotificationDiagnostics';
import { savePreferences } from './autosave';

const categories: Record<Category, string> = { tests: 'Toetsen (rood vlagje)', assignments: 'Taken (oranje vlagje)', review: 'Punten met een sterretje', other: 'Lesinformatie zonder vlagje of sterretje' };
const localTime = (value: string) => new Date(value).toLocaleString('nl-BE', { timeZone: 'Europe/Brussels' });

async function send(message: ConnectionMessage): Promise<PreferencesView> {
  const result: unknown = await chrome.runtime.sendMessage(message);
  const view = validatePreferencesView(result);
  if (!view?.ok) throw new Error('Preferences unavailable');
  return view;
}

export function PreferencesPanel({ settings, refreshToken, onSaved }: {
  settings: boolean; refreshToken: number; onSaved: () => void;
}) {
  const [schoolwareUrl, setSchoolwareUrl] = useState(SCHOOLWARE_ORIGIN);
  const permissions = browserPermissions(schoolwareUrl);
  const [view, setView] = useState<PreferencesView | null>(null);
  const [draft, setDraft] = useState({ ...DEFAULT_PREFERENCES });
  const dirty = useRef(false);
  const draftRef = useRef(draft);
  const revision = useRef(0);
  const pendingSaves = useRef(0);
  const [saving, setSaving] = useState(false);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState('');
  const extensionAvailable = typeof chrome !== 'undefined' && Boolean(chrome.runtime?.id);

  useEffect(() => {
    if (!extensionAvailable) return;
    let mounted = true;
    void chrome.runtime.sendMessage({ type: 'connection.read' }).then((raw: unknown) => {
      const state = validateConnectionState(raw);
      if (mounted) setSchoolwareUrl(state?.requestUrl ?? SCHOOLWARE_ORIGIN);
    }).catch(() => {});
    const acceptDraft = !dirty.current;
    void send({ type: 'preferences.read' }).then((next) => {
      if (mounted) { setView(next); if (acceptDraft && !dirty.current) { setDraft(next.preferences); draftRef.current = next.preferences; } }
    }).catch(() => { if (mounted) setMessage('De instellingen konden niet worden geladen.'); });
    return () => { mounted = false; };
  }, [extensionAvailable, refreshToken]);

  function change(patch: Partial<Preferences>) {
    const next = { ...draftRef.current, ...patch };
    draftRef.current = next;
    dirty.current = true;
    setDraft(next);
    const current = ++revision.current;
    if (!validatePreferences(next)) {
      setMessage('Kies 1 tot 30 dagen en minstens één categorie. Deze wijziging is nog niet opgeslagen.');
      return;
    }
    setMessage('Wijziging wordt opgeslagen…');
    pendingSaves.current++;
    setSaving(true);
    // Send the desired state immediately. Permission prompts never delay writes.
    const save = savePreferences(next);
    if (patch.notificationsEnabled === true || patch.browserNotificationsEnabled === true) {
      const permission = chrome.permissions.request({
        permissions: [...(patch.notificationsEnabled === true ? ['notifications' as const] : []),
          ...(patch.browserNotificationsEnabled === true ? ['scripting' as const] : [])],
        origins: patch.browserNotificationsEnabled === true ? permissions.origins : [],
      });
      void permission.then(async (granted) => {
        if (patch.notificationsEnabled === true) await recordPermissionResult('notifications', granted);
        if (patch.browserNotificationsEnabled === true) await recordPermissionResult('browser', granted);
        if (revision.current === current && !granted) setMessage('Instelling opgeslagen, maar Chrome-toestemming ontbreekt.');
        onSaved();
      }).catch(() => {
        if (revision.current === current) setMessage('Instelling opgeslagen, maar Chrome-toestemming ontbreekt.');
      });
    }
    void save.then((saved) => {
      if (revision.current === current) {
        dirty.current = false;
        setView(saved);
        const missing = (saved.preferences.notificationsEnabled && !saved.notificationPermission) ||
          (saved.preferences.browserNotificationsEnabled && !saved.browserPermission);
        setMessage(missing ? 'Instelling opgeslagen, maar Chrome-toestemming ontbreekt.' : 'Automatisch opgeslagen.');
      }
      onSaved();
    }).catch(() => {
      if (revision.current === current) setMessage('Deze wijziging kon niet worden opgeslagen. Controleer de Chrome-toestemming en probeer opnieuw.');
    }).finally(() => {
      pendingSaves.current--;
      setSaving(pendingSaves.current > 0);
    });
  }

  async function testNotification() {
    setWorking(true);
    setMessage('');
    try {
      const granted = await chrome.permissions.request({ permissions: ['notifications'] });
      await recordPermissionResult('notifications', granted);
      if (!granted) {
        setMessage('Chrome heeft geen toestemming voor meldingen gegeven.'); return;
      }
      const raw: unknown = await chrome.runtime.sendMessage({ type: 'notifications.test' } satisfies ConnectionMessage);
      const result = validateNotificationTestResult(raw);
      if (!result) throw new Error('Invalid notification test result');
      setMessage(notificationTestMessage(result));
      // Refresh permission status without losing the useful test diagnostic.
      await send({ type: 'preferences.read' }).then(setView).catch(() => {});
    } catch { setMessage('De testmelding kon niet worden verstuurd.'); }
    finally { setWorking(false); }
  }

  async function testBrowserNotification() {
    setWorking(true);
    setMessage('');
    try {
      const granted = await chrome.permissions.request(permissions);
      await recordPermissionResult('browser', granted);
      if (!granted) {
        setMessage('Chrome heeft geen toestemming gegeven om de banner op Schoolware te tonen.'); return;
      }
      const raw: unknown = await chrome.runtime.sendMessage({ type: 'browser.alerts.test' } satisfies ConnectionMessage);
      const next = validateBrowserAlertsView(raw);
      if (!next?.ok || !next.enabled) throw new Error('Browser alerts unavailable');
      const saved = await send({ type: 'preferences.read' });
      setView(saved);
      draftRef.current = { ...draftRef.current, browserNotificationsEnabled: true };
      setDraft(draftRef.current);
      setMessage('De Schoolware-banner is ingeschakeld en de testmelding staat klaar. Open Schoolware om de banner te zien; herlaad die pagina als dat nodig is. Klik op de banner voor een voorbeeld van de lesdetails.');
      onSaved();
    } catch { setMessage('De testbanner kon niet worden aangemaakt. Herlaad de extensie en de Schoolware-pagina en probeer opnieuw.'); }
    finally { setWorking(false); }
  }

  if (!extensionAvailable) return null;
  return (
    <section aria-label="Automatische controle en meldingen" className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="font-semibold">Automatische controle{settings ? ', kleuren en meldingen' : ''}</h2>
      {view && <div className="mt-2 text-sm leading-6 text-slate-600" aria-live="polite">
        <p>{view.monitoringScheduled ? `Actief: elke ${view.preferences.intervalMinutes} minuten.` :
          view.preferences.monitoringEnabled ? 'Wacht op een agendakoppeling en toegang tot Schoolware.' : 'Automatische controle is uitgeschakeld.'}</p>
        {view.nextCheckAt && <p className="text-xs">Volgende geplande controle: {localTime(view.nextCheckAt)}</p>}
        {view.retryAt && <p className="text-xs">Na een mislukte poging wordt ten vroegste opnieuw gecontroleerd op {localTime(view.retryAt)}.</p>}
        <p className="text-xs">Systeemmeldingen: {view.preferences.notificationsEnabled && view.notificationPermission ?
          `aan, voor de komende ${view.preferences.notificationDays} dagen.` : 'uit.'}</p>
        <p className="text-xs">Schoolware-banner: {view.preferences.browserNotificationsEnabled && view.browserPermission ? 'aan, op de Schoolware-webpagina.' : 'uit.'}</p>
        {settings && !view.preferences.notificationsEnabled && !view.preferences.browserNotificationsEnabled &&
          <p className="mt-2 text-sm text-amber-800">Beide meldingskanalen staan uit. Schakel hieronder systeemmeldingen of de Schoolware-banner in.</p>}
        {settings && view.preferences.notificationsEnabled && !view.notificationPermission &&
          <p className="mt-2 text-sm text-amber-800">Systeemmeldingen staan ingesteld, maar Chrome-toestemming ontbreekt. Schakel het vinkje uit en weer in om toestemming te geven.</p>}
        {settings && view.preferences.browserNotificationsEnabled && !view.browserPermission &&
          <p className="mt-2 text-sm text-amber-800">De Schoolware-banner staat ingesteld, maar Chrome-toestemming ontbreekt. Schakel het vinkje uit en weer in om toestemming te geven.</p>}
      </div>}
      {settings && view && (
        <div className="mt-4 space-y-5 text-sm">
          <p className="text-xs text-slate-500">Wijzigingen worden automatisch opgeslagen.</p>
          <fieldset disabled={working} className="space-y-3">
            <legend className="font-medium">Controle</legend>
            <label className="flex items-center gap-2"><input type="checkbox" checked={draft.monitoringEnabled}
              onChange={(event) => change({ monitoringEnabled: event.target.checked })} />Periodiek controleren</label>
            <label className="flex items-center gap-3">Elke
              <select value={draft.intervalMinutes} onChange={(event) => change({ intervalMinutes: Number(event.target.value) })}
                className="rounded-lg border border-slate-300 p-2">
                {[5, 15, 30, 60].map((minutes) => <option key={minutes} value={minutes}>{minutes} minuten</option>)}
              </select>
            </label>
            <p className="text-xs leading-5 text-slate-500">De periode schuift mee: vanaf 7 dagen geleden tot minstens 14 dagen vooruit.
              Chrome moet draaien en je Schoolware-sessie moet geldig zijn. Tijdens slaapstand kunnen controles later plaatsvinden.</p>
          </fieldset>
          <fieldset disabled={working} className="space-y-3">
            <legend className="font-medium">Boekentas</legend>
            <label className="flex items-center gap-2"><input type="checkbox" checked={draft.schoolbagEnabled}
              onChange={(event) => change({ schoolbagEnabled: event.target.checked })} />Boekentas tonen onder de to-do</label>
            <p className="text-xs text-slate-500">Optionele suggesties voor materiaal om mee naar school en naar huis te nemen.</p>
          </fieldset>
          <fieldset disabled={working} className="space-y-3">
            <legend className="font-medium">Kleuren in de geschiedenis</legend>
            <label className="flex items-center gap-3"><input type="color" value={draft.newColor}
              onChange={(event) => change({ newColor: event.target.value })} className="h-9 w-12" />Nieuw waargenomen</label>
            <label className="flex items-center gap-3"><input type="color" value={draft.changedColor}
              onChange={(event) => change({ changedColor: event.target.value })} className="h-9 w-12" />Gewijzigd</label>
          </fieldset>
          <fieldset disabled={working} className="space-y-3">
            <legend className="font-medium">Meldingen</legend>
            <label className="flex items-center gap-2"><input type="checkbox" checked={draft.notificationsEnabled}
              onChange={(event) => change({ notificationsEnabled: event.target.checked })} />Systeemmeldingen (bijvoorbeeld via Windows)</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={draft.browserNotificationsEnabled}
              onChange={(event) => change({ browserNotificationsEnabled: event.target.checked })} />Banner op de Schoolware-webpagina</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={draft.todoRemindersEnabled}
              onChange={(event) => change({ todoRemindersEnabled: event.target.checked })} />Dagelijkse to-do herinnering vanaf 16 uur</label>
            <p className="text-xs leading-5 text-slate-500">Na een geslaagde agendacontrole krijg je maximaal één to-do herinnering per dag via elk ingeschakeld meldingskanaal.
              Ze volgt de geselecteerde categorieën en kijkt tot de volgende bekende schooldag in je agenda. Chrome moet draaien; zonder open taken of bekende volgende schooldag komt er geen herinnering.</p>
            <p className="text-xs leading-5 text-slate-500">De banner verschijnt alleen op je gekoppelde Schoolware-website en toont algemene aantallen.
              De extensie leest of bewaart geen pagina-inhoud. Chrome vraagt toestemming om de banner op Schoolware te plaatsen.
              Het extensie-icoon toont een teller totdat je de meldingen op Schoolware sluit.</p>
            <label className="flex items-center gap-3">Van nu tot
              <input type="number" min={1} max={30} required value={draft.notificationDays}
                onChange={(event) => change({ notificationDays: Number(event.target.value) })}
                className="w-20 rounded-lg border border-slate-300 p-2" />dagen vooruit
            </label>
            <p className="text-xs text-slate-500">Selecteer de categorieën waarvoor je een melding wilt:</p>
            {Object.entries(categories).map(([key, label]) => <label key={key} className="flex items-center gap-2">
              <input type="checkbox" checked={draft.notificationCategories.includes(key as Category)} onChange={(event) => change({
                notificationCategories: event.target.checked ? [...draftRef.current.notificationCategories, key as Category] :
                  draftRef.current.notificationCategories.filter((category) => category !== key) })} />{label}
            </label>)}
            <p className="text-xs leading-5 text-slate-500">Nieuwe waarnemingen, wijzigingen en opnieuw verschenen punten kunnen na een geslaagde controle een melding geven.
              Het beginpunt geeft geen wijzigingsmelding; de to-do herinnering staat hier los van. We gebruiken de Brusselse tijd en de geplande start van het punt.
              Een melding bevat alleen aantallen; klik erop om de lesdetails te openen met nieuwe en gewijzigde punten in de gekozen kleuren.</p>
            <p className="text-xs leading-5 text-slate-500">Een punt buiten de gekozen periode geeft geen melding, ook als het nieuw is waargenomen.
              Nieuwe dagen die voor het eerst worden gecontroleerd, vormen een beginpunt. Inschakelen van meldingen verstuurt geen eerdere waarnemingen opnieuw.
              Kies Punten met een sterretje als je ook daarvoor meldingen wilt; laat lesinformatie uit voor alleen gemarkeerde punten.</p>
          </fieldset>
          <div className="flex flex-wrap gap-3">
            <button type="button" disabled={working || saving} onClick={() => { void testNotification(); }}
              className="rounded-lg border border-slate-300 px-4 py-2 disabled:opacity-50">Testmelding systeem</button>
            <button type="button" disabled={working || saving}
              onClick={() => { void testBrowserNotification(); }} className="rounded-lg border border-slate-300 px-4 py-2 disabled:opacity-50">Testbanner op Schoolware</button>
          </div>
          <p className="text-xs text-slate-500">Testbanner op Schoolware vraagt zo nodig toestemming en schakelt de banner in.</p>
        </div>
      )}
      {message && <p role="status" className="mt-3 text-sm">{message}</p>}
      {settings && <NotificationDiagnostics refreshToken={refreshToken} />}
    </section>
  );
}
