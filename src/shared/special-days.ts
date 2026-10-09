import { validateSpecialDay, validateSpecialDays, type SpecialDay } from '../domain/special-days';
import { isAlertId } from './browser-alerts';

export type SpecialDaysMessage = { type: 'specialDays.read' } | { type: 'specialDays.save'; profileId: string; entry: SpecialDay } |
  { type: 'specialDays.delete'; profileId: string; id: string; revision: number };
export interface SpecialDaysView { ok: boolean; connected: boolean; profileId: string | null; entries: SpecialDay[] }
export function validateSpecialDaysMessage(raw: unknown): SpecialDaysMessage | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  if (value.type === 'specialDays.read' && Object.keys(value).length === 1) return { type: value.type };
  if (value.type === 'specialDays.save' && Object.keys(value).length === 3 && isAlertId(value.profileId)) {
    const entry = validateSpecialDay(value.entry);
    if (entry) return { type: value.type, profileId: value.profileId, entry };
  }
  if (value.type === 'specialDays.delete' && Object.keys(value).length === 4 && isAlertId(value.profileId) && isAlertId(value.id) &&
      Number.isSafeInteger(value.revision) && (value.revision as number) > 0) return { type: value.type, profileId: value.profileId, id: value.id, revision: value.revision as number };
  return null;
}
export function validateSpecialDaysView(raw: unknown): SpecialDaysView | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  const entries = validateSpecialDays(value.entries);
  return Object.keys(value).length === 4 && typeof value.ok === 'boolean' && typeof value.connected === 'boolean' && entries &&
    (value.connected ? isAlertId(value.profileId) : value.profileId === null && entries.length === 0) ?
    { ok: value.ok, connected: value.connected, profileId: value.profileId as string | null, entries } : null;
}
