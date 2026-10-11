import { AGENDA_PATH, STUDENT_AGENDA_PATH, SCHOOLWARE_ORIGIN, schoolwareOrigin, validateAgendaRequest } from '../schoolware/agenda-request';
import { discoveryPermissions, type DiscoveryView } from '../shared/agenda-discovery';
import { isAlertId } from '../shared/browser-alerts';

export const DISCOVERY_KEY = 'schoolwareAgendaDiscovery';
export const DISCOVERY_ALARM = 'schoolware-agenda-discovery-expiry';
const WINDOW_MS = 5 * 60000;
interface PendingDiscovery { origin: string; id: string; tabId: number; expiresAt: number; startedAt: number; requestUrl: string | null }
async function pending(): Promise<PendingDiscovery | null> {
  const raw: unknown = (await chrome.storage.session?.get(DISCOVERY_KEY))?.[DISCOVERY_KEY];
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;
  return isAlertId(value.id) && Number.isSafeInteger(value.tabId) && (value.tabId as number) >= 0 &&
    typeof value.expiresAt === 'number' && Number.isFinite(value.expiresAt) &&
    typeof value.startedAt === 'number' && Number.isFinite(value.startedAt) &&
    (value.origin === undefined || schoolwareOrigin(value.origin) === value.origin) &&
    (value.requestUrl === null || (validateAgendaRequest(value.requestUrl) && new URL(value.requestUrl as string).origin === (value.origin ?? SCHOOLWARE_ORIGIN))) ?
    { ...value, origin: value.origin ?? SCHOOLWARE_ORIGIN } as unknown as PendingDiscovery : null;
}
export async function cancelAgendaDiscovery(expired = false, revokeAccess = true): Promise<void> {
  await chrome.storage.session?.remove(DISCOVERY_KEY);
  if (expired) await chrome.storage.session?.set({ [DISCOVERY_KEY]: { expired: true } });
  await chrome.alarms.clear(DISCOVERY_ALARM);
  if (revokeAccess) await chrome.permissions.remove({ permissions: ['webRequest'] });
}
export async function readAgendaDiscovery(): Promise<DiscoveryView> {
  const state = await pending();
  if (!state) {
    const raw = (await chrome.storage.session?.get(DISCOVERY_KEY))?.[DISCOVERY_KEY] as { expired?: unknown } | undefined;
    return { status: raw?.expired === true ? 'expired' : 'idle', id: null };
  }
  if (state.expiresAt <= Date.now()) { await cancelAgendaDiscovery(true); return { status: 'expired', id: null }; }
  if (!await chrome.permissions.contains(discoveryPermissions(state.origin))) {
    await cancelAgendaDiscovery(); return { status: 'permission-required', id: null };
  }
  return { status: state.requestUrl ? 'found' : 'waiting', id: state.id };
}
export async function restoreAgendaDiscovery(): Promise<void> {
  const state = await pending();
  if (!state) return;
  if (state.expiresAt <= Date.now() || !await chrome.permissions.contains(discoveryPermissions(state.origin))) {
    await cancelAgendaDiscovery(true); return;
  }
  await chrome.alarms.create(DISCOVERY_ALARM, { when: state.expiresAt });
}
export async function beginAgendaDiscovery(origin = SCHOOLWARE_ORIGIN, tabId?: number): Promise<DiscoveryView> {
  if (schoolwareOrigin(origin) !== origin) throw new Error('Invalid installation');
  if (!chrome.storage.session || !chrome.webRequest || !await chrome.permissions.contains(discoveryPermissions(origin))) {
    return { status: 'permission-required', id: null };
  }
  // Bind before navigation so fast agenda requests cannot beat the stored session.
  const tab = tabId === undefined ? await chrome.tabs.create({ url: 'about:blank', active: false }) : await chrome.tabs.get(tabId);
  if (tabId !== undefined && (!tab.url || new URL(tab.url).origin !== origin)) throw new Error('Tab changed');
  if (tab.id === undefined) throw new Error('Discovery unavailable');
  const state: PendingDiscovery = { origin, id: crypto.randomUUID(), tabId: tab.id, startedAt: Date.now(),
    expiresAt: Date.now() + WINDOW_MS, requestUrl: null };
  try {
    await chrome.storage.session.set({ [DISCOVERY_KEY]: state });
    await chrome.alarms.create(DISCOVERY_ALARM, { when: state.expiresAt });
    const landing = tab.url && new URL(tab.url).pathname.startsWith('/webleerling/') ?
      '/webleerling/start.html#!fn=llagenda' : '/webouders/start.html';
    await chrome.tabs.update(tab.id, { url: `${origin}${landing}`, active: true });
    return { status: 'waiting', id: state.id };
  } catch { await cancelAgendaDiscovery(); throw new Error('Discovery unavailable'); }
}
export async function observeAgendaRequest(details: chrome.webRequest.OnCompletedDetails): Promise<boolean> {
  // No headers, bodies, cookies, response data, IPs or arbitrary URLs are retained.
  if (details.method !== 'GET' || details.type !== 'xmlhttprequest' || details.frameId !== 0 ||
      details.statusCode !== 200) return false;
  const requestUrl = validateAgendaRequest(details.url);
  if (!requestUrl) return false;
  const state = await pending();
  if (!state || details.initiator !== state.origin || new URL(requestUrl).origin !== state.origin || state.tabId !== details.tabId || details.timeStamp < state.startedAt || state.expiresAt <= Date.now() ||
      !await chrome.permissions.contains(discoveryPermissions(state.origin))) return false;
  if (state.requestUrl === requestUrl) return false;
  // A different selection invalidates any confirmation rendered before this event.
  await chrome.storage.session.set({ [DISCOVERY_KEY]: { ...state, id: crypto.randomUUID(), requestUrl } });
  return true;
}
export async function takeDiscoveredAgenda(id: string): Promise<string> {
  const state = await pending();
  if (!state || state.id !== id || !state.requestUrl || state.expiresAt <= Date.now() ||
      !await chrome.permissions.contains(discoveryPermissions(state.origin))) throw new Error('Discovery changed');
  const tab = await chrome.tabs.get(state.tabId);
  if (!tab.url || new URL(tab.url).origin !== state.origin) throw new Error('Discovery changed');
  await cancelAgendaDiscovery();
  return state.requestUrl;
}
export function registerAgendaDiscovery(observe: (details: chrome.webRequest.OnCompletedDetails) => void): void {
  const event = chrome.webRequest?.onCompleted;
  if (!event) return;
  try {
    if (!event.hasListener(observe)) event.addListener(observe, {
      urls: [`https://*${AGENDA_PATH}?*`, `https://*${STUDENT_AGENDA_PATH}?*`, `https://*${STUDENT_AGENDA_PATH.slice(0, -1)}?*`], types: ['xmlhttprequest'],
    });
  } catch { /* Optional access may not have been granted yet. */ }
}
