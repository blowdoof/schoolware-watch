import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openMainPage, MAIN_TAB_KEY } from '../src/background/navigation';
import { validateConnectionMessage } from '../src/shared/connection';

const getURL = (path: string) => `chrome-extension://syntheticextension/${path}`;
let session: Record<string, unknown>;

beforeEach(() => {
  session = {};
  vi.stubGlobal('chrome', {
    runtime: { getURL, getContexts: vi.fn().mockResolvedValue([]) },
    storage: { session: {
      get: vi.fn(async () => ({ ...session })),
      set: vi.fn(async (value: Record<string, unknown>) => { Object.assign(session, value); }),
    } },
    tabs: {
      create: vi.fn().mockResolvedValue({ id: 7, windowId: 3 }),
      update: vi.fn().mockResolvedValue({ id: 7, windowId: 3 }),
      get: vi.fn().mockResolvedValue({ id: 7, windowId: 3, url: getURL('dashboard.html') }),
    },
    windows: { update: vi.fn().mockResolvedValue({}) },
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('shared settings and overview tab', () => {
  it('recovers an existing extension tab without a remembered ID or extra tab permission', async () => {
    vi.mocked(chrome.runtime.getContexts).mockImplementation(async () => [{
      contextId: 'synthetic-context', contextType: 'TAB', tabId: 7, windowId: 3,
      frameId: 0, incognito: false, documentUrl: getURL('dashboard.html'),
    }]);
    expect(await openMainPage('options')).toEqual({ ok: true });
    expect(chrome.runtime.getContexts).toHaveBeenCalledWith({
      contextTypes: ['TAB'], documentUrls: [getURL('dashboard.html'), getURL('options.html')],
    });
    expect(chrome.tabs.update).toHaveBeenCalledWith(7, { url: getURL('options.html'), active: true });
    expect(chrome.windows.update).toHaveBeenCalledWith(3, { focused: true });
    expect(chrome.tabs.create).not.toHaveBeenCalled();
  });

  it('reuses a still-loading tab before its document context exists', async () => {
    await openMainPage('dashboard');
    vi.mocked(chrome.tabs.get).mockImplementation(async () => ({ id: 7, windowId: 3, pendingUrl: getURL('dashboard.html') } as chrome.tabs.Tab));
    await openMainPage('options');
    expect(chrome.tabs.create).toHaveBeenCalledTimes(1);
    expect(chrome.tabs.update).toHaveBeenCalledWith(7, { url: getURL('options.html'), active: true });
    expect(session[MAIN_TAB_KEY]).toBe(7);
  });

  it.each([
    { url: 'https://example.test/' },
    { url: getURL('dashboard.html'), pendingUrl: 'https://example.test/' },
    { url: getURL('dashboard.html?alert=test') },
    { url: 'chrome-extension://anotherextension/options.html' },
  ])('never overwrites a remembered tab which now holds another page: %j', async (tab) => {
    session[MAIN_TAB_KEY] = 7;
    vi.mocked(chrome.tabs.get).mockImplementation(async () => ({ id: 7, windowId: 3, ...tab } as chrome.tabs.Tab));
    await openMainPage('options');
    expect(chrome.tabs.update).not.toHaveBeenCalled();
    expect(chrome.tabs.create).toHaveBeenCalledWith({ url: getURL('options.html'), active: true });
  });

  it('opens a replacement when the remembered tab was closed', async () => {
    session[MAIN_TAB_KEY] = 7;
    vi.mocked(chrome.tabs.get).mockRejectedValue(new Error('Synthetic closed tab'));
    await openMainPage('dashboard');
    expect(chrome.tabs.create).toHaveBeenCalledOnce();
  });

  it('accepts only the two navigation destinations and no arbitrary URL or fields', () => {
    expect(validateConnectionMessage({ type: 'ui.open', page: 'options' })).toEqual({ type: 'ui.open', page: 'options' });
    for (const value of [{ type: 'ui.open', page: 'https://example.test/' },
      { type: 'ui.open', page: 'popup' }, { type: 'ui.open', page: 'options', url: getURL('options.html') }]) {
      expect(validateConnectionMessage(value)).toBeNull();
    }
  });
});
