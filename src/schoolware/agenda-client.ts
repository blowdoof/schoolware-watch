import { parseAgendaResponse, type AgendaPoint } from './agenda-response';
import { validateAgendaRequest } from './agenda-request';
import { summarizeAgendaTypes, type AgendaTypeCounts } from './agenda-types';

export type FetchStatus = 'success' | 'session-required' | 'redirected' | 'api-failure' |
  'invalid-response' | 'network-error' | 'timeout' | 'http-error' | 'rate-limited' | 'invalid-request';
export interface FetchResult { status: FetchStatus; count: number | null; typeCounts?: AgendaTypeCounts }
export const MAX_AGENDA_RESPONSE_BYTES = 5_000_000;
export type AgendaFetchResult =
  | { status: 'success'; count: number; typeCounts: AgendaTypeCounts; points: AgendaPoint[]; completeness: 'unverified' }
  | { status: Exclude<FetchStatus, 'success'>; count: null };

/** Enforce the bound on streamed bytes, even without an honest Content-Length. */
async function readAgendaText(response: Response): Promise<string | null> {
  if (Number(response.headers.get('Content-Length')) > MAX_AGENDA_RESPONSE_BYTES) {
    await response.body?.cancel().catch(() => {});
    return null;
  }
  const reader = response.body?.getReader();
  if (!reader) return null;
  const decoder = new TextDecoder();
  let size = 0;
  let text = '';
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) return text + decoder.decode();
      size += chunk.value.byteLength;
      if (size > MAX_AGENDA_RESPONSE_BYTES) {
        await reader.cancel().catch(() => {});
        return null;
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
  } finally { reader.releaseLock(); }
}

/** Worker transport: validate and project source fields before local history writes. */
export async function fetchAgenda(
  requestUrl: unknown,
  options: { fetch?: typeof fetch; timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<AgendaFetchResult> {
  const url = validateAgendaRequest(requestUrl);
  if (!url) return { status: 'invalid-request', count: null };
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, options.timeoutMs ?? 12000);
  const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
  const failure = (status: Exclude<FetchStatus, 'success'>): AgendaFetchResult => ({ status, count: null });
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
    const text = await readAgendaText(response);
    if (text === null) return failure('invalid-response');
    const result = parseAgendaResponse(text);
    if (!result.ok) return failure(result.reason === 'api-failure' ? 'api-failure' : 'invalid-response');
    return { status: 'success', count: result.points.length,
      typeCounts: summarizeAgendaTypes(new URL(url).origin, result.points),
      points: result.points, completeness: result.completeness };
  } catch {
    // Network errors may contain URLs; never return their raw message.
    return failure(timedOut ? 'timeout' : 'network-error');
  } finally {
    clearTimeout(timer);
  }
}

/** Compatibility diagnostic: point data never crosses into its UI summary. */
export async function checkAgenda(requestUrl: unknown, options: Parameters<typeof fetchAgenda>[1] = {}): Promise<FetchResult> {
  const result = await fetchAgenda(requestUrl, options);
  if (result.status !== 'success') return result;
  return { status: result.status, count: result.count, typeCounts: result.typeCounts };
}
