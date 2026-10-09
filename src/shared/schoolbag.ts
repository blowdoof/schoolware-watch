import type { HistoryScope, Category } from '../domain/observations';
import type { BagAgenda, BagPoint } from '../domain/schoolbag';
import { isTaskStatus } from '../domain/tasks';
import { isAlertId } from './browser-alerts';
import { validateSpecialDays } from '../domain/special-days';

export interface SchoolbagView extends BagAgenda { ok: boolean; choices?: { id: string; day: string; state: 'packed' | 'hidden' }[] }

/** Latest active selection only: stale retained points cannot invent requirements. */
export function createSchoolbagView(scope: HistoryScope | null): SchoolbagView {
  return { ok: true, lastSuccessAt: scope?.lastSuccessAt ?? null,
    ...(scope?.schoolbagChoices ? { choices: scope.schoolbagChoices } : {}),
    ...(scope?.specialDays ? { specialDays: scope.specialDays } : {}),
    points: (scope?.items ?? []).filter((item) => item.localId && item.present && !item.snapshot.hidden &&
      !item.snapshot.cancelled && item.lastSeenAt === scope?.lastSuccessAt).map((item) => ({
      id: item.localId!, day: item.snapshot.startsAt.slice(0, 10), subject: item.lesson?.subject ?? '',
      title: item.snapshot.title, instructions: item.snapshot.instructions,
      category: item.category, typePunt: item.snapshot.typePunt, status: item.taskStatus ?? 'open',
    })) };
}

export function validateSchoolbagView(raw: unknown): SchoolbagView | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const view = raw as Record<string, unknown>;
  if (!Object.keys(view).every((key) => ['ok', 'points', 'lastSuccessAt', 'choices', 'specialDays'].includes(key)) || typeof view.ok !== 'boolean' || !Array.isArray(view.points) ||
      !(view.lastSuccessAt === null || (typeof view.lastSuccessAt === 'string' &&
        /^\d{4}-\d{2}-\d{2}T/.test(view.lastSuccessAt) && Number.isFinite(Date.parse(view.lastSuccessAt))))) return null;
  const points: BagPoint[] = [];
  const ids = new Set<string>();
  for (const raw of view.points) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const point = raw as Record<string, unknown>;
    if (Object.keys(point).length !== 8 || !isAlertId(point.id) || ids.has(point.id) ||
        typeof point.day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(point.day) ||
        !Number.isFinite(Date.parse(`${point.day}T00:00:00Z`)) ||
        new Date(`${point.day}T00:00:00Z`).toISOString().slice(0, 10) !== point.day ||
        typeof point.subject !== 'string' || typeof point.title !== 'string' || typeof point.instructions !== 'string' ||
        !['tests', 'assignments', 'review', 'other'].includes(point.category as string) ||
        typeof point.typePunt !== 'number' || !Number.isSafeInteger(point.typePunt) || point.typePunt < 0 || !isTaskStatus(point.status)) return null;
    ids.add(point.id);
    points.push({ id: point.id, day: point.day, subject: point.subject, title: point.title,
      instructions: point.instructions, category: point.category as Category, typePunt: point.typePunt, status: point.status });
  }
  if (view.lastSuccessAt === null && points.length) return null;
  let choices: SchoolbagView['choices'];
  if (Object.hasOwn(view, 'choices')) {
    if (!Array.isArray(view.choices) || view.choices.length > 5000) return null;
    choices = [];
    for (const entry of view.choices) {
      if (!entry || typeof entry !== 'object' || Object.keys(entry).length !== 3 ||
          typeof entry.id !== 'string' || !/^[a-f0-9]{64}$/.test(entry.id) || choices.some((choice) => choice.id === entry.id) ||
          typeof entry.day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(entry.day) ||
          !Number.isFinite(Date.parse(`${entry.day}T00:00:00Z`)) || new Date(`${entry.day}T00:00:00Z`).toISOString().slice(0, 10) !== entry.day ||
          !['packed', 'hidden'].includes(entry.state)) return null;
      choices.push({ id: entry.id, day: entry.day, state: entry.state });
    }
  }
  const specialDays = Object.hasOwn(view, 'specialDays') ? validateSpecialDays(view.specialDays) : undefined;
  if (specialDays === null) return null;
  return { ok: view.ok, points, lastSuccessAt: view.lastSuccessAt as string | null, ...(choices ? { choices } : {}), ...(specialDays ? { specialDays } : {}) };
}
