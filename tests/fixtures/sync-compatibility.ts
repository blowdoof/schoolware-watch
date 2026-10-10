import { vi } from 'vitest';

/** Isolate existing transport scenarios from the separately tested preflight. */
export function withCompatiblePolicy(fetcher: unknown): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (typeof init?.body === 'string' && JSON.parse(init.body).action === 'compatibility')
      return Response.json({ ok: true, policy: { minimumProtocol: 3, maximumProtocol: 3, minimumVersion: '0.4.0', latestVersion: null } });
    return (fetcher as typeof fetch)(input, init);
  });
}
