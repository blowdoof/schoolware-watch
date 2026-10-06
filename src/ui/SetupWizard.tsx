import { useEffect, useRef, useState } from 'react';
import { ConnectionPanel } from './ConnectionPanel';
import { validateConnectionState } from '../shared/connection';
import { validatePreferencesView, PREFERENCES_KEY } from '../shared/preferences';
import { schoolwarePermission } from '../schoolware/agenda-request';
import { SETUP_KEY, setupAlreadyConfigured, requiredSetupStep, type SetupStep } from '../shared/setup';

export function SetupWizard({ refreshToken, onChanged, inlineConnection, onSettings }: { refreshToken: number; onChanged: () => void; inlineConnection: boolean; onSettings: () => void }) {
  const available = typeof chrome !== 'undefined' && Boolean(chrome.runtime?.id);
  const legacyConfigured = useRef<boolean | null>(null);
  const [deferred, setDeferred] = useState(false);
  const [step, setStep] = useState<SetupStep | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [working, setWorking] = useState(false);
  useEffect(() => {
    if (!available) return;
    let mounted = true;
    void (async () => {
      const [rawConnection, rawPreferences, stored] = await Promise.all([
        chrome.runtime.sendMessage({ type: 'connection.read' }),
        chrome.runtime.sendMessage({ type: 'preferences.read' }),
        chrome.storage.local.get([SETUP_KEY, PREFERENCES_KEY]),
      ]);
      const connection = validateConnectionState(rawConnection);
      const preferences = validatePreferencesView(rawPreferences);
      if (!connection || !preferences?.ok) throw new Error('Setup unavailable');
      const permission = Boolean(connection.requestUrl && await chrome.permissions.contains({ origins: [schoolwarePermission(connection.requestUrl)] }));
      if (!mounted) return;
      // Existing configured installations predate the setup-completion marker.
      legacyConfigured.current ??= setupAlreadyConfigured(stored[SETUP_KEY], connection, stored[PREFERENCES_KEY]);
      const completed = stored[SETUP_KEY] === true || legacyConfigured.current;
      const required = requiredSetupStep(connection, permission, preferences, completed);
      setReady(Boolean(connection.requestUrl && permission && connection.lastCheck?.status === 'success'));
      setStep((current) => {
        if (completed && required === null) return null;
        if (required === 'connection') return required;
        if (current === 'connection') return 'preferences';
        if (required === 'preferences' && ((preferences.preferences.notificationsEnabled && !preferences.notificationPermission) ||
            (preferences.preferences.browserNotificationsEnabled && !preferences.browserPermission))) return 'preferences';
        return current ?? required;
      });
      setError('');
    })().catch(() => { if (mounted) setError('De installatie kon niet worden gecontroleerd. Open de instellingen of herlaad de extensie.'); });
    return () => { mounted = false; };
  }, [available, refreshToken]);

  async function finish() {
    setWorking(true); setError('');
    try {
      const result = validateConnectionState(await chrome.runtime.sendMessage({ type: 'setup.complete' }));
      if (!result?.requestUrl) throw new Error('Setup incomplete');
      setStep(null); onChanged();
    } catch { setError('De installatie kon niet worden afgerond. Controleer eerst je Schoolware-koppeling.'); }
    finally { setWorking(false); }
  }
  if (!available || deferred || (!step && !error)) return null;
  const index = step === 'connection' ? 1 : step === 'preferences' ? 2 : 3;
  return <section aria-label="Installatiehulp" className="mt-5 rounded-2xl border border-teal-200 bg-teal-50 p-4">
    <h2 className="font-semibold">Schoolware Watch instellen</h2>
    <p className="mt-2 text-sm">Stap {index} van 3: {step === 'connection' ? 'Je school en agenda koppelen' : step === 'preferences' ? 'Controles en meldingen kiezen' : 'Bestaande voortgang koppelen (optioneel)'}</p>
    <ol className="mt-2 list-decimal pl-5 text-xs leading-6">
      <li>Log in bij je school, open het extensie-icoon en bevestig de juiste leerling.</li>
      <li>Kies automatische controles en eventuele meldingen. Je geschiedenis blijft lokaal.</li>
      <li>Gebruik een bestaande koppelcode of maak een nieuwe leerlinggroep; je kunt dit overslaan.</li>
    </ol>
    {step === 'connection' && <p className="mt-3 text-sm">Gebruik de Schoolware-koppeling bij Instellingen om je agenda te verbinden of je sessie te herstellen. Je overige schermen blijven beschikbaar.</p>}
    {step === 'connection' && inlineConnection && <ConnectionPanel showSetup refreshToken={refreshToken} onHistoryChanged={onChanged} />}
    {step === 'preferences' && <>
      <p className="mt-3 text-sm">Kies je controles en meldingen bij Instellingen. De instellingen blijven automatisch bewaard.</p>
      <button type="button" className="mt-4 rounded-lg bg-teal-700 px-4 py-2 text-sm text-white" onClick={() => setStep('sharing')}>Verder naar koppelen</button>
    </>}
    {step === 'sharing' && <>
      <p className="mt-3 text-sm">Er is geen apart Schoolware Watch-account. Voor een bestaande leerlinggroep gebruik je de koppelcode van de andere computer. Je Schoolware-account blijft bij je school.</p>
      <p className="mt-2 text-sm">Gebruik bij Instellingen het onderdeel Voortgang delen tussen computers. Kies daar Koppelen aan een bestaande computer en voer je koppelcode in.</p>
      <div className="mt-4 flex flex-wrap gap-3 text-sm">
        <button type="button" onClick={() => setStep('preferences')} className="text-teal-700">Terug</button>
        <button type="button" disabled={working} onClick={() => { void finish(); }} className="rounded-lg bg-teal-700 px-4 py-2 text-white disabled:opacity-50">Installatie afronden / delen overslaan</button>
      </div>
    </>}
    {step === 'connection' && ready && <button type="button" onClick={() => setStep('preferences')} className="mt-4 text-sm text-teal-700">Verder naar instellingen</button>}
    {inlineConnection && <button type="button" onClick={onSettings} className="mt-4 block text-sm text-teal-700 underline">Instellingen openen</button>}
    <button type="button" onClick={() => setDeferred(true)} className="mt-4 block text-sm text-teal-700 underline">Later instellen</button>
    {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
  </section>;
}
