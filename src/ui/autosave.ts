import type { ConnectionMessage } from '../shared/connection';
import { validatePreferencesView, type Preferences, type PreferencesView } from '../shared/preferences';

/** Hand off each edit during the input event; the worker serializes writes. */
export function savePreferences(preferences: Preferences): Promise<PreferencesView> {
  const response = chrome.runtime.sendMessage({ type: 'preferences.save', preferences } satisfies ConnectionMessage);
  return response.then((raw: unknown) => {
    const view = validatePreferencesView(raw);
    if (!view?.ok) throw new Error('Preferences unavailable');
    return view;
  });
}
