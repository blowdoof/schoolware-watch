import { isAlertId } from './browser-alerts';

export interface TaskHelp { needed: boolean; recipients: string[]; requestId: string }
export function isHelpRecipients(value: unknown): value is string[] {
  return Array.isArray(value) && value.length <= 49 && value.every(isAlertId) && new Set(value).size === value.length;
}
export function validateTaskHelp(raw: unknown): TaskHelp | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const v = raw as Record<string, unknown>;
  return Object.keys(v).length === 3 && typeof v.needed === 'boolean' && isHelpRecipients(v.recipients) &&
    isAlertId(v.requestId) && (v.needed || !v.recipients.length) ?
    { needed: v.needed, recipients: [...v.recipients], requestId: v.requestId } : null;
}
