import { requestUrl } from './agenda-request';
import type { CheckInput, ObservationPoint } from '../../src/domain/observations';

export const point: ObservationPoint = { sourceKey: 'synthetic-source-1', category: 'assignments',
  snapshot: { title: 'Synthetic assignment', instructions: 'Synthetic instructions', typePunt: 1001,
    startsAt: '2026-10-05 09:00:00', endsAt: '2026-10-05 09:50:00', validFrom: '2026-09-01 00:00:00',
    hidden: false, cancelled: false, recurrence: '' } };

export function check(overrides: Partial<CheckInput> = {}): CheckInput {
  return { scopeId: requestUrl, checkId: 'synthetic-check-1',
    observedAt: '2026-10-02T08:00:00.000Z', points: [structuredClone(point)], complete: false,
    identityVerified: false, ...overrides };
}
