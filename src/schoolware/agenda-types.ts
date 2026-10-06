import { schoolwareOrigin } from './agenda-request';
import { agendaCategory } from '../domain/agenda-types';

export type AgendaCategory = 'tests' | 'assignments' | 'review' | 'other';
export type AgendaTypeCounts = Record<AgendaCategory, number>;

/** Classify validated installations using the publicly verified Schoolware ranges. */
export function classifyAgendaType(origin: string, typePunt: number): AgendaCategory {
  return schoolwareOrigin(origin) ? agendaCategory(typePunt) : 'other';
}

export function summarizeAgendaTypes(
  origin: string, points: readonly { TypePunt: number }[],
): AgendaTypeCounts {
  const counts: AgendaTypeCounts = { tests: 0, assignments: 0, review: 0, other: 0 };
  for (const point of points) counts[classifyAgendaType(origin, point.TypePunt)]++;
  return counts;
}
