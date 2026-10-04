import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkAgenda, MAX_AGENDA_RESPONSE_BYTES } from '../src/schoolware/agenda-client';
import fixture from './fixtures/synthetic-agenda.json';
import { requestUrl } from './fixtures/agenda-request';

afterEach(() => { vi.useRealTimers(); });

describe('manual session check', () => {
  it('rejects oversized response headers and streamed bodies without returning source content', async () => {
    for (const declared of [true, false]) {
      const cancelled = vi.fn();
      const body = new ReadableStream<Uint8Array>({
        start(controller) { controller.enqueue(new Uint8Array(MAX_AGENDA_RESPONSE_BYTES + 1)); },
        cancel: cancelled,
      });
      const response = new Response(body, declared ? { headers: { 'Content-Length': String(MAX_AGENDA_RESPONSE_BYTES + 1) } } : undefined);
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response);
      expect(await checkAgenda(requestUrl, { fetch: fetcher })).toEqual({ status: 'invalid-response', count: null });
      expect(cancelled).toHaveBeenCalledOnce();
      expect(response.body?.locked).toBe(false);
    }
  });
  it('uses browser-managed credentials, bounded redirects and no credential headers', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(fixture));
    expect(await checkAgenda(requestUrl, { fetch: fetcher })).toEqual({ status: 'success', count: 2,
      typeCounts: { tests: 0, assignments: 0, review: 0, other: 2 } });
    const init = fetcher.mock.calls[0]?.[1];
    expect(init).toMatchObject({ method: 'GET', credentials: 'include', redirect: 'manual', cache: 'no-store' });
    expect(init?.headers).toEqual({ Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('does not issue a request to an unapproved destination', async () => {
    const fetcher = vi.fn<typeof fetch>();
    expect(await checkAgenda('https://example.com/', { fetch: fetcher })).toEqual({ status: 'invalid-request', count: null });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    [401, 'session-required'], [403, 'session-required'], [302, 'redirected'],
    [429, 'rate-limited'], [500, 'http-error'],
  ])('reports HTTP %i without attempting to read it as an agenda', async (status, expected) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('synthetic-private', { status }));
    expect(await checkAgenda(requestUrl, { fetch: fetcher })).toEqual({ status: expected, count: null });
  });

  it('does not follow an opaque redirect to a login or another host', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue({ type: 'opaqueredirect', status: 0 } as Response);
    expect(await checkAgenda(requestUrl, { fetch: fetcher })).toEqual({ status: 'redirected', count: null });
  });

  it('distinguishes a login page, API failure and invalid JSON', async () => {
    for (const [response, status] of [
      [new Response('<html>Login</html>', { headers: { 'Content-Type': 'text/html' } }), 'session-required'],
      [Response.json({ success: false, data: [] }), 'api-failure'],
      [new Response('synthetic-private'), 'invalid-response'],
      [Response.json({ success: true, data: [fixture.data[0], {}] }), 'invalid-response'],
    ] as const) {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response);
      expect(await checkAgenda(requestUrl, { fetch: fetcher })).toEqual({ status, count: null });
    }
  });

  it('does not expose URLs or source content in network errors', async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error('synthetic-private URL and payload'));
    expect(await checkAgenda(requestUrl, { fetch: fetcher })).toEqual({ status: 'network-error', count: null });
  });

  it('aborts slow requests and returns a timeout', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn<typeof fetch>().mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    }));
    const result = checkAgenda(requestUrl, { fetch: fetcher, timeoutMs: 100 });
    await vi.advanceTimersByTimeAsync(100);
    expect(await result).toEqual({ status: 'timeout', count: null });
    expect(fetcher.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
});
