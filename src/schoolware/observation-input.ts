import type { CheckInput } from '../domain/observations';
import type { AgendaPoint } from './agenda-response';
import { classifyAgendaType } from './agenda-types';
import { validateAgendaRequest } from './agenda-request';

export function createObservationInput(requestUrl: string, points: AgendaPoint[], checkId: string, observedAt: string): CheckInput {
  const scopeId = validateAgendaRequest(requestUrl);
  if (!scopeId) throw new Error('Invalid observation scope');
  return { scopeId, checkId, observedAt, complete: false, identityVerified: false,
    points: points.map((point) => ({
      // Exact observed source tuples only. No claim of a stable entity key or
      // merging across recurrences, changed IDs, profiles or agenda selections.
      // The worker resolves calendar-window changes to an existing profile first.
      sourceKey: JSON.stringify([point.ID, point.AgendaID, point.UniekAgendaPuntID,
        point.OrigineelPuntID ?? null, point.HerhaaldAgendaPuntID ?? null]),
      category: classifyAgendaType(new URL(scopeId).origin, point.TypePunt),
      lesson: { key: JSON.stringify([point.AgendaID, point.LesDataID || null]),
        subject: point.VakNaam ?? '', room: [point.LokaalCode, point.LokaalOmschrijving]
          .filter((value, index, values) => value && values.indexOf(value) === index).join(' · ') },
      snapshot: { title: point.Titel, instructions: point.PublicComment ?? '', typePunt: point.TypePunt,
        startsAt: point.Van, endsAt: point.Tot, validFrom: point.GeldigVan,
        hidden: point.Verborgen ?? false, cancelled: point.Vervalt ?? false, recurrence: point.Herhaling ?? '' },
    })) };
}
