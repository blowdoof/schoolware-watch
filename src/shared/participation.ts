import { isAlertId } from './browser-alerts';
import type { SyncState } from './progress-sync';

/** Self-reported computer attribution, not authenticated personal identity. */
export interface ActionStamp { participantId: string; deviceId: string | null; label: string | null; at: string }
export interface TaskReview { version: string; kind: 'checked' | 'corrected'; done: boolean; actor: ActionStamp }
export function isActionStamp(raw: unknown): raw is ActionStamp {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
  const v = raw as Record<string, unknown>;
  return Object.keys(v).length === 4 && isAlertId(v.participantId) && (v.deviceId === null || isAlertId(v.deviceId)) &&
    (v.label === null || (typeof v.label === 'string' && v.label.length > 0 && v.label.length <= 48 && v.label === v.label.trim().normalize('NFC') && !/[\p{Cc}\p{Cf}]/u.test(v.label))) &&
    typeof v.at === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v.at) && Number.isFinite(Date.parse(v.at));
}
export function isTaskReview(raw: unknown): raw is TaskReview {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
  const v = raw as Record<string, unknown>;
  return Object.keys(v).length === 4 && typeof v.version === 'string' && /^[a-f0-9]{64}$/.test(v.version) &&
    ['checked', 'corrected'].includes(v.kind as string) && typeof v.done === 'boolean' && isActionStamp(v.actor);
}
export function actionStamp(participantId: string, state?: SyncState): ActionStamp {
  return { participantId, deviceId: state?.connectionId ?? null, label: state?.displayName ?? null, at: new Date().toISOString() };
}
export function reviewIdentity(review: TaskReview): string {
  return `${review.version}:${review.kind}:${review.actor.participantId}`;
}
/** Keep current controls (including withdrawals), then the most recent history. */
export function boundedReviews(reviews: TaskReview[], currentVersion: string): TaskReview[] {
  return [...new Map(reviews.map((review) => [reviewIdentity(review), review])).values()]
    .sort((a, b) => Number(b.version === currentVersion) - Number(a.version === currentVersion) ||
      Date.parse(b.actor.at) - Date.parse(a.actor.at) || reviewIdentity(a).localeCompare(reviewIdentity(b)))
    .slice(0, 200);
}
export function isActorMap(raw: unknown): raw is Record<string, ActionStamp> {
  return Boolean(raw && typeof raw === 'object' && !Array.isArray(raw) && Object.keys(raw).length <= 13000 &&
    Object.entries(raw).every(([key, actor]) => /^(?:packing:[a-f0-9]{64}|checklist:[a-f0-9-]{36}:[a-f0-9-]{36})$/.test(key) && isActionStamp(actor)));
}
