import type { PlanningSharingStatus as SharingStatus } from '../shared/planning-sync';
import { compatibilityMessage } from './SyncVersionStatus';

export function PlanningSharingStatus({ status }: { status: SharingStatus | undefined }) {
  if (!status) return null;
  return <p role={status.error ? 'status' : undefined} className={`mt-2 text-xs ${status.error || status.pending ? 'text-amber-800' : 'text-slate-500'}`}>
    {!status.enabled ? 'Delen staat uit voor deze leerling. Wijzigingen blijven op deze computer. Koppel bij Instellingen de computers van dezelfde leerling.' : <>
      {status.issue ? `${compatibilityMessage(status.issue)} ` : status.error ? 'Synchronisatie lukt momenteel niet. Lokale wijzigingen blijven bewaard en worden opnieuw aangeboden. ' : 'Delen is ingeschakeld. '}
      {status.pending > 0 ? `${status.pending} versleutelde berichten wachten op verzending. ` : ''}
      {status.receiving ? 'Gedeelde wijzigingen worden nog opgehaald; het overzicht is nog niet volledig bijgewerkt. ' : ''}
      {status.lastSuccessAt ? `Laatst gesynchroniseerd: ${new Date(status.lastSuccessAt).toLocaleString('nl-BE', { timeZone: 'Europe/Brussels' })}.` : 'Nog geen geslaagde synchronisatie.'}
    </>}
  </p>;
}
