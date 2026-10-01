import { SCHOOLWARE_ORIGIN } from './agenda-request';

export type AgendaCategory = 'tests' | 'assignments' | 'review' | 'other';
export type AgendaTypeCounts = Record<AgendaCategory, number>;

/** Evidence applies to the inspected installation, not every WISA deployment. */
export function classifyAgendaType(origin: string, typePunt: number): AgendaCategory {
  if (origin !== SCHOOLWARE_ORIGIN) return 'other';
  switch (typePunt) {
    case 101: return 'tests';
    case 1001: return 'assignments';
    // Type 2 includes both assignment-like instructions and ordinary lesson content.
    // Titles are not a reliable basis for resolving that ambiguity automatically.
    case 2: return 'review';
    default: return 'other';
  }
}

export function summarizeAgendaTypes(
  origin: string, points: readonly { TypePunt: number }[],
): AgendaTypeCounts {
  const counts: AgendaTypeCounts = { tests: 0, assignments: 0, review: 0, other: 0 };
  for (const point of points) counts[classifyAgendaType(origin, point.TypePunt)]++;
  return counts;
}
