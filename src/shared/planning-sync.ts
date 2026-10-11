import { isAlertId } from './browser-alerts';
import { validateTaskHelp, type TaskHelp } from './task-help';
import { isAppVersion, type CompatibilityIssue } from './sync-compatibility';
import { isActionStamp, isTaskReview, type ActionStamp, type TaskReview } from './participation';
import { isDay, validateSpecialDay, type SpecialDay } from '../domain/special-days';

export type SharedSpecialDay = Omit<SpecialDay, 'revision' | 'checklist'> & { checklist: Omit<SpecialDay['checklist'][number], 'done'>[] };
export type PlanningValue = { type: 'task-review'; item: string; review: TaskReview } | { type: 'device-version'; deviceId: string; version: string; protocol: number; reportedAt: string } | { type: 'help'; item: string; help: TaskHelp; actor?: ActionStamp } | { type: 'special-day'; day: string; entry: SharedSpecialDay | null } |
  { type: 'special-day-move'; previousDay: string; entry: SharedSpecialDay } |
  { type: 'checklist'; eventId: string; pointId: string; done: boolean; actor?: ActionStamp } |
  { type: 'packing'; id: string; day: string; state: 'open' | 'packed' | 'hidden'; actor?: ActionStamp };
export interface PlanningFragment { kind: 'planning-part'; batch: string; index: number; count: number; data: string }
export interface PlanningOperation { id: string; resource: string; fragment: PlanningFragment; relatedResources?: string[] }
export interface PlanningRecord { value: PlanningValue; seed: boolean; revision: number }
export interface PlanningAssembly { count: number; parts: Record<string, string>; revision: number }
export interface PlanningSharingStatus { enabled: boolean; pending: number; lastSuccessAt: string | null; error: boolean; receiving?: boolean; issue?: CompatibilityIssue }
export function validatePlanningSharingStatus(raw: unknown): PlanningSharingStatus | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const v = raw as Record<string, unknown>;
  return Object.keys(v).length === 4 + (Object.hasOwn(v, 'receiving') ? 1 : 0) + (Object.hasOwn(v, 'issue') ? 1 : 0) &&
    (!Object.hasOwn(v, 'issue') || ['update-required', 'server-update-required', 'check-unavailable'].includes(v.issue as string)) &&
    (!Object.hasOwn(v, 'receiving') || typeof v.receiving === 'boolean') && typeof v.enabled === 'boolean' && typeof v.error === 'boolean' &&
    Number.isSafeInteger(v.pending) && (v.pending as number) >= 0 && (v.lastSuccessAt === null ||
      typeof v.lastSuccessAt === 'string' && Number.isFinite(Date.parse(v.lastSuccessAt))) ? v as unknown as PlanningSharingStatus : null;
}
export function sharedSpecialDay(entry: SpecialDay): SharedSpecialDay {
  return { id: entry.id, day: entry.day, kind: entry.kind, title: entry.title, notes: entry.notes,
    useTimetable: entry.useTimetable, preparationDay: entry.preparationDay,
    checklist: entry.checklist.map((point) => ({ id: point.id, text: point.text, pack: point.pack })) };
}
export function planningResource(value: PlanningValue): string {
  if (value.type === 'task-review') return `review:${value.item}:${value.review.version}:${value.review.kind}:${value.review.actor.participantId}`;
  if (value.type === 'device-version') return `device:${value.deviceId}`;
  if (value.type === 'help') return `help:${value.item}`;
  return value.type === 'special-day' ? `special:${value.day}` : value.type === 'special-day-move' ? `move:${value.previousDay}:${value.entry.day}` : value.type === 'checklist' ?
    `checklist:${value.eventId}:${value.pointId}` : `packing:${value.id}`;
}
export function validatePlanningValue(raw: unknown): PlanningValue | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const v = raw as Record<string, unknown>;
  const actor = v.actor === undefined ? {} : { actor: v.actor as ActionStamp };
  if (v.actor !== undefined && !isActionStamp(v.actor)) return null;
  if (v.type === 'task-review' && Object.keys(v).length === 3 && typeof v.item === 'string' && /^[a-f0-9]{64}$/.test(v.item) && isTaskReview(v.review))
    return { type: v.type, item: v.item, review: v.review };
  if (v.type === 'device-version' && Object.keys(v).length === 5 && isAlertId(v.deviceId) && isAppVersion(v.version) && Number.isSafeInteger(v.protocol) &&
      (v.protocol as number) > 0 && (v.protocol as number) <= 1000 && typeof v.reportedAt === 'string' && Number.isFinite(Date.parse(v.reportedAt)))
    return { type: v.type, deviceId: v.deviceId, version: v.version, protocol: v.protocol as number, reportedAt: v.reportedAt };
  if (v.type === 'help' && Object.keys(v).length === (v.actor === undefined ? 3 : 4) && typeof v.item === 'string' && /^[a-f0-9]{64}$/.test(v.item)) {
    const help = validateTaskHelp(v.help);
    if (help) return { type: 'help', item: v.item, help, ...actor };
    return null;
  }
  if (v.type === 'special-day-move' && Object.keys(v).length === 3 && isDay(v.previousDay) && v.entry && typeof v.entry === 'object') {
    const entry = v.entry as Record<string, unknown>;
    const validated = validatePlanningValue({ type: 'special-day', day: entry.day, entry });
    if (validated?.type === 'special-day' && validated.entry && validated.day !== v.previousDay)
      return { type: v.type, previousDay: v.previousDay, entry: validated.entry };
    return null;
  }
  if (v.type === 'special-day' && Object.keys(v).length === 3 && isDay(v.day)) {
    if (v.entry === null) return { type: v.type, day: v.day, entry: null };
    if (!v.entry || typeof v.entry !== 'object' || Array.isArray(v.entry)) return null;
    const entry = v.entry as Record<string, unknown>;
    if (Object.keys(entry).length !== 8 || !Array.isArray(entry.checklist) || entry.checklist.some((point) =>
      !point || typeof point !== 'object' || Array.isArray(point) || Object.keys(point).length !== 3)) return null;
    const validated = validateSpecialDay({ ...entry, revision: 0, checklist: entry.checklist.map((point) => ({ ...point, done: false })) });
    if (validated && validated.day === v.day) return { type: v.type, day: v.day, entry: sharedSpecialDay(validated) };
  }
  if (v.type === 'checklist' && Object.keys(v).length === (v.actor === undefined ? 4 : 5) && isAlertId(v.eventId) && isAlertId(v.pointId) && typeof v.done === 'boolean')
    return { type: v.type, eventId: v.eventId, pointId: v.pointId, done: v.done, ...actor };
  if (v.type === 'packing' && Object.keys(v).length === (v.actor === undefined ? 4 : 5) && typeof v.id === 'string' && /^[a-f0-9]{64}$/.test(v.id) &&
      isDay(v.day) && ['open', 'packed', 'hidden'].includes(v.state as string)) return { type: v.type, id: v.id, day: v.day, state: v.state as 'open' | 'packed' | 'hidden', ...actor };
  return null;
}
/** Fit the existing 512-byte padded plaintext and PHP ciphertext limits without a server migration. */
export function planningOperations(value: PlanningValue, seed = false): PlanningOperation[] {
  if (!validatePlanningValue(value)) throw new Error('Invalid shared planning');
  const bytes = new TextEncoder().encode(JSON.stringify({ value, seed }));
  const count = Math.ceil(bytes.length / 256);
  if (count > 192) throw new Error('Shared planning size limit');
  const batch = crypto.randomUUID();
  return Array.from({ length: count }, (_, index) => ({ id: crypto.randomUUID(), resource: planningResource(value),
    ...(value.type === 'special-day-move' ? { relatedResources: [`special:${value.previousDay}`, `special:${value.entry.day}`] } : {}),
    fragment: { kind: 'planning-part', batch, index, count,
      data: btoa(String.fromCharCode(...bytes.slice(index * 256, (index + 1) * 256))) } }));
}
export function isPlanningFragment(raw: unknown): raw is PlanningFragment {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
  const v = raw as Record<string, unknown>;
  return Object.keys(v).length === 5 && v.kind === 'planning-part' && isAlertId(v.batch) && Number.isSafeInteger(v.index) &&
    Number.isSafeInteger(v.count) && (v.count as number) >= 1 && (v.count as number) <= 192 && (v.index as number) >= 0 &&
    (v.index as number) < (v.count as number) && typeof v.data === 'string' && v.data.length <= 344 &&
    /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(v.data) && v.data.length > 0 && atob(v.data).length <= 256;
}
export function assemblePlanning(assembly: PlanningAssembly): Omit<PlanningRecord, 'revision'> {
  const chunks = Array.from({ length: assembly.count }, (_, index) => atob(assembly.parts[index]!));
  const bytes = Uint8Array.from(chunks.join(''), (character) => character.charCodeAt(0));
  const raw: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).length !== 2) throw new Error('Invalid shared planning');
  const v = raw as Record<string, unknown>;
  const value = validatePlanningValue(v.value);
  if (!value || typeof v.seed !== 'boolean') throw new Error('Invalid shared planning');
  return { value, seed: v.seed };
}
