import type { SpecialDay } from '../../src/domain/special-days';

export function specialDay(overrides: Partial<SpecialDay> = {}): SpecialDay {
  return { id: crypto.randomUUID(), revision: 0, day: '2026-10-12', kind: 'home-study', title: 'Synthetic home study',
    notes: 'Follow the ordinary timetable at home.', useTimetable: true, preparationDay: '2026-10-09',
    checklist: [{ id: crypto.randomUUID(), text: 'All folders and charger', done: false, pack: true }], ...overrides };
}
