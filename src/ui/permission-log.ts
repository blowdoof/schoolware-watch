import type { ConnectionMessage } from '../shared/connection';

export async function recordPermissionResult(permission: 'notifications' | 'browser' | 'schoolware', granted: boolean): Promise<void> {
  await chrome.runtime.sendMessage({ type: 'permission.result', permission, granted } satisfies ConnectionMessage).catch(() => {});
}
