import type { HistoryScope, Snapshot } from '../domain/observations';
import { isTaskCategory, isTaskStatus, type TaskStatus } from '../domain/tasks';
import { isAlertId } from './browser-alerts';
import { validateSnapshot } from './history';
import { validateTaskHelp, type TaskHelp } from './task-help';
import type { SyncState } from './progress-sync';
import { normalizeSyncLabel } from './progress-sync';
import type { CompatibilityIssue } from './sync-compatibility';
import { isActionStamp, isTaskReview, type ActionStamp, type TaskReview } from './participation';
import { progressVersionText } from '../domain/progress-sync';

export const MAX_TASK_UPDATES = 5000;

export interface TaskEntry {
  id: string; category: 'tests' | 'assignments' | 'review'; snapshot: Snapshot; subject: string; room: string;
  status: TaskStatus; updatedAt: string | null; firstSeenAt: string; lastSeenAt: string;
  help?: TaskHelp; helpForYou?: boolean;
  statusActor?: ActionStamp; helpActor?: ActionStamp;
  reviews?: (TaskReview & { self: boolean; previous: boolean })[];
  missingFromLatestCheck?: boolean;
}
export interface TaskAgenda { days: string[]; lastSuccessAt: string }
export interface TasksView { ok: boolean; entries: TaskEntry[]; agenda?: TaskAgenda; helpRecipients?: { id: string; label: string }[]; helpMembersError?: boolean; syncIssue?: CompatibilityIssue }
export function createTasksView(scope: HistoryScope | null, sync?: SyncState): TasksView {
  const sharing = sync?.scopeId === scope?.scopeId ? sync : undefined;
  return { ok: true, ...(sharing?.compatibility?.issue ? { syncIssue: sharing.compatibility.issue } : {}), ...(sharing ? { helpRecipients: (sharing.members ?? []).filter((member) => member.id !== sharing.connectionId)
    .map(({ id, label }) => ({ id, label })), helpMembersError: sharing.membersError ?? false } : {}), ...(scope ? { agenda: {
    // Only positive evidence from the latest successful response. Retained items
    // missing from an incomplete response must not invent a future school day.
    days: [...new Set(scope.items.filter((item) => item.present && !item.snapshot.hidden && !item.snapshot.cancelled &&
      item.lastSeenAt === scope.lastSuccessAt).map((item) => item.snapshot.startsAt.slice(0, 10)))].sort(),
    lastSuccessAt: scope.lastSuccessAt,
  } } : {}), entries: (scope?.items ?? []).filter((item) => item.present && !item.snapshot.hidden && !item.snapshot.cancelled && isTaskCategory(item.category) && item.localId)
    .map((item) => ({ id: item.localId!, category: item.category as TaskEntry['category'], snapshot: item.snapshot,
      subject: item.lesson?.subject ?? '', room: item.lesson?.room ?? '', status: item.taskStatus ?? 'open',
      updatedAt: item.taskUpdatedAt ?? null, firstSeenAt: item.firstSeenAt, lastSeenAt: item.lastSeenAt,
      ...(item.lastSeenAt !== scope!.lastSuccessAt && scope!.checks.some((check) => check.coverage &&
        check.observedAt > item.lastSeenAt && check.observedAt <= scope!.lastSuccessAt &&
        item.snapshot.startsAt.slice(0, 10) > check.coverage.minTot &&
        item.snapshot.endsAt.slice(0, 10) < check.coverage.maxVan) ? { missingFromLatestCheck: true } : {}),
      ...(item.statusActor ? { statusActor: item.statusActor } : {}), ...(item.helpActor ? { helpActor: item.helpActor } : {}),
      ...(item.reviews ? { reviews: item.reviews.map((review) => ({ ...review, self: review.actor.participantId === scope!.localId,
        previous: item.reviewContent !== progressVersionText(item.snapshot) || review.version !== item.reviewVersion })) } : {}),
      ...(item.taskHelp ? { help: item.taskHelp, helpForYou: Boolean(sharing && item.taskHelp.needed && item.taskHelp.recipients.includes(sharing.connectionId)) } : {}) }))
    .sort((a, b) => a.snapshot.startsAt.localeCompare(b.snapshot.startsAt) || a.snapshot.title.localeCompare(b.snapshot.title)) };
}
export function validateTasksView(value: unknown): TasksView | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const view = value as Record<string, unknown>;
  if (typeof view.ok !== 'boolean' || !Array.isArray(view.entries)) return null;
  if (view.syncIssue !== undefined && !['update-required', 'server-update-required', 'check-unavailable'].includes(view.syncIssue as string)) return null;
  if (view.helpMembersError !== undefined && typeof view.helpMembersError !== 'boolean') return null;
  if (view.helpRecipients !== undefined && (!Array.isArray(view.helpRecipients) || view.helpRecipients.length > 49 ||
      !view.helpRecipients.every((raw: unknown) => {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
        const v = raw as Record<string, unknown>;
        return Object.keys(v).length === 2 && isAlertId(v.id) && typeof v.label === 'string' && normalizeSyncLabel(v.label) === v.label;
      }) || new Set(view.helpRecipients.map((v) => (v as { id: string }).id)).size !== view.helpRecipients.length)) return null;
  const entries: TaskEntry[] = [];
  const timestamp = (raw: unknown): raw is string => typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(raw) && Number.isFinite(Date.parse(raw));
  let agenda: TaskAgenda | undefined;
  if (Object.hasOwn(view, 'agenda')) {
    const raw = view.agenda;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const value = raw as Record<string, unknown>;
    const days = value.days;
    if (Object.keys(value).length !== 2 || !timestamp(value.lastSuccessAt) || !Array.isArray(days) ||
        !days.every((day): day is string => typeof day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day) &&
          Number.isFinite(Date.parse(`${day}T00:00:00Z`)) && new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) === day) ||
        days.some((day, index) => index > 0 && day <= days[index - 1]!)) return null;
    agenda = { days: [...days], lastSuccessAt: value.lastSuccessAt };
  }
  for (const raw of view.entries) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const item = raw as Record<string, unknown>;
    if (item.missingFromLatestCheck !== undefined && typeof item.missingFromLatestCheck !== 'boolean') return null;
    if ((item.statusActor !== undefined && !isActionStamp(item.statusActor)) || (item.helpActor !== undefined && !isActionStamp(item.helpActor))) return null;
    if (item.reviews !== undefined && (!Array.isArray(item.reviews) || item.reviews.length > 200 || !item.reviews.every((raw: unknown) => {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
      const { self, previous, ...review } = raw as Record<string, unknown>;
      return typeof self === 'boolean' && typeof previous === 'boolean' && isTaskReview(review);
    }))) return null;
    const snapshot = validateSnapshot(item.snapshot);
    const help = item.help === undefined ? undefined : validateTaskHelp(item.help);
    if (help === null || (item.helpForYou !== undefined && typeof item.helpForYou !== 'boolean') || (item.helpForYou && !help?.needed)) return null;
    if (!isAlertId(item.id) || entries.some((entry) => entry.id === item.id) || !isTaskCategory(item.category as string) ||
        !snapshot || typeof item.subject !== 'string' || typeof item.room !== 'string' || !isTaskStatus(item.status) ||
        !(item.updatedAt === null || timestamp(item.updatedAt)) || !timestamp(item.firstSeenAt) || !timestamp(item.lastSeenAt)) return null;
    entries.push({ id: item.id, category: item.category as TaskEntry['category'], snapshot, subject: item.subject, room: item.room,
      status: item.status, updatedAt: item.updatedAt as string | null, firstSeenAt: item.firstSeenAt, lastSeenAt: item.lastSeenAt,
      ...(item.missingFromLatestCheck !== undefined ? { missingFromLatestCheck: item.missingFromLatestCheck as boolean } : {}),
      ...(item.statusActor ? { statusActor: item.statusActor as ActionStamp } : {}), ...(item.helpActor ? { helpActor: item.helpActor as ActionStamp } : {}),
      ...(item.reviews ? { reviews: item.reviews as NonNullable<TaskEntry['reviews']> } : {}),
      ...(help ? { help, ...(item.helpForYou !== undefined ? { helpForYou: item.helpForYou as boolean } : {}) } : {}) });
  }
  return { ok: view.ok, entries, ...(agenda ? { agenda } : {}),
    ...(view.syncIssue !== undefined ? { syncIssue: view.syncIssue as CompatibilityIssue } : {}),
    ...(view.helpRecipients !== undefined ? { helpRecipients: view.helpRecipients as NonNullable<TasksView['helpRecipients']> } : {}),
    ...(view.helpMembersError !== undefined ? { helpMembersError: view.helpMembersError as boolean } : {}) };
}
