import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { beginAgendaDiscovery, cancelAgendaDiscovery, observeAgendaRequest, readAgendaDiscovery,
  restoreAgendaDiscovery, takeDiscoveredAgenda, DISCOVERY_KEY, DISCOVERY_ALARM } from '../src/background/agenda-discovery';
import { validateDiscoveryMessage, validateDiscoveryView } from '../src/shared/agenda-discovery';
import { requestUrl } from './fixtures/agenda-request';
import { validateAgendaRequest } from '../src/schoolware/agenda-request';

let stored: Record<string, unknown>;
let permission: boolean;
let tabUrl: string;
const details = (overrides: Partial<chrome.webRequest.OnCompletedDetails> = {}): chrome.webRequest.OnCompletedDetails => ({
  requestId: 'synthetic-request', url: requestUrl, method: 'GET', tabId: 9, frameId: 0, parentFrameId: -1,
  type: 'xmlhttprequest', timeStamp: Date.now(), statusCode: 200, statusLine: 'HTTP/1.1 200 OK', fromCache: false,
  documentLifecycle: 'active', frameType: 'outermost_frame',
  initiator: 'https://schoolware_siw.ksgwl.be', ...overrides,
});
beforeEach(() => {
  stored = {}; permission = true; tabUrl = 'https://schoolware_siw.ksgwl.be/webouders/start.html';
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-04T09:00:00Z'));
  vi.stubGlobal('chrome', {
    webRequest: {},
    storage: { session: { get: vi.fn(async () => structuredClone(stored)),
      set: vi.fn(async (value: Record<string, unknown>) => { Object.assign(stored, structuredClone(value)); }),
      remove: vi.fn(async (key: string) => { delete stored[key]; }) } },
    permissions: { contains: vi.fn(async () => permission), remove: vi.fn().mockResolvedValue(true) },
    alarms: { clear: vi.fn().mockResolvedValue(true), create: vi.fn().mockResolvedValue(undefined) },
    tabs: { create: vi.fn().mockResolvedValue({ id: 9 }), update: vi.fn().mockResolvedValue({}),
      get: vi.fn(async () => ({ id: 9, url: tabUrl })) },
  });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('explicit agenda discovery', () => {
  it('binds an existing selected tab to its exact installation and survives restoration', async () => {
    const origin = 'https://synthetic.schoolware.be';
    const selectedUrl = requestUrl.replace('https://schoolware_siw.ksgwl.be', origin);
    tabUrl = `${origin}/webouders/start.html`;
    await beginAgendaDiscovery(origin, 9);
    expect(chrome.tabs.create).not.toHaveBeenCalled();
    await observeAgendaRequest(details());
    expect((await readAgendaDiscovery()).status).toBe('waiting');
    await restoreAgendaDiscovery();
    await observeAgendaRequest(details({ url: selectedUrl, initiator: origin }));
    const found = await readAgendaDiscovery();
    expect(found.status).toBe('found');
    expect(await takeDiscoveredAgenda(found.id!)).toBe(validateAgendaRequest(selectedUrl));
    expect(chrome.permissions.contains).toHaveBeenCalledWith({ permissions: ['webRequest'], origins: [`${origin}/*`] });
  });
  it('refuses a selected tab that moved before discovery starts', async () => {
    await expect(beginAgendaDiscovery('https://synthetic.schoolware.be', 9)).rejects.toThrow('Tab changed');
    expect(stored[DISCOVERY_KEY]).toBeUndefined();
  });
  it('binds a dedicated tab before navigation, restores its deadline and reveals no source URL in status', async () => {
    const initial = await beginAgendaDiscovery();
    expect(initial.status).toBe('waiting');
    expect(chrome.tabs.update).toHaveBeenCalledWith(9, { url: 'https://schoolware_siw.ksgwl.be/webouders/start.html', active: true });
    expect(chrome.storage.session.set).toHaveBeenCalledBefore(vi.mocked(chrome.tabs.update));
    await observeAgendaRequest(details());
    const found = await readAgendaDiscovery();
    expect(found.status).toBe('found');
    expect(JSON.stringify(found)).not.toContain('AgendaID');
    expect(JSON.stringify(stored)).not.toContain('statusLine');
    await restoreAgendaDiscovery();
    expect(chrome.alarms.create).toHaveBeenLastCalledWith(DISCOVERY_ALARM, { when: Date.now() + 300000 });
    expect(await takeDiscoveredAgenda(found.id!)).toBe(validateAgendaRequest(requestUrl));
    expect(stored[DISCOVERY_KEY]).toBeUndefined();
    expect(chrome.permissions.remove).toHaveBeenCalledWith({ permissions: ['webRequest'] });
  });
  it('ignores other tabs, frames, initiators, methods, errors, endpoints and invalid query parameters', async () => {
    await beginAgendaDiscovery();
    for (const invalid of [details({ tabId: 8 }), details({ frameId: 1 }), details({ initiator: 'https://other.example' }),
      details({ method: 'POST' }), details({ statusCode: 403 }), details({ type: 'main_frame' }),
      details({ url: 'https://other.example/agenda' }), details({ url: requestUrl + '&token=synthetic' }),
      details({ timeStamp: Date.now() - 1 })]) await observeAgendaRequest(invalid);
    expect((await readAgendaDiscovery()).status).toBe('waiting');
    permission = false;
    await observeAgendaRequest(details());
    expect((await readAgendaDiscovery()).status).toBe('permission-required');
    expect(stored[DISCOVERY_KEY]).toBeUndefined();
  });
  it('invalidates a stale confirmation after a different pupil selection and never follows a tab to another site', async () => {
    await beginAgendaDiscovery(); await observeAgendaRequest(details());
    const previous = await readAgendaDiscovery();
    const changed = new URL(requestUrl); changed.searchParams.set('CompletedTaskForLL', '999');
    await observeAgendaRequest(details({ url: changed.href }));
    await expect(takeDiscoveredAgenda(previous.id!)).rejects.toThrow();
    const next = await readAgendaDiscovery();
    tabUrl = 'https://other.example';
    await expect(takeDiscoveredAgenda(next.id!)).rejects.toThrow();
    expect((await readAgendaDiscovery()).status).toBe('found');
  });
  it('expires after five minutes, cancels without capturing later requests and requires optional access to begin', async () => {
    await beginAgendaDiscovery();
    vi.setSystemTime(Date.now() + 300001);
    await observeAgendaRequest(details());
    expect(await readAgendaDiscovery()).toEqual({ status: 'expired', id: null });
    await cancelAgendaDiscovery(); await observeAgendaRequest(details());
    expect(await readAgendaDiscovery()).toEqual({ status: 'idle', id: null });
    permission = false;
    expect(await beginAgendaDiscovery()).toEqual({ status: 'permission-required', id: null });
    expect(chrome.tabs.create).toHaveBeenCalledTimes(1);
  });
  it('validates runtime messages and refuses externally supplied links or invalid confirmation IDs', () => {
    expect(validateDiscoveryMessage({ type: 'connection.discovery.start' })).not.toBeNull();
    expect(validateDiscoveryMessage({ type: 'connection.discovery.start', requestUrl })).toBeNull();
    expect(validateDiscoveryMessage({ type: 'connection.discovery.confirm', id: 'invalid' })).toBeNull();
    expect(validateDiscoveryView({ status: 'found', id: null })).toBeNull();
    expect(validateDiscoveryView({ status: 'waiting', id: crypto.randomUUID(), requestUrl })).toBeNull();
  });
});
