import { checkAgenda } from '../schoolware/agenda-client';
import { SCHOOLWARE_PERMISSION } from '../schoolware/agenda-request';
import { CONNECTION_KEY, EMPTY_CONNECTION, isExtensionPage, validateConnectionMessage,
  validateConnectionState, type ConnectionMessage, type ConnectionState } from '../shared/connection';

// Only transient in-flight coordination lives in memory. No history is written.
let activeCheck: AbortController | null = null;
let generation = 0;

async function readConnection(): Promise<ConnectionState> {
  const data = await chrome.storage.local.get(CONNECTION_KEY);
  return validateConnectionState(data[CONNECTION_KEY]) ?? EMPTY_CONNECTION;
}

async function clearConnection(): Promise<ConnectionState> {
  generation++;
  activeCheck?.abort();
  await chrome.storage.local.remove(CONNECTION_KEY);
  await chrome.permissions.remove({ origins: [SCHOOLWARE_PERMISSION] });
  return EMPTY_CONNECTION;
}

async function handle(message: ConnectionMessage): Promise<ConnectionState> {
  await storageReady;
  if (message.type === 'connection.read') return readConnection();
  if (message.type === 'connection.clear') return clearConnection();
  const summary = (status: 'busy' | 'permission-required' | 'storage-error'): ConnectionState => ({
    requestUrl: null, lastCheck: { status, checkedAt: new Date().toISOString(), count: null },
  });
  if (activeCheck) return summary('busy');
  const controller = new AbortController();
  activeCheck = controller;
  const currentGeneration = generation;
  try {
    if (!await chrome.permissions.contains({ origins: [SCHOOLWARE_PERMISSION] })) return summary('permission-required');
    if (generation !== currentGeneration) return EMPTY_CONNECTION;
    const pending: ConnectionState = { requestUrl: message.requestUrl, lastCheck: null };
    await chrome.storage.local.set({ [CONNECTION_KEY]: pending });
    const result = await checkAgenda(message.requestUrl, { signal: controller.signal });
    if (generation !== currentGeneration) {
      await chrome.storage.local.remove(CONNECTION_KEY);
      return EMPTY_CONNECTION;
    }
    const state: ConnectionState = { requestUrl: message.requestUrl,
      lastCheck: { ...result, checkedAt: new Date().toISOString() } };
    await chrome.storage.local.set({ [CONNECTION_KEY]: state });
    return state;
  } catch {
    return summary('storage-error');
  } finally {
    activeCheck = null;
  }
}

// Restrict storage to trusted extension contexts, including on worker restarts.
const storageReady = chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
void storageReady.catch(() => { /* Report through the message response instead of logging source errors. */ });

chrome.runtime.onMessage.addListener((raw: unknown, sender, sendResponse) => {
  if (!isExtensionPage(sender, chrome.runtime.id)) return false;
  const message = validateConnectionMessage(raw);
  if (!message) return false;
  void handle(message).then(sendResponse, () => sendResponse({ requestUrl: null,
    lastCheck: { status: 'storage-error', checkedAt: new Date().toISOString(), count: null } }));
  return true;
});

chrome.runtime.onInstalled.addListener(() => {
  void chrome.action.setBadgeText({ text: '' });
});
