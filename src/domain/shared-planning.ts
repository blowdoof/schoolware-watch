import type { HistoryScope } from './observations';
import type { SyncState } from '../shared/progress-sync';
import { sharedSpecialDay, planningResource } from '../shared/planning-sync';
import { MAX_SPECIAL_DAYS } from './special-days';

/** Apply only fully received, server-ordered values. Unsent local edits retain precedence until acknowledged. */
export function applySharedPlanning(scope: HistoryScope, state: SyncState, cutoff: string, today: string): boolean {
  const pending = new Set(state.planningOutbox?.flatMap((operation) => [operation.resource, ...(operation.relatedResources ?? [])]) ?? []);
  const records = Object.entries(state.planningRemote ?? {}).filter(([resource]) => !pending.has(resource));
  if (!records.length) return false;
  const original = JSON.stringify([scope.specialDays ?? [], [...(scope.schoolbagChoices ?? [])].sort((a, b) => a.id.localeCompare(b.id)), scope.planningActors ?? {}]);
  const actors = Object.fromEntries(Object.entries(scope.planningActors ?? {}).filter(([key, value]) => value.day >= (key.startsWith('packing:') ? today : cutoff.slice(0, 10))));
  const entries = structuredClone(scope.specialDays ?? []);
  const changedEntries = new Set<string>();
  let deleted = false;
  for (const [, record] of records) {
    const value = record.value;
    if (value.type !== 'special-day' || value.day < cutoff.slice(0, 10)) continue;
    const existing = entries.find((entry) => entry.day === value.day);
    if (value.entry === null) {
      if (existing) { entries.splice(entries.indexOf(existing), 1); deleted = true; }
    } else if (!existing || JSON.stringify(sharedSpecialDay(existing)) !== JSON.stringify(value.entry)) {
      const next = { ...value.entry, revision: existing ? existing.revision + 1 : 1,
        checklist: value.entry.checklist.map((point) => ({ ...point,
          done: existing?.id === value.entry!.id ? existing.checklist.find((old) => old.id === point.id)?.done ?? false : false })) };
      if (existing) entries.splice(entries.indexOf(existing), 1, next); else entries.push(next);
      changedEntries.add(next.id);
    }
  }
  for (const [, record] of records) {
    const value = record.value;
    if (value.type !== 'checklist') continue;
    const entry = entries.find((entry) => entry.id === value.eventId);
    const point = entry?.checklist.find((point) => point.id === value.pointId);
    if (entry && point) {
      if (value.actor) actors[planningResource(value)] = { actor: value.actor, day: entry.day };
      else delete actors[planningResource(value)];
    }
    if (entry && point && point.done !== value.done) {
      point.done = value.done;
      if (!changedEntries.has(entry.id)) { entry.revision++; changedEntries.add(entry.id); }
    }
  }
  if (entries.length > MAX_SPECIAL_DAYS) throw new Error('Shared special day limit');
  const clock = Math.max(scope.specialDayRevision ?? 0, ...(scope.specialDays ?? []).map((entry) => entry.revision), 0) + 1;
  if (!Number.isSafeInteger(clock)) throw new Error('Special day revision exhausted');
  if (changedEntries.size || deleted) for (const entry of entries) if (changedEntries.has(entry.id)) entry.revision = clock;
  const choices = new Map((scope.schoolbagChoices ?? []).filter((choice) => choice.day >= today).map((choice) => [choice.id, choice]));
  for (const [, record] of records) {
    const value = record.value;
    if (value.type !== 'packing' || value.day < today) continue;
    if (value.actor) actors[planningResource(value)] = { actor: value.actor, day: value.day };
    else delete actors[planningResource(value)];
    if (value.state === 'open') choices.delete(value.id);
    else choices.set(value.id, { id: value.id, day: value.day, state: value.state });
  }
  if (choices.size > 5000) throw new Error('Shared packing limit');
  const nextEntries = entries.sort((a, b) => a.day.localeCompare(b.day));
  const checklistResources = new Set(nextEntries.flatMap((entry) => entry.checklist.map((point) => `checklist:${entry.id}:${point.id}`)));
  for (const key of Object.keys(actors)) if (key.startsWith('checklist:') && !checklistResources.has(key)) delete actors[key];
  const nextChoices = [...choices.values()].sort((a, b) => a.id.localeCompare(b.id));
  if (Object.keys(actors).length > 13000) throw new Error('Attribution limit');
  if (JSON.stringify([nextEntries, nextChoices, actors]) === original) return false;
  scope.specialDays = nextEntries; scope.schoolbagChoices = nextChoices;
  scope.planningActors = actors;
  if (changedEntries.size || deleted) scope.specialDayRevision = clock;
  return true;
}
