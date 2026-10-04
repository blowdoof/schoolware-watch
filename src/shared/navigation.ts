export type MainPage = 'dashboard' | 'options';
export interface OpenPageMessage { type: 'ui.open'; page: MainPage }
export interface OpenPageResult { ok: boolean }

export function validateOpenPageMessage(value: unknown): OpenPageMessage | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const message = value as Record<string, unknown>;
  return Object.keys(message).length === 2 && message.type === 'ui.open' &&
    (message.page === 'dashboard' || message.page === 'options') ?
    { type: 'ui.open', page: message.page } : null;
}
