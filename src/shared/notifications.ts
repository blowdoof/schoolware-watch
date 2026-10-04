export type NotificationTestStatus = 'accepted' | 'permission-required' | 'blocked' | 'api-error';
export interface NotificationTestResult {
  status: NotificationTestStatus;
  permissionLevel: 'granted' | 'denied' | 'unknown';
  registered: boolean | null;
}

export function validateNotificationTestResult(value: unknown): NotificationTestResult | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const data = value as Record<string, unknown>;
  if (!['accepted', 'permission-required', 'blocked', 'api-error'].includes(data.status as string) ||
      !['granted', 'denied', 'unknown'].includes(data.permissionLevel as string) ||
      !(data.registered === null || typeof data.registered === 'boolean') ||
      (data.status !== 'accepted' && data.registered !== null) ||
      (data.status === 'blocked' && data.permissionLevel !== 'denied')) return null;
  return { status: data.status as NotificationTestStatus,
    permissionLevel: data.permissionLevel as NotificationTestResult['permissionLevel'], registered: data.registered as boolean | null };
}

export function notificationTestMessage(result: NotificationTestResult): string {
  if (result.status === 'permission-required') return 'Chrome heeft geen toestemming voor meldingen aan de extensie gegeven.';
  if (result.status === 'blocked') return 'Chrome meldt dat meldingen voor Schoolware Watch geblokkeerd zijn. Controleer de meldingsinstellingen.';
  if (result.status === 'api-error') return 'Chrome kon de testmelding niet aanmaken. Herlaad de extensie en probeer opnieuw.';
  const registry = result.registered === true ? 'De testmelding staat in de meldingenlijst van Chrome.' :
    result.registered === false ? 'De testmelding staat niet in de meldingenlijst van Chrome; ze kan al gesloten zijn.' :
      'De meldingenlijst van Chrome kon niet worden gecontroleerd.';
  return `Chrome heeft de testmelding aangemaakt. ${registry} Dit bevestigt niet dat je besturingssysteem de pop-up toont. Controleer het meldingencentrum, de meldingsinstellingen voor Google Chrome en eventuele Niet storen- of focusinstellingen.`;
}
