import { BROWSER_PERMISSIONS, BROWSER_ORIGINS } from '../shared/browser-alerts';
import { SCHOOLWARE_ORIGIN } from '../schoolware/agenda-request';

const SCRIPT_ID = 'schoolware-website-alerts';

interface WebsiteResult { registered: boolean; count: number; failedCount: number }
export async function configureWebsiteAlerts(enabled: boolean, injectExisting = false): Promise<WebsiteResult> {
  if (!chrome.scripting) return { registered: false, count: 0, failedCount: 0 };
  const allowed = enabled && await chrome.permissions.contains(BROWSER_PERMISSIONS);
  const registered = await chrome.scripting.getRegisteredContentScripts({ ids: [SCRIPT_ID] });
  if (!allowed) {
    if (registered.length) await chrome.scripting.unregisterContentScripts({ ids: [SCRIPT_ID] });
    return { registered: false, count: 0, failedCount: 0 };
  }
  if (!registered.length) {
    await chrome.scripting.registerContentScripts([{ id: SCRIPT_ID, js: ['website-alert.js'], matches: BROWSER_ORIGINS,
      runAt: 'document_idle', allFrames: false, persistAcrossSessions: true, world: 'ISOLATED' }]);
  }
  if (injectExisting) {
    const tabs = await chrome.tabs.query({});
    const outcomes = await Promise.allSettled(tabs.filter((tab) => {
      try { return tab.id !== undefined && new URL(tab.url ?? '').origin === SCHOOLWARE_ORIGIN; } catch { return false; }
    }).map((tab) =>
      chrome.scripting.executeScript({ target: { tabId: tab.id! }, files: ['website-alert.js'] })));
    return { registered: true, count: outcomes.length, failedCount: outcomes.filter((outcome) => outcome.status === 'rejected').length };
  }
  return { registered: true, count: 0, failedCount: 0 };
}

export async function broadcastWebsiteAlerts(): Promise<{ count: number; failedCount: number }> {
  const tabs = await chrome.tabs.query({});
  // No tab URL or page content is stored. Unsupported tabs and tabs without the
  // optional content script simply reject the invalidation message.
  const outcomes = await Promise.allSettled(tabs.filter((tab) => {
    try { return tab.id !== undefined && new URL(tab.url ?? '').origin === SCHOOLWARE_ORIGIN; } catch { return false; }
  }).map((tab) =>
    chrome.tabs.sendMessage(tab.id!, { type: 'browser.alerts.updated' }, { frameId: 0 })));
  return { count: outcomes.length, failedCount: outcomes.filter((outcome) => outcome.status === 'rejected').length };
}
