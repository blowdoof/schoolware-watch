import type { SyncView } from '../shared/progress-sync';
import { APP_VERSION, SYNC_PROTOCOL, compatibilityIssue, type CompatibilityIssue } from '../shared/sync-compatibility';

export function syncCompatibilityText(view: SyncView): string | null {
  return compatibilityMessage(view.compatibility?.issue);
}
export function compatibilityMessage(issue: CompatibilityIssue | null | undefined): string | null {
  if (issue === 'update-required') return 'Werk deze extensie bij om veilig te synchroniseren. Lokale wijzigingen blijven bewaard; er wordt niets uitgewisseld zolang de versie niet compatibel is.';
  if (issue === 'server-update-required') return 'De synchronisatiedienst moet worden bijgewerkt. Lokale wijzigingen blijven bewaard; synchronisatie is gepauzeerd.';
  if (issue === 'check-unavailable') return 'De versiecontrole is niet bereikbaar. Lokale wijzigingen blijven bewaard; synchronisatie wacht op een geslaagde controle.';
  return null;
}
export function SyncVersionStatus({ view, working, onCheck }: { view: SyncView; working: boolean; onCheck: () => void }) {
  const text = syncCompatibilityText(view);
  const update = view.storeUpdate;
  return <div className="mt-3 rounded-lg border border-slate-200 p-3 text-sm" aria-label="Versie en synchronisatie">
    <p>Deze computer: versie {APP_VERSION}.</p>
    {view.workerVersion && view.workerVersion !== APP_VERSION && <p role="status" className="mt-2 text-amber-800">De interface gebruikt {APP_VERSION}, maar de achtergrond werkt nog met {view.workerVersion}. Herlaad een lokaal geladen extensie via chrome://extensions en open dit scherm opnieuw.</p>}
    {text && <p role="status" className="mt-2 text-amber-800">{text}</p>}
    {view.compatibility && <p className="mt-1 text-xs text-slate-600">Compatibiliteit gecontroleerd: {new Date(view.compatibility.checkedAt).toLocaleString('nl-BE', { timeZone: 'Europe/Brussels' })}.
      {view.compatibility.policy?.latestVersion ? ` Laatst gepubliceerde versie volgens de dienst: ${view.compatibility.policy.latestVersion}.` : ''}</p>}
    <button type="button" disabled={working} onClick={onCheck} className="mt-2 rounded-lg border border-slate-300 px-3 py-2">Controleren op updates</button>
    {update && <p role="status" className="mt-2 text-xs text-slate-600">{update.status === 'update_available' ? `Versie ${update.version} staat klaar. Sluit de extensiepagina's of herstart Chrome om de update te laten installeren.` :
      update.status === 'throttled' ? 'Chrome stelt een nieuwe updatecontrole tijdelijk uit. Probeer later opnieuw.' :
      update.status === 'no_update' ? 'Chrome heeft bij deze controle geen beschikbare update gemeld. Dit bewijst niet dat synchronisatie compatibel is.' :
      'Chrome kon geen Store-updatecontrole uitvoeren. Een lokaal geladen extensie moet je zelf bijwerken.'}</p>}
    {view.devices?.length ? <ul className="mt-3 space-y-2">{view.devices.map((device) => <li key={device.id}>
      <span className="font-medium">{device.self ? 'Deze computer — laatst gedeelde versie' : device.label ?? 'Naamloos gekoppeld toestel'}</span>: {device.version}
      <span className="block text-xs text-slate-600">Versie gemeld: {new Date(device.reportedAt).toLocaleString('nl-BE', { timeZone: 'Europe/Brussels' })}. Dit is de laatst gemelde versie, geen bewijs dat het toestel nu online is.</span>
      {(view.compatibility?.policy ? compatibilityIssue(view.compatibility.policy, device.version, device.protocol) !== null : device.protocol !== SYNC_PROTOCOL) &&
        <span className="block text-xs text-amber-800">Dit toestel heeft een update of aangepaste synchronisatiedienst nodig.</span>}
    </li>)}</ul> : <p className="mt-2 text-xs text-slate-600">Nog geen toestelversies ontvangen. Oudere versies melden dit niet.</p>}
  </div>;
}
