import type { MainPage, OpenPageResult } from '../shared/navigation';

export const MAIN_TAB_KEY = 'schoolwareMainTab';

/** The worker serializes calls; session storage also covers loading tabs/restarts. */
export async function openMainPage(page: MainPage): Promise<OpenPageResult> {
  const urls = ['dashboard.html', 'options.html'].map((path) => chrome.runtime.getURL(path));
  const saved = (await chrome.storage.session.get(MAIN_TAB_KEY))[MAIN_TAB_KEY] as unknown;
  const contexts = await chrome.runtime.getContexts({ contextTypes: ['TAB'], documentUrls: urls });
  const remembered = typeof saved === 'number' && Number.isSafeInteger(saved) && saved >= 0 ? saved : null;
  const context = contexts.find((entry) => entry.tabId === remembered) ??
    contexts.find((entry) => entry.tabId >= 0);
  let tabId = context?.tabId;
  if (tabId === undefined && remembered !== null) {
    // A freshly created or discarded tab may have no active document context.
    const tab = await chrome.tabs.get(remembered).catch(() => null);
    if (tab && ((!tab.pendingUrl && urls.includes(tab.url ?? '')) || urls.includes(tab.pendingUrl ?? ''))) tabId = remembered;
  }
  const url = chrome.runtime.getURL(`${page}.html`);
  // Reload the reused tab to select the requested page, even after local view
  // navigation. Navigation inside that tab itself stays within its React app.
  const tab = tabId === undefined ? await chrome.tabs.create({ url, active: true }) :
    await chrome.tabs.update(tabId, { url, active: true }).catch(async () => {
      // The user may close the tab after context discovery.
      return chrome.tabs.create({ url, active: true });
    });
  if (!tab) return { ok: false };
  if (typeof tab.id === 'number') await chrome.storage.session.set({ [MAIN_TAB_KEY]: tab.id });
  if (typeof tab.windowId === 'number' && tab.windowId >= 0) {
    await chrome.windows.update(tab.windowId, { focused: true }).catch(() => {});
  }
  return { ok: true };
}
