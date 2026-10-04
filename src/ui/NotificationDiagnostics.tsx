import { useEffect, useState } from 'react';
import { validateActivityView, type ActivityEntry } from '../shared/activity';
import type { ConnectionMessage } from '../shared/connection';

export function notificationExplanation(entry: ActivityEntry): string {
  if (entry.action === 'notification.selection' && entry.phase === 'succeeded') {
    return `${entry.data.added ?? 0} nieuwe of opnieuw verschenen en ${entry.data.changed ?? 0} gewijzigde punten geselecteerd.`;
  }
  switch (entry.data.reason) {
    case 'disabled': return 'Dit meldingskanaal stond uit.';
    case 'no-events': {
      if (entry.data.count === 0) return 'Deze controle bevatte geen nieuwe waarnemingen of wijzigingen.';
      const reasons = [
        entry.data.baselineCount ? `${entry.data.baselineCount} beginpunten (eerste inlezing)` : '',
        entry.data.categoryExcludedCount ? `${entry.data.categoryExcludedCount} punten buiten de gekozen categorieën` : '',
        entry.data.outsideWindowCount ? `${entry.data.outsideWindowCount} punten buiten de periode van ${entry.data.days} dagen vanaf de controle` : '',
        entry.data.inactiveCount ? `${entry.data.inactiveCount} verborgen of vervallen punten` : '',
      ].filter(Boolean);
      return reasons.length ? `Geen melding geselecteerd: ${reasons.join('; ')}.` :
        'Geen nieuwe waarnemingen of wijzigingen die aan de gekozen categorieën en periode voldoen. Beginpunten geven geen melding.';
    }
    case 'permission-required': return 'Chrome-toestemming voor systeemmeldingen ontbreekt.';
    case 'blocked': return 'Chrome blokkeert systeemmeldingen. Controleer de meldingsinstellingen van Chrome en Windows.';
    case 'accepted': return 'Chrome heeft de systeemmelding aangemaakt. Dit bevestigt niet dat Windows een pop-up heeft getoond; controleer ook het meldingscentrum en Niet storen.';
    case 'api-error': return 'Chrome kon de systeemmelding niet aanmaken. Probeer Testmelding systeem.';
    case 'already-claimed': return 'De melding voor deze controle was al verwerkt.';
    case 'cancelled': return 'De controle werd onderbroken door een gewijzigde koppeling of instelling.';
    default: return 'De verwerking van de melding is gestart.';
  }
}

export function NotificationDiagnostics({ refreshToken }: { refreshToken: number }) {
  const [entries, setEntries] = useState<ActivityEntry[] | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let mounted = true;
    void chrome.runtime.sendMessage({ type: 'activity.read' } satisfies ConnectionMessage).then((raw: unknown) => {
      const view = validateActivityView(raw);
      if (!view?.ok) throw new Error('Activity unavailable');
      const relevant = view.entries.filter((entry) => !entry.data.test &&
        (entry.action === 'notification.selection' || entry.action === 'notification.system'));
      relevant.sort((a, b) => b.sequence - a.sequence);
      const latest = relevant[0]?.correlationId;
      if (mounted) { setEntries(relevant.filter((entry) => entry.correlationId === latest)); setError(false); }
    }).catch(() => { if (mounted) setError(true); });
    return () => { mounted = false; };
  }, [refreshToken]);
  return <div className="mt-4 rounded-lg border border-slate-200 p-3 text-sm">
    <h3 className="font-medium">Laatste meldingscontrole</h3>
    {error ? <p className="mt-2">De meldingsdiagnose kon niet worden geladen.</p> :
      entries === null ? <p className="mt-2">Diagnose laden…</p> :
      !entries.length ? <p className="mt-2">Nog geen bewaarde meldingsdiagnose. Klik op Nu controleren en open de instellingen opnieuw.</p> :
      <ul className="mt-2 space-y-2 text-slate-600">{entries.map((entry) => <li key={entry.sequence}>
        {new Date(entry.timestamp).toLocaleString('nl-BE', { timeZone: 'Europe/Brussels' })}: {notificationExplanation(entry)}
      </li>)}</ul>}
  </div>;
}
