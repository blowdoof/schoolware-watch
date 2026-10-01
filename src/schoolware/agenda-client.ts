import { parseAgendaResponse } from './agenda-response';
import { validateAgendaRequest } from './agenda-request';
import { summarizeAgendaTypes, type AgendaTypeCounts } from './agenda-types';

export type FetchStatus = 'success' | 'session-required' | 'redirected' | 'api-failure' |
  'invalid-response' | 'network-error' | 'timeout' | 'http-error' | 'rate-limited' | 'invalid-request';
export interface FetchResult { status: FetchStatus; count: number | null; typeCounts?: AgendaTypeCounts }

/** Manual connection diagnostic only: return counts, never a payload or credentials. */
export async function checkAgenda(
  requestUrl: unknown,
  options: { fetch?: typeof fetch; timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<FetchResult> {
  const url = validateAgendaRequest(requestUrl);
  if (!url) return { status: 'invalid-request', count: null };
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, options.timeoutMs ?? 12000);
  const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
  const failure = (status: FetchStatus): FetchResult => ({ status, count: null });
  try {
    const response = await (options.fetch ?? fetch)(url, {
      method: 'GET', credentials: 'include', redirect: 'manual', cache: 'no-store', signal,
      headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
    });
    if (response.type === 'opaqueredirect' || (response.status >= 300 && response.status < 400)) return failure('redirected');
    if (response.status === 401 || response.status === 403) return failure('session-required');
    if (response.status === 429) return failure('rate-limited');
    if (!response.ok) return failure('http-error');
    if (response.headers.get('content-type')?.toLowerCase().includes('text/html')) return failure('session-required');
    const result = parseAgendaResponse(await response.text());
    if (!result.ok) return failure(result.reason === 'api-failure' ? 'api-failure' : 'invalid-response');
    return { status: 'success', count: result.points.length,
      typeCounts: summarizeAgendaTypes(new URL(url).origin, result.points) };
  } catch {
    // Network errors may contain URLs; never return their raw message.
    return failure(timedOut ? 'timeout' : 'network-error');
  } finally {
    clearTimeout(timer);
  }
}
