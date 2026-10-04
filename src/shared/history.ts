import type { Category, EventKind, HistoryScope, ObservationCounts, Snapshot } from '../domain/observations';

export interface HistoryEntry {
  id: string; kind: EventKind; category: Category; observedAt: string;
  before: Snapshot | null; after: Snapshot | null; fields: (keyof Snapshot)[];
  taskReopened?: boolean;
}
export interface HistoryView {
  ok: boolean; retentionDays: number; baselineAt: string | null; lastSuccessAt: string | null;
  itemCount: number; eventCount: number; entries: HistoryEntry[]; lastCounts: ObservationCounts | null;
}

export function createHistoryView(scope: HistoryScope | null, retentionDays: number, category: Category | 'all' = 'all'): HistoryView {
  const events = (scope?.events ?? []).filter((event) => category === 'all' || event.category === category);
  return { ok: true, retentionDays, baselineAt: scope?.baselineAt ?? null,
    lastSuccessAt: scope?.lastSuccessAt ?? null, itemCount: scope?.items.length ?? 0,
    eventCount: events.length, lastCounts: scope?.checks.at(-1)?.counts ?? null,
    // Item keys and profile IDs stay in the repository. Send only display fields.
    entries: events.slice(-100).reverse().map((event, index) => ({
      id: `${event.observedAt}-${index}`, kind: event.kind, category: event.category,
      observedAt: event.observedAt, before: event.before, after: event.after, fields: event.fields,
      ...(event.taskReopened ? { taskReopened: true } : {}),
    })) };
}

const kinds = ['baseline', 'observed', 'changed', 'disappeared', 'reappeared'] as const;
const categories = ['tests', 'assignments', 'review', 'other'] as const;
const snapshotFields = ['title', 'instructions', 'typePunt', 'startsAt', 'endsAt', 'validFrom', 'hidden', 'cancelled', 'recurrence'] as const;
const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const natural = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const timestamp = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value));

export function validateSnapshot(value: unknown): Snapshot | null | false {
  if (value === null) return null;
  if (!object(value)) return false;
  for (const key of ['title', 'instructions', 'startsAt', 'endsAt', 'validFrom', 'recurrence'] as const) {
    if (typeof value[key] !== 'string') return false;
  }
  if (!natural(value.typePunt) || typeof value.hidden !== 'boolean' || typeof value.cancelled !== 'boolean') return false;
  return { title: value.title as string, instructions: value.instructions as string, typePunt: value.typePunt,
    startsAt: value.startsAt as string, endsAt: value.endsAt as string, validFrom: value.validFrom as string,
    recurrence: value.recurrence as string, hidden: value.hidden, cancelled: value.cancelled };
}

export function validateHistoryView(value: unknown): HistoryView | null {
  if (!object(value) || typeof value.ok !== 'boolean' || ![30, 90, 180, 365].includes(value.retentionDays as number) ||
      (value.baselineAt !== null && !timestamp(value.baselineAt)) || (value.lastSuccessAt !== null && !timestamp(value.lastSuccessAt)) ||
      !natural(value.itemCount) || !natural(value.eventCount) || !Array.isArray(value.entries) || value.entries.length > 100) return null;
  let lastCounts: ObservationCounts | null = null;
  if (value.lastCounts !== null) {
    if (!object(value.lastCounts)) return null;
    lastCounts = { baseline: 0, observed: 0, changed: 0, disappeared: 0, reappeared: 0 };
    for (const kind of kinds) { if (!natural(value.lastCounts[kind])) return null; lastCounts[kind] = value.lastCounts[kind]; }
  }
  const entries: HistoryEntry[] = [];
  for (const item of value.entries) {
    if (!object(item) || typeof item.id !== 'string' || !kinds.includes(item.kind as EventKind) ||
        !categories.includes(item.category as Category) || !timestamp(item.observedAt) || !Array.isArray(item.fields) ||
        !item.fields.every((field) => snapshotFields.includes(field)) ||
        (Object.hasOwn(item, 'taskReopened') && typeof item.taskReopened !== 'boolean')) return null;
    const before = validateSnapshot(item.before); const after = validateSnapshot(item.after);
    if (before === false || after === false) return null;
    entries.push({ id: item.id, kind: item.kind as EventKind, category: item.category as Category,
      observedAt: item.observedAt, before, after, fields: item.fields as (keyof Snapshot)[],
      ...(Object.hasOwn(item, 'taskReopened') ? { taskReopened: item.taskReopened as boolean } : {}) });
  }
  return { ok: value.ok, retentionDays: value.retentionDays as number, baselineAt: value.baselineAt as string | null,
    lastSuccessAt: value.lastSuccessAt as string | null, itemCount: value.itemCount, eventCount: value.eventCount, entries, lastCounts };
}
