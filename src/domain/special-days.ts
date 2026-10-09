import { isAlertId } from '../shared/browser-alerts';

export const SPECIAL_DAY_KINDS = ['home-study', 'sports', 'trip', 'other'] as const;
export interface SpecialDay {
  id: string; revision: number; day: string; kind: typeof SPECIAL_DAY_KINDS[number];
  title: string; notes: string; useTimetable: boolean; preparationDay: string | null;
  checklist: { id: string; text: string; done: boolean; pack: boolean }[];
}
export const MAX_SPECIAL_DAYS = 200;
export function isDay(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}
const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
export function validateSpecialDay(raw: unknown): SpecialDay | null {
  if (!record(raw) || Object.keys(raw).length !== 9 || !isAlertId(raw.id) ||
      !Number.isSafeInteger(raw.revision) || (raw.revision as number) < 0 || !isDay(raw.day) ||
      !SPECIAL_DAY_KINDS.includes(raw.kind as SpecialDay['kind']) || typeof raw.title !== 'string' ||
      !raw.title.trim() || raw.title.length > 120 || typeof raw.notes !== 'string' || raw.notes.length > 4000 ||
      typeof raw.useTimetable !== 'boolean' || !(raw.preparationDay === null || (isDay(raw.preparationDay) && raw.preparationDay <= raw.day)) ||
      !Array.isArray(raw.checklist) || raw.checklist.length > 40) return null;
  const checklist: SpecialDay['checklist'] = [];
  for (const entry of raw.checklist) {
    if (!record(entry) || Object.keys(entry).length !== 4 || !isAlertId(entry.id) || checklist.some((item) => item.id === entry.id) ||
        typeof entry.text !== 'string' || !entry.text.trim() || entry.text.length > 200 || typeof entry.done !== 'boolean' || typeof entry.pack !== 'boolean') return null;
    checklist.push({ id: entry.id, text: entry.text, done: entry.done, pack: entry.pack });
  }
  return { id: raw.id, revision: raw.revision as number, day: raw.day, kind: raw.kind as SpecialDay['kind'],
    title: raw.title, notes: raw.notes, useTimetable: raw.useTimetable, preparationDay: raw.preparationDay as string | null, checklist };
}
export function validateSpecialDays(raw: unknown): SpecialDay[] | null {
  if (!Array.isArray(raw) || raw.length > MAX_SPECIAL_DAYS) return null;
  const entries: SpecialDay[] = [];
  for (const value of raw) {
    const entry = validateSpecialDay(value);
    if (!entry || entries.some((item) => item.id === entry.id || item.day === entry.day)) return null;
    entries.push(entry);
  }
  return entries.sort((a, b) => a.day.localeCompare(b.day));
}
