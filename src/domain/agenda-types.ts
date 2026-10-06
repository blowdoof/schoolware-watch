/** Fixed category ranges verified in two independently hosted Schoolware frontends. */
export function agendaCategory(typePunt: number): 'tests' | 'assignments' | 'review' | 'other' {
  if (!Number.isSafeInteger(typePunt)) return 'other';
  if (typePunt >= 100 && typePunt < 1000) return 'tests';
  if (typePunt >= 1000 && typePunt < 2000) return 'assignments';
  // An attention point is marked content, without asserting a test/task meaning.
  return typePunt === 9 ? 'review' : 'other';
}
