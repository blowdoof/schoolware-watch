import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { checkAgenda, type FetchResult } from '../src/schoolware/agenda-client';
import { CONNECTION_KEY } from '../src/shared/connection';
import { requestUrl } from './fixtures/agenda-request';

vi.mock('../src/schoolware/agenda-client', () => ({ checkAgenda: vi.fn() }));

type Listener = (message: unknown, sender: { id: string; url: string }, reply: (value: unknown) => void) => boolean;
let listener: Listener;
let stored: Record<string, unknown>;
const sender = { id: 'syntheticextension', url: 'chrome-extension://syntheticextension/options.html' };
let removePermission: ReturnType<typeof vi.fn>;

function dispatch(message: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    if (!listener(message, sender, resolve)) reject(new Error('Message rejected'));
  });
}

beforeEach(async () => {
  vi.resetModules();
  stored = {};
  removePermission = vi.fn().mockResolvedValue(true);
  vi.mocked(checkAgenda).mockReset().mockResolvedValue({ status: 'success', count: 2 });
  vi.stubGlobal('chrome', {
    runtime: { id: sender.id,
      onMessage: { addListener: (callback: Listener) => { listener = callback; } },
      onInstalled: { addListener: vi.fn() } },
    storage: { local: {
      setAccessLevel: vi.fn().mockResolvedValue(undefined),
      get: vi.fn(async () => ({ ...stored })),
      set: vi.fn(async (value: Record<string, unknown>) => { Object.assign(stored, value); }),
      remove: vi.fn(async (key: string) => { delete stored[key]; }),
    } },
    permissions: { contains: vi.fn().mockResolvedValue(true), remove: removePermission },
    action: { setBadgeText: vi.fn() },
  });
  await import('../src/background/service-worker');
});

afterEach(() => { vi.unstubAllGlobals(); });

describe('worker connection lifecycle', () => {
  it('stores only a canonical link and summary, independently of a mounted popup', async () => {
    const result = await dispatch({ type: 'agenda.check', requestUrl });
    expect(stored[CONNECTION_KEY]).toEqual(result);
    expect(result).toMatchObject({ lastCheck: { status: 'success', count: 2 } });
    expect(await dispatch({ type: 'connection.read' })).toEqual(result);
    expect(Object.keys(stored)).toEqual([CONNECTION_KEY]);
    expect(JSON.stringify(result)).not.toContain('points');
  });

  it('rejects messages from the Schoolware page or with secret-bearing fields', () => {
    const reply = vi.fn();
    expect(listener({ type: 'agenda.check', requestUrl }, { ...sender, url: requestUrl }, reply)).toBe(false);
    expect(listener({ type: 'agenda.check', requestUrl, cookie: 'synthetic-secret' }, sender, reply)).toBe(false);
    expect(checkAgenda).not.toHaveBeenCalled();
    expect(reply).not.toHaveBeenCalled();
  });

  it('prevents overlapping manual checks', async () => {
    let finish!: (result: FetchResult) => void;
    vi.mocked(checkAgenda).mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const first = dispatch({ type: 'agenda.check', requestUrl });
    await vi.waitFor(() => expect(checkAgenda).toHaveBeenCalledTimes(1));
    expect(await dispatch({ type: 'agenda.check', requestUrl })).toMatchObject({ lastCheck: { status: 'busy' } });
    finish({ status: 'success', count: 2 });
    await first;
    expect(checkAgenda).toHaveBeenCalledTimes(1);
  });

  it('clears local state, revokes access and prevents an in-flight result restoring it', async () => {
    let finish!: (result: FetchResult) => void;
    vi.mocked(checkAgenda).mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const first = dispatch({ type: 'agenda.check', requestUrl });
    await vi.waitFor(() => expect(checkAgenda).toHaveBeenCalledTimes(1));
    expect(await dispatch({ type: 'connection.clear' })).toEqual({ requestUrl: null, lastCheck: null });
    expect(vi.mocked(checkAgenda).mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    finish({ status: 'success', count: 2 });
    expect(await first).toEqual({ requestUrl: null, lastCheck: null });
    expect(stored).toEqual({});
    expect(removePermission).toHaveBeenCalledOnce();
  });
});
