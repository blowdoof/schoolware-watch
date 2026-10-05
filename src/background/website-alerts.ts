import { browserPermissions } from '../shared/browser-alerts';
import { SCHOOLWARE_ORIGIN, schoolwareOrigin } from '../schoolware/agenda-request';

import { CONNECTION_KEY, validateConnectionState } from '../shared/connection';

async function websiteOrigin(): Promise<string> {
  const stored = await chrome.storage.local.get(CONNECTION_KEY);
  return schoolwareOrigin(validateConnectionState(stored[CONNECTION_KEY])?.requestUrl) ?? SCHOOLWARE_ORIGIN;
}

const SCRIPT_ID = 'schoolware-website-alerts';

interface WebsiteResult { registered: boolean; count: number; failedCount: number }
export async function configureWebsiteAlerts(enabled: boolean, injectExisting = false): Promise<WebsiteResult> {
  if (!chrome.scripting) return { registered: false, count: 0, failedCount: 0 };
  const origin = await websiteOrigin();
  const permissions = browserPermissions(origin);
  const allowed = enabled && await chrome.permissions.contains(permissions);
  const registered = await chrome.scripting.getRegisteredContentScripts({ ids: [SCRIPT_ID] });
  if (!allowed) {
    if (registered.length) await chrome.scripting.unregisterContentScripts({ ids: [SCRIPT_ID] });
    return { registered: false, count: 0, failedCount: 0 };
  }
  if (registered.length && JSON.stringify(registered[0]?.matches) !== JSON.stringify(permissions.origins)) {
    await chrome.scripting.unregisterContentScripts({ ids: [SCRIPT_ID] });
    registered.length = 0;
  }
  if (!registered.length) {
    await chrome.scripting.registerContentScripts([{ id: SCRIPT_ID, js: ['website-alert.js'], matches: permissions.origins,
      runAt: 'document_idle', allFrames: false, persistAcrossSessions: true, world: 'ISOLATED' }]);
  }
  if (injectExisting) {
    const tabs = await chrome.tabs.query({});
    const outcomes = await Promise.allSettled(tabs.filter((tab) => {
      try { return tab.id !== undefined && new URL(tab.url ?? '').origin === origin; } catch { return false; }
    }).map((tab) =>
      chrome.scripting.executeScript({ target: { tabId: tab.id! }, files: ['website-alert.js'] })));
    return { registered: true, count: outcomes.length, failedCount: outcomes.filter((outcome) => outcome.status === 'rejected').length };
  }
  return { registered: true, count: 0, failedCount: 0 };
}

export async function broadcastWebsiteAlerts(previousOrigin?: string): Promise<{ count: number; failedCount: number }> {
  const origin = previousOrigin ?? await websiteOrigin();
  const tabs = await chrome.tabs.query({});
  // No tab URL or page content is stored. Unsupported tabs and tabs without the
  // optional content script simply reject the invalidation message.
  const outcomes = await Promise.allSettled(tabs.filter((tab) => {
    try { return tab.id !== undefined && new URL(tab.url ?? '').origin === origin; } catch { return false; }
  }).map((tab) =>
    chrome.tabs.sendMessage(tab.id!, { type: 'browser.alerts.updated' }, { frameId: 0 })));
  return { count: outcomes.length, failedCount: outcomes.filter((outcome) => outcome.status === 'rejected').length };
}
