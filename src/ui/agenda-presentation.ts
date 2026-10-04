import type { Snapshot } from '../domain/observations';

export const snapshotLabels: Record<keyof Snapshot, string> = { title: 'Titel', instructions: 'Instructies', typePunt: 'Soort punt',
  startsAt: 'Van', endsAt: 'Tot', validFrom: 'Geldig vanaf', hidden: 'Verborgen', cancelled: 'Vervallen', recurrence: 'Herhaling' };

export function displaySnapshotValue(field: keyof Snapshot, value: Snapshot[keyof Snapshot]): string {
  if (typeof value === 'boolean') return value ? 'Ja' : 'Nee';
  if (field !== 'instructions') return String(value);
  // Render as text, never HTML: source markup must not execute or load resources.
  return String(value).replace(/<br\s*\/?\s*>|<\/p>/gi, '\n').replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&amp;/gi, '&');
}
