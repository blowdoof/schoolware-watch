import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { fetchAgenda, type AgendaFetchResult } from '../src/schoolware/agenda-client';
import { validateAgendaResponse } from '../src/schoolware/agenda-response';
import { HistoryRepository } from '../src/storage/history';
import fixture from './fixtures/synthetic-agenda.json';
import { CONNECTION_KEY } from '../src/shared/connection';
import { requestUrl } from './fixtures/agenda-request';
import { DEFAULT_PREFERENCES, PREFERENCES_KEY } from '../src/shared/preferences';
import { validateAgendaRequest } from '../src/schoolware/agenda-request';
import { BROWSER_ALERTS_KEY, validateBrowserAlertsView } from '../src/shared/browser-alerts';
import { validateNotificationDetailsView } from '../src/shared/notification-details';
import { ActivityRepository } from '../src/storage/activity';
import { validateActivityView } from '../src/shared/activity';
import { validateTasksView } from '../src/shared/tasks';

const scopeId = validateAgendaRequest(requestUrl)!;

vi.mock('../src/schoolware/agenda-client', () => ({ fetchAgenda: vi.fn() }));

const parsed = validateAgendaResponse(fixture);
if (!parsed.ok) throw new Error('Invalid synthetic fixture');
const success: AgendaFetchResult = { status: 'success', count: 2,
  typeCounts: { tests: 0, assignments: 0, review: 0, other: 2 }, points: parsed.points, completeness: 'unverified' };

type Listener = (message: unknown, sender: { id: string; url: string; tab?: { id?: number }; frameId?: number }, reply: (value: unknown) => void) => boolean;
let listener: Listener;
let stored: Record<string, unknown>;
const sender = { id: 'syntheticextension', url: 'chrome-extension://syntheticextension/options.html' };
let removePermission: ReturnType<typeof vi.fn>;
let alarmListener: (alarm: chrome.alarms.Alarm) => void;
let clicked: (id: string) => void;
let closed: (id: string, byUser: boolean) => void;
let alarm: chrome.alarms.Alarm | undefined;
let createNotification: ReturnType<typeof vi.fn>;
let hostPermission: boolean;
let notificationPermission: boolean;
let browserPermission: boolean;
let registeredScripts: chrome.scripting.RegisteredContentScript[];
let session: Record<string, unknown>;
let discovered: (details: chrome.webRequest.OnCompletedDetails) => void;
let discoveryPermission: boolean;

function dispatch(message: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    if (!listener(message, sender, resolve)) reject(new Error('Message rejected'));
  });
}

beforeEach(async () => {
  const otherAlarms = new Map<string, chrome.alarms.Alarm>();
  vi.resetModules();
  stored = {};
  session = {}; discoveryPermission = true; discovered = undefined!;
  vi.setSystemTime(new Date('2026-10-02T08:00:00.000Z'));
  alarm = undefined;
  hostPermission = true;
  notificationPermission = true;
  browserPermission = true;
  registeredScripts = [];
  createNotification = vi.fn().mockResolvedValue('synthetic-notification');
  vi.stubGlobal('indexedDB', new IDBFactory());
  removePermission = vi.fn().mockResolvedValue(true);
  vi.mocked(fetchAgenda).mockReset().mockResolvedValue(success);
  vi.stubGlobal('chrome', {
    runtime: { id: sender.id, getURL: (path: string) => `chrome-extension://${sender.id}/${path}`,
      getContexts: vi.fn().mockResolvedValue([]),
      onMessage: { addListener: (callback: Listener) => { listener = callback; } },
      onInstalled: { addListener: vi.fn() }, onStartup: { addListener: vi.fn() } },
    alarms: {
      get: vi.fn(async (name: string) => name === 'schoolware-monitor' ? alarm : otherAlarms.get(name)),
      clear: vi.fn(async (name: string) => {
        if (name !== 'schoolware-monitor') return otherAlarms.delete(name);
        if (!alarm) return false; alarm = undefined; return true;
      }),
      create: vi.fn(async (name: string, info: chrome.alarms.AlarmCreateInfo) => {
        const created = { name, scheduledTime: Date.now() + (info.delayInMinutes ?? 0) * 60000,
          persistAcrossSessions: true, ...(info.periodInMinutes ? { periodInMinutes: info.periodInMinutes } : {}) };
        if (name === 'schoolware-monitor') alarm = created; else otherAlarms.set(name, created);
      }),
      onAlarm: { addListener: (callback: typeof alarmListener) => { alarmListener = callback; } },
    },
    notifications: { create: createNotification, getAll: vi.fn().mockResolvedValue({}), getPermissionLevel: vi.fn().mockResolvedValue('granted'), clear: vi.fn().mockResolvedValue(true),
      onClicked: { addListener: (callback: typeof clicked) => { clicked = callback; } },
      onClosed: { addListener: (callback: typeof closed) => { closed = callback; } } },
    webRequest: { onCompleted: { hasListener: vi.fn(() => Boolean(discovered)),
      addListener: vi.fn((callback: typeof discovered) => { discovered = callback; }) } },
    tabs: { create: vi.fn().mockResolvedValue({}), update: vi.fn().mockResolvedValue({}),
      get: vi.fn().mockResolvedValue({ id: 9, url: 'https://schoolware_siw.ksgwl.be/webouders/start.html' }), query: vi.fn().mockResolvedValue([
      { id: 1, url: 'https://schoolware_siw.ksgwl.be/webouders/start.html' },
      { id: 2, url: 'https://example.test/' }, { id: 3, url: 'chrome://extensions/' },
    ]), sendMessage: vi.fn().mockResolvedValue(undefined) },
    windows: { update: vi.fn().mockResolvedValue({}) },
    scripting: {
      getRegisteredContentScripts: vi.fn(async () => registeredScripts),
      registerContentScripts: vi.fn(async (scripts: chrome.scripting.RegisteredContentScript[]) => { registeredScripts = scripts; }),
      unregisterContentScripts: vi.fn(async () => { registeredScripts = []; }),
      executeScript: vi.fn().mockResolvedValue([]),
    },
    storage: { session: {
      get: vi.fn(async () => ({ ...session })),
      set: vi.fn(async (value: Record<string, unknown>) => { Object.assign(session, value); }),
      remove: vi.fn(async (key: string) => { delete session[key]; }),
    }, local: {
      setAccessLevel: vi.fn().mockResolvedValue(undefined),
      get: vi.fn(async () => ({ ...stored })),
      set: vi.fn(async (value: Record<string, unknown>) => { Object.assign(stored, value); }),
      remove: vi.fn(async (keys: string | string[]) => { for (const key of typeof keys === 'string' ? [keys] : keys) delete stored[key]; }),
    } },
    permissions: { contains: vi.fn(async (request: chrome.permissions.Permissions) =>
      request.permissions?.includes('webRequest') ? discoveryPermission && hostPermission : request.permissions?.includes('scripting') ? browserPermission && hostPermission : request.origins ? hostPermission : notificationPermission),
      remove: removePermission, onAdded: { addListener: vi.fn() } },
    action: { setBadgeText: vi.fn().mockResolvedValue(undefined), setBadgeBackgroundColor: vi.fn().mockResolvedValue(undefined) },
  });
  await import('../src/background/service-worker');
});

describe('schoolbag worker access', () => {
  it('reads only the active profile, includes lessons, survives session errors and clears with history', async () => {
    const lesson = { ...parsed.points[0]!, TypePunt: 2, Titel: 'Synthetic lesson', PublicComment: 'Atlas meebrengen', VakNaam: 'Aardrijkskunde' };
    vi.mocked(fetchAgenda).mockResolvedValue({ ...success, count: 1, typeCounts: { tests: 0, assignments: 0, review: 0, other: 1 }, points: [lesson] });
    await dispatch({ type: 'agenda.check', requestUrl });
    expect(await dispatch({ type: 'schoolbag.read' })).toMatchObject({ ok: true, points: [{
      category: 'other', instructions: 'Atlas meebrengen', subject: 'Aardrijkskunde',
    }] });
    const website = { id: sender.id, url: 'https://schoolware_siw.ksgwl.be/webouders/start.html', tab: { id: 1 }, frameId: 0 };
    expect(listener({ type: 'schoolbag.read' }, website, vi.fn())).toBe(false);
    const first = await dispatch({ type: 'schoolbag.read' });
    vi.mocked(fetchAgenda).mockResolvedValue({ status: 'session-required', count: null });
    await dispatch({ type: 'agenda.check', requestUrl });
    expect(await dispatch({ type: 'schoolbag.read' })).toEqual(first);
    vi.mocked(fetchAgenda).mockResolvedValue({ ...success, count: 1, typeCounts: { tests: 0, assignments: 0, review: 0, other: 1 }, points: [{ ...lesson, PublicComment: 'Schrift meebrengen' }] });
    await dispatch({ type: 'agenda.check', requestUrl: requestUrl.replace('CompletedTaskForLL=30', 'CompletedTaskForLL=40') });
    const other = await dispatch({ type: 'schoolbag.read' });
    expect(other).toMatchObject({ points: [{ instructions: 'Schrift meebrengen' }] });
    expect(JSON.stringify(other)).not.toContain('Atlas meebrengen');
    await dispatch({ type: 'history.clear' });
    expect(await dispatch({ type: 'schoolbag.read' })).toEqual({ ok: true, lastSuccessAt: null, points: [] });
  });
});

describe('main extension navigation', () => {
  it('serializes simultaneous opens and reuses a loading tab without reading Schoolware', async () => {
    const tab = { id: 7, windowId: 3, url: `chrome-extension://${sender.id}/options.html` } as chrome.tabs.Tab;
    vi.mocked(chrome.tabs.create).mockImplementation(async () => tab);
    vi.mocked(chrome.tabs.get).mockImplementation(async () => tab);
    vi.mocked(chrome.tabs.update).mockImplementation(async () => tab);
    expect(await Promise.all([dispatch({ type: 'ui.open', page: 'options' }),
      dispatch({ type: 'ui.open', page: 'dashboard' })])).toEqual([{ ok: true }, { ok: true }]);
    expect(chrome.tabs.create).toHaveBeenCalledOnce();
    expect(chrome.tabs.update).toHaveBeenCalledOnce();
    expect(fetchAgenda).not.toHaveBeenCalled();
    expect(listener({ type: 'ui.open', page: 'options' }, {
      id: sender.id, url: 'https://schoolware_siw.ksgwl.be/webouders/start.html', tab: { id: 1 }, frameId: 0,
    }, () => {})).toBe(false);
  });
});

describe('automatic progress activity', () => {
  it('records manual and minute-alarm synchronization with shared correlations, also after a worker restart', async () => {
    const code = `sw1.${'a'.repeat(64)}.${'b'.repeat(64)}`;
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => Response.json({ ok: true, acknowledged: [], operations: [], cursor: 0, head: 0 })));
    await dispatch({ type: 'agenda.check', requestUrl });
    await dispatch({ type: 'sync.connect', code, seed: false });
    const { PROGRESS_SYNC_ALARM } = await import('../src/background/progress-sync');
    alarmListener({ name: PROGRESS_SYNC_ALARM, scheduledTime: Date.now() + 60000, persistAcrossSessions: true });
    const automatic = async () => (await new ActivityRepository().read()).entries.filter((entry) =>
      entry.action === 'progress.sync' && entry.phase === 'succeeded' && entry.data.trigger === 'alarm');
    await vi.waitFor(async () => expect(await automatic()).toHaveLength(1));
    vi.resetModules(); await import('../src/background/service-worker');
    await dispatch({ type: 'connection.read' });
    alarmListener({ name: PROGRESS_SYNC_ALARM, scheduledTime: Date.now() + 120000, persistAcrossSessions: true });
    await vi.waitFor(async () => expect(await automatic()).toHaveLength(2));
    const entries = (await new ActivityRepository().read(500)).entries;
    const alarmRuns = await automatic();
    expect(new Set(alarmRuns.map((entry) => entry.correlationId)).size).toBe(2);
    for (const run of alarmRuns) {
      expect(run.context).toBe('alarm');
      expect(entries.some((entry) => entry.correlationId === run.correlationId && entry.action === 'alarm.fired' && entry.data.alarm === 'progress-sync')).toBe(true);
      expect(entries.some((entry) => entry.correlationId === run.correlationId && entry.action === 'progress.exchange' && entry.phase === 'succeeded')).toBe(true);
    }
    expect(entries.some((entry) => entry.action === 'progress.sync' && entry.phase === 'succeeded' && entry.data.trigger === 'manual')).toBe(true);
    expect(JSON.stringify(entries)).not.toContain(code);
  });

  it('records automatic server failures while preserving the minute retry alarm', async () => {
    const code = `sw1.${'a'.repeat(64)}.${'b'.repeat(64)}`;
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => Response.json({ ok: true, acknowledged: [], operations: [], cursor: 0, head: 0 })));
    await dispatch({ type: 'agenda.check', requestUrl });
    await dispatch({ type: 'sync.connect', code, seed: false });
    const { PROGRESS_SYNC_ALARM, progressSync } = await import('../src/background/progress-sync');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error(`Private network error ${code}`)));
    alarmListener({ name: PROGRESS_SYNC_ALARM, scheduledTime: Date.now() + 60000, persistAcrossSessions: true });
    await vi.waitFor(async () => {
      const entries = (await new ActivityRepository().read()).entries;
      expect(entries.some((entry) => entry.action === 'progress.sync' && entry.phase === 'failed' &&
        entry.context === 'alarm' && entry.data.trigger === 'alarm' && entry.data.reason === 'network-error')).toBe(true);
    });
    expect(await progressSync.view()).toMatchObject({ error: true });
    expect(await chrome.alarms.get(PROGRESS_SYNC_ALARM)).toBeDefined();
    expect(JSON.stringify((await new ActivityRepository().read()).entries)).not.toContain(code);
  });
});

describe('Schoolware page banners', () => {
  it('delivers a private to-do reminder in both channels once per day, opens its current overview and updates the banner as tasks finish', async () => {
    vi.setSystemTime(new Date('2026-10-02T14:00:00.000Z'));
    const task = { ...parsed.points[0]!, TypePunt: 1001, Van: '2026-10-05 09:00:00', Tot: '2026-10-05 09:50:00', Titel: 'Synthetic private task' };
    vi.mocked(fetchAgenda).mockResolvedValue({ ...success, points: [task, { ...task, ID: task.ID + 1 }], count: 2,
      typeCounts: { assignments: 2, tests: 0, review: 0, other: 0 } });
    await dispatch({ type: 'preferences.save', preferences: { ...DEFAULT_PREFERENCES, notificationsEnabled: true, browserNotificationsEnabled: true } });
    await dispatch({ type: 'agenda.check', requestUrl });
    let banners = validateBrowserAlertsView(await dispatch({ type: 'browser.alerts.read' }))!;
    expect(banners.entries).toHaveLength(1);
    const reminder = banners.entries[0]!;
    expect(reminder).toMatchObject({ kind: 'todo', pending: 2, targetDay: '2026-10-05' });
    expect(createNotification).toHaveBeenCalledOnce();
    expect(createNotification).toHaveBeenCalledWith(`schoolware-watch-${reminder.id}`, expect.objectContaining({
      title: 'Schoolware Watch', message: expect.stringContaining('To-do: 2'),
    }));
    expect(JSON.stringify(createNotification.mock.calls)).not.toContain('Synthetic private task');
    expect(JSON.stringify(banners)).not.toContain('Synthetic private task');
    expect(validateNotificationDetailsView(await dispatch({ type: 'notifications.details', target: reminder.id }))).toEqual({ ok: true, status: 'todo', details: null });
    await dispatch({ type: 'browser.alerts.open', alertId: reminder.id });
    expect(chrome.tabs.create).toHaveBeenCalledWith({ url: `chrome-extension://${sender.id}/dashboard.html?alert=${reminder.id}` });
    clicked(`schoolware-watch-${reminder.id}`);
    await vi.waitFor(() => expect(chrome.notifications.clear).toHaveBeenCalledWith(`schoolware-watch-${reminder.id}`));
    vi.resetModules(); await import('../src/background/service-worker');
    await dispatch({ type: 'agenda.check', requestUrl });
    expect(createNotification).toHaveBeenCalledOnce();
    expect(validateBrowserAlertsView(await dispatch({ type: 'browser.alerts.read' }))!.entries).toHaveLength(1);
    const tasks = validateTasksView(await dispatch({ type: 'tasks.read' }))!.entries;
    await dispatch({ type: 'tasks.update', itemId: tasks[0]!.id, status: 'done' });
    banners = validateBrowserAlertsView(await dispatch({ type: 'browser.alerts.read' }))!;
    expect(banners.entries[0]).toMatchObject({ pending: 1 });
    await dispatch({ type: 'tasks.update', itemId: tasks[1]!.id, status: 'done' });
    expect(validateBrowserAlertsView(await dispatch({ type: 'browser.alerts.read' }))!.entries).toEqual([]);
    const originalConnection = stored[CONNECTION_KEY];
    stored[CONNECTION_KEY] = { requestUrl: requestUrl.replace('CompletedTaskForLL=30', 'CompletedTaskForLL=40'), lastCheck: null };
    expect(await dispatch({ type: 'notifications.details', target: reminder.id })).toMatchObject({ status: 'missing' });
    stored[CONNECTION_KEY] = originalConnection;
    await dispatch({ type: 'history.clear' });
    expect(await dispatch({ type: 'notifications.details', target: reminder.id })).toMatchObject({ status: 'missing' });
  });

  it('respects channel claims, dismissal, permissions and daily rollover without replaying a reminder on each check', async () => {
    vi.setSystemTime(new Date('2026-10-02T14:00:00.000Z'));
    const task = { ...parsed.points[0]!, TypePunt: 1001, Van: '2026-10-05 09:00:00', Tot: '2026-10-05 09:50:00' };
    vi.mocked(fetchAgenda).mockResolvedValue({ ...success, points: [task], count: 1, typeCounts: { assignments: 1, tests: 0, review: 0, other: 0 } });
    await dispatch({ type: 'preferences.save', preferences: { ...DEFAULT_PREFERENCES, browserNotificationsEnabled: true } });
    await dispatch({ type: 'agenda.check', requestUrl });
    const first = validateBrowserAlertsView(await dispatch({ type: 'browser.alerts.read' }))!.entries[0]!;
    expect(createNotification).not.toHaveBeenCalled();
    await dispatch({ type: 'browser.alerts.dismiss' });
    await dispatch({ type: 'preferences.save', preferences: { ...DEFAULT_PREFERENCES, browserNotificationsEnabled: true, notificationsEnabled: true } });
    notificationPermission = false;
    await dispatch({ type: 'agenda.check', requestUrl });
    expect(createNotification).not.toHaveBeenCalled();
    notificationPermission = true;
    await dispatch({ type: 'agenda.check', requestUrl });
    expect(createNotification).toHaveBeenCalledOnce();
    expect(createNotification.mock.calls[0]![0]).toBe(`schoolware-watch-${first.id}`);
    expect(validateBrowserAlertsView(await dispatch({ type: 'browser.alerts.read' }))!.entries).toEqual([]);
    vi.setSystemTime(new Date('2026-10-03T14:00:00.000Z'));
    vi.mocked(fetchAgenda).mockResolvedValueOnce({ status: 'session-required', count: null });
    await dispatch({ type: 'agenda.check', requestUrl });
    expect(createNotification).toHaveBeenCalledOnce();
    await dispatch({ type: 'agenda.check', requestUrl });
    expect(createNotification).toHaveBeenCalledTimes(2);
    expect(validateBrowserAlertsView(await dispatch({ type: 'browser.alerts.read' }))!.entries[0]?.id).not.toBe(first.id);
    await dispatch({ type: 'preferences.save', preferences: { ...DEFAULT_PREFERENCES, browserNotificationsEnabled: true, notificationsEnabled: true, todoRemindersEnabled: false } });
    expect(validateBrowserAlertsView(await dispatch({ type: 'browser.alerts.read' }))!.entries).toEqual([]);
    await dispatch({ type: 'agenda.check', requestUrl });
    expect(createNotification).toHaveBeenCalledTimes(2);
  });

  it('migrates the reminder preference without changing existing channels or monitoring choices', async () => {
    const legacy = { ...DEFAULT_PREFERENCES, notificationsEnabled: true, browserNotificationsEnabled: true,
      intervalMinutes: 30, newColor: '#123456' };
    Reflect.deleteProperty(legacy, 'todoRemindersEnabled');
    stored[PREFERENCES_KEY] = legacy;
    expect(await dispatch({ type: 'preferences.read' })).toMatchObject({ preferences: {
      ...legacy, todoRemindersEnabled: true,
    } });
    await expect(dispatch({ type: 'preferences.save', preferences: { ...DEFAULT_PREFERENCES, todoRemindersEnabled: 'yes' } })).rejects.toThrow('Message rejected');
  });

  it('keeps a successful observation and daily claim when the operating system notification API fails', async () => {
    vi.setSystemTime(new Date('2026-10-02T14:00:00.000Z'));
    const task = { ...parsed.points[0]!, TypePunt: 1001, Van: '2026-10-05 09:00:00', Tot: '2026-10-05 09:50:00' };
    vi.mocked(fetchAgenda).mockResolvedValue({ ...success, points: [task], count: 1, typeCounts: { assignments: 1, tests: 0, review: 0, other: 0 } });
    await dispatch({ type: 'preferences.save', preferences: { ...DEFAULT_PREFERENCES, notificationsEnabled: true } });
    createNotification.mockRejectedValue(new Error('Synthetic OS failure'));
    expect(await dispatch({ type: 'agenda.check', requestUrl })).toMatchObject({ lastCheck: { status: 'success' } });
    expect(validateTasksView(await dispatch({ type: 'tasks.read' }))!.entries).toHaveLength(1);
    await dispatch({ type: 'agenda.check', requestUrl });
    expect(createNotification).toHaveBeenCalledOnce();
  });

  it('enables and injects a test banner directly after permission is granted, without requiring a prior settings save', async () => {
    browserPermission = false;
    expect(await dispatch({ type: 'browser.alerts.test' })).toMatchObject({ ok: false });
    expect(stored[PREFERENCES_KEY]).toBeUndefined();
    expect(registeredScripts).toEqual([]);
    browserPermission = true;
    const test = validateBrowserAlertsView(await dispatch({ type: 'browser.alerts.test' }))!;
    expect(test.enabled).toBe(true);
    expect(test.entries[0]?.test).toBe(true);
    expect(stored[PREFERENCES_KEY]).toMatchObject({ ...DEFAULT_PREFERENCES, browserNotificationsEnabled: true });
    expect(chrome.scripting.executeScript).toHaveBeenCalledWith({ target: { tabId: 1 }, files: ['website-alert.js'] });
    await dispatch({ type: 'browser.alerts.open', alertId: test.entries[0]!.id });
    await vi.waitFor(() => expect(chrome.tabs.create).toHaveBeenCalledWith({ url: `chrome-extension://${sender.id}/dashboard.html?alert=test` }));
    expect(await dispatch({ type: 'notifications.details', target: 'test' })).toMatchObject({ status: 'test' });
    expect(await dispatch({ type: 'history.read' })).toMatchObject({ itemCount: 0, eventCount: 0 });
    await dispatch({ type: 'browser.alerts.dismiss' });
    expect(await dispatch({ type: 'browser.alerts.open', alertId: test.entries[0]!.id })).toMatchObject({ ok: false });
  });

  it('preserves old settings and leaves the banner off during preference migration', async () => {
    const old = { ...DEFAULT_PREFERENCES, intervalMinutes: 30, notificationsEnabled: true, newColor: '#123456' };
    Reflect.deleteProperty(old, 'browserNotificationsEnabled');
    stored[PREFERENCES_KEY] = old;
    expect(await dispatch({ type: 'preferences.read' })).toMatchObject({ preferences: {
      intervalMinutes: 30, notificationsEnabled: true, newColor: '#123456', browserNotificationsEnabled: false } });
    expect(registeredScripts).toEqual([]);
  });

  it('persists banner intent but registers and injects only with Schoolware permission', async () => {
    browserPermission = false;
    expect(await dispatch({ type: 'preferences.save', preferences: { ...DEFAULT_PREFERENCES, browserNotificationsEnabled: true } })).toMatchObject({ ok: true, browserPermission: false });
    expect(registeredScripts).toEqual([]);
    browserPermission = true;
    await dispatch({ type: 'preferences.save', preferences: { ...DEFAULT_PREFERENCES, browserNotificationsEnabled: true } });
    expect(registeredScripts[0]).toMatchObject({ matches: ['https://schoolware_siw.ksgwl.be/*'], world: 'ISOLATED', allFrames: false });
    expect(chrome.scripting.executeScript).toHaveBeenCalledWith({ target: { tabId: 1 }, files: ['website-alert.js'] });
    expect(chrome.scripting.executeScript).toHaveBeenCalledTimes(1);
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(1, { type: 'browser.alerts.updated' }, { frameId: 0 });
    expect(chrome.tabs.sendMessage).not.toHaveBeenCalledWith(2, expect.anything(), expect.anything());
  });

  it('retains a test banner through restart and dismisses it without changing history', async () => {
    notificationPermission = false;
    await dispatch({ type: 'preferences.save', preferences: { ...DEFAULT_PREFERENCES, browserNotificationsEnabled: true } });
    const test = validateBrowserAlertsView(await dispatch({ type: 'browser.alerts.test' }))!;
    expect(test.entries).toHaveLength(1);
    expect(test.entries[0]).toMatchObject({ test: true, added: 0, changed: 0 });
    expect(createNotification).not.toHaveBeenCalled();
    expect(chrome.action.setBadgeText).toHaveBeenLastCalledWith({ text: '1' });
    expect(JSON.stringify(test)).not.toContain('scopeId');
    vi.resetModules();
    await import('../src/background/service-worker');
    expect(await dispatch({ type: 'browser.alerts.read' })).toEqual(test);
    expect(await dispatch({ type: 'history.read' })).toMatchObject({ itemCount: 0, eventCount: 0 });
    expect(await dispatch({ type: 'browser.alerts.dismiss' })).toMatchObject({ entries: [] });
    expect(chrome.action.setBadgeText).toHaveBeenLastCalledWith({ text: '' });
  });

  it('publishes upcoming changes independently of OS permission and does not repeat unchanged checks', async () => {
    notificationPermission = false;
    await dispatch({ type: 'preferences.save', preferences: { ...DEFAULT_PREFERENCES, browserNotificationsEnabled: true } });
    const upcoming = { ...parsed.points[0]!, TypePunt: 101, Van: '2026-10-03 09:00:00', Tot: '2026-10-03 09:50:00' };
    const upcomingResult: AgendaFetchResult = { ...success, count: 1, typeCounts: { tests: 1, assignments: 0, review: 0, other: 0 }, points: [upcoming] };
    vi.mocked(fetchAgenda).mockResolvedValue(upcomingResult);
    await dispatch({ type: 'agenda.check', requestUrl });
    expect(await dispatch({ type: 'browser.alerts.read' })).toMatchObject({ entries: [] });
    vi.mocked(fetchAgenda).mockResolvedValue({ ...upcomingResult, points: [{ ...upcoming, Titel: 'Synthetic changed test' }] });
    await dispatch({ type: 'agenda.check', requestUrl });
    const first = validateBrowserAlertsView(await dispatch({ type: 'browser.alerts.read' }))!;
    expect(first.entries[0]).toMatchObject({ added: 0, changed: 1, test: false });
    expect(JSON.stringify(first)).not.toContain('Synthetic');
    expect(JSON.stringify(first)).not.toContain('410000');
    expect(JSON.stringify(first)).not.toContain('scopeId');
    await dispatch({ type: 'agenda.check', requestUrl });
    expect(await dispatch({ type: 'browser.alerts.read' })).toEqual(first);
    expect(createNotification).not.toHaveBeenCalled();
    const target = first.entries[0]!.id;
    await dispatch({ type: 'browser.alerts.open', alertId: target });
    await vi.waitFor(() => expect(chrome.tabs.create).toHaveBeenCalledWith({ url: `chrome-extension://${sender.id}/dashboard.html?alert=${target}` }));
    const details = await dispatch({ type: 'notifications.details', target });
    expect(details).toMatchObject({ status: 'available', details: { lessons: [{ items: [{ kind: 'changed' }] }] } });
    vi.resetModules();
    await import('../src/background/service-worker');
    expect(await dispatch({ type: 'notifications.details', target })).toEqual(details);
    // A notification from a previous profile cannot reveal its lesson details.
    await dispatch({ type: 'agenda.check', requestUrl: requestUrl.replace('CompletedTaskForLL=30', 'CompletedTaskForLL=40') });
    expect(await dispatch({ type: 'notifications.details', target })).toEqual({ ok: true, status: 'missing', details: null });
    expect(await dispatch({ type: 'browser.alerts.open', alertId: target })).toMatchObject({ ok: false });
    await dispatch({ type: 'agenda.check', requestUrl });
    await dispatch({ type: 'history.clear' });
    expect(await dispatch({ type: 'browser.alerts.read' })).toMatchObject({ entries: [] });
  });

  it('unregisters the banner when disabled and clears its inbox/badge on disconnect', async () => {
    await dispatch({ type: 'preferences.save', preferences: { ...DEFAULT_PREFERENCES, browserNotificationsEnabled: true } });
    await dispatch({ type: 'browser.alerts.test' });
    expect(stored[BROWSER_ALERTS_KEY]).toBeDefined();
    await dispatch({ type: 'preferences.save', preferences: DEFAULT_PREFERENCES });
    expect(registeredScripts).toEqual([]);
    expect(await dispatch({ type: 'browser.alerts.read' })).toEqual({ ok: true, enabled: false, entries: [] });
    expect(chrome.action.setBadgeText).toHaveBeenLastCalledWith({ text: '' });
    await dispatch({ type: 'connection.clear' });
    expect(stored).toEqual({});
    expect(chrome.permissions.remove).toHaveBeenCalledWith({ origins: ['https://schoolware_siw.ksgwl.be/*', 'https://schoolware.bumper.be/*'], permissions: ['scripting', 'webRequest'] });
  });

  it('restricts content-script senders to generic banner actions on the Schoolware top frame', async () => {
    const website = { ...sender, url: 'https://schoolware_siw.ksgwl.be/webouders/start.html', tab: { id: 1 }, frameId: 0 };
    const reply = vi.fn();
    for (const type of ['connection.read', 'history.read', 'preferences.read', 'browser.alerts.test']) {
      expect(listener({ type }, website, reply)).toBe(false);
    }
    expect(listener({ type: 'notifications.details', target: 'test' }, website, reply)).toBe(false);
    expect(listener({ type: 'agenda.check', requestUrl }, website, reply)).toBe(false);
    expect(listener({ type: 'browser.alerts.read' }, { ...website, url: 'https://example.test/' }, reply)).toBe(false);
    expect(listener({ type: 'browser.alerts.read' }, { ...website, frameId: 1 }, reply)).toBe(false);
    expect(listener({ type: 'browser.alerts.read' }, website, reply)).toBe(true);
    await vi.waitFor(() => expect(reply).toHaveBeenCalledWith({ ok: true, enabled: false, entries: [] }));
    expect(fetchAgenda).not.toHaveBeenCalled();
  });
});

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('activity correlation and local task status', () => {
  it('logs failed Schoolware injection counts without leaking exception text, while keeping the generic pending banner', async () => {
    vi.mocked(chrome.scripting.executeScript).mockRejectedValue(new Error('Synthetic private page error'));
    const view = validateBrowserAlertsView(await dispatch({ type: 'browser.alerts.test' }))!;
    const id = view.entries[0]!.id;
    const records = validateActivityView(await dispatch({ type: 'activity.read', correlationId: id }))!;
    expect(records.entries.find((entry) => entry.action === 'website.script' && entry.phase === 'failed')).toMatchObject({
      data: { count: 1, failedCount: 1, registered: true, reason: 'api-error' } });
    expect(records.entries.some((entry) => entry.action === 'banner.published')).toBe(true);
    expect(JSON.stringify(records)).not.toContain('private page error');
  });

  it('keeps diagnostics readable when startup restoration fails', async () => {
    await dispatch({ type: 'preferences.read' });
    vi.mocked(chrome.scripting.getRegisteredContentScripts).mockRejectedValue(new Error('Synthetic private startup error'));
    vi.resetModules(); await import('../src/background/service-worker');
    const view = validateActivityView(await dispatch({ type: 'activity.read' }))!;
    expect(view.ok).toBe(true);
    expect(view.entries.some((entry) => entry.action === 'website.script' && entry.phase === 'failed')).toBe(true);
    expect(JSON.stringify(view)).not.toContain('private startup error');
  });
  it('links creation, banner rendering, opening and dismissal to the same correlation ID without logging source contents', async () => {
    await dispatch({ type: 'agenda.check', requestUrl });
    const test = validateBrowserAlertsView(await dispatch({ type: 'browser.alerts.test' }))!;
    const id = test.entries[0]!.id;
    await dispatch({ type: 'browser.alerts.rendered', alertIds: [id] });
    await dispatch({ type: 'browser.alerts.open', alertId: id });
    await dispatch({ type: 'browser.alerts.dismiss' });
    const view = validateActivityView(await dispatch({ type: 'activity.read', correlationId: id }))!;
    expect(view.healthy).toBe(true);
    expect(view.entries.map((entry) => entry.action)).toEqual(expect.arrayContaining(['banner.published', 'banner.rendered', 'banner.opened', 'banner.dismissed']));
    expect(view.entries.every((entry) => entry.correlationId === id)).toBe(true);
    expect(JSON.stringify(view)).not.toContain('CompletedTaskForLL');
    expect(JSON.stringify(view)).not.toContain('410000');
    expect(JSON.stringify(view)).not.toContain(parsed.points[0]!.Titel);
    expect(await dispatch({ type: 'browser.alerts.rendered', alertIds: [id] })).toMatchObject({ ok: false });
    await dispatch({ type: 'activity.clear' });
    expect((await new ActivityRepository().read()).entries).toEqual([]);
  });

  it('persists native notification click and closure timestamps through worker restart and does not recreate deleted correlations', async () => {
    await dispatch({ type: 'notifications.test' });
    const id = createNotification.mock.calls[0]![0] as string;
    const correlationId = id.replace('schoolware-watch-test-', '');
    vi.resetModules(); await import('../src/background/service-worker');
    vi.setSystemTime(new Date('2026-10-02T08:01:00Z'));
    clicked(id);
    await vi.waitFor(() => expect(chrome.tabs.create).toHaveBeenCalled());
    vi.setSystemTime(new Date('2026-10-02T08:02:00Z'));
    closed(id, true);
    await vi.waitFor(async () => {
      const view = await new ActivityRepository().read(500, { correlationId });
      expect(view.entries.find((entry) => entry.action === 'notification.closed')).toMatchObject({
        timestamp: '2026-10-02T08:02:00.000Z', data: { reason: 'user' } });
      expect(view.entries.find((entry) => entry.action === 'notification.clicked')).toMatchObject({
        timestamp: '2026-10-02T08:01:00.000Z' });
    });
    await dispatch({ type: 'connection.clear' });
    closed(id, false);
    await dispatch({ type: 'preferences.read' });
    expect((await new ActivityRepository().read(500, { correlationId })).total).toBe(0);
  });

  it('saves a bulk selection through the worker while leaving unselected work and Schoolware untouched', async () => {
    const base = { ...parsed.points[0]!, TypePunt: 1001 };
    const points = [base, { ...base, ID: base.ID + 1 }, { ...base, ID: base.ID + 2 }];
    vi.mocked(fetchAgenda).mockResolvedValue({ ...success, points, count: 3,
      typeCounts: { assignments: 3, tests: 0, review: 0, other: 0 } });
    await dispatch({ type: 'agenda.check', requestUrl });
    const first = validateTasksView(await dispatch({ type: 'tasks.read' }))!;
    const ids = first.entries.slice(0, 2).map((entry) => entry.id);
    const before = await dispatch({ type: 'history.read' });
    const message = { type: 'tasks.updateMany', itemIds: ids, status: 'done' };
    const result = validateTasksView(await dispatch(message))!;
    expect(result.entries.filter((entry) => ids.includes(entry.id)).every((entry) => entry.status === 'done')).toBe(true);
    expect(result.entries.find((entry) => !ids.includes(entry.id))?.status).toBe('open');
    expect(await dispatch({ type: 'history.read' })).toEqual(before);
    expect(fetchAgenda).toHaveBeenCalledOnce();
    expect(createNotification).not.toHaveBeenCalled();
    const website = { ...sender, url: 'https://schoolware_siw.ksgwl.be/webouders/start.html', tab: { id: 1 }, frameId: 0 };
    expect(listener(message, website, vi.fn())).toBe(false);
    vi.resetModules(); await import('../src/background/service-worker');
    expect(validateTasksView(await dispatch({ type: 'tasks.read' }))!.entries).toEqual(result.entries);
    const failed = await dispatch({ type: 'tasks.updateMany', itemIds: [ids[0]!, crypto.randomUUID()], status: 'open' });
    expect(failed).toMatchObject({ ok: false });
    expect(validateTasksView(await dispatch({ type: 'tasks.read' }))!.entries).toEqual(result.entries);
  });

  it('keeps progress local, reopens changed completed tasks across restarts and prevents cross-profile or website edits', async () => {
    const task = { ...parsed.points[0]!, TypePunt: 1001, Van: '2026-10-03 09:00:00', Tot: '2026-10-03 09:50:00' };
    const result: AgendaFetchResult = { ...success, points: [task], count: 1, typeCounts: { assignments: 1, tests: 0, review: 0, other: 0 } };
    vi.mocked(fetchAgenda).mockResolvedValue(result);
    await dispatch({ type: 'agenda.check', requestUrl });
    const first = validateTasksView(await dispatch({ type: 'tasks.read' }))!;
    const itemId = first.entries[0]!.id;
    expect(first.entries[0]!.status).toBe('open');
    const before = await dispatch({ type: 'history.read' });
    expect(await dispatch({ type: 'tasks.update', itemId, status: 'in-progress' })).toMatchObject({ entries: [{ status: 'in-progress' }] });
    expect(await dispatch({ type: 'tasks.update', itemId, status: 'done' })).toMatchObject({ entries: [{ status: 'done' }] });
    expect(await dispatch({ type: 'history.read' })).toEqual(before);
    expect(fetchAgenda).toHaveBeenCalledOnce();
    expect(createNotification).not.toHaveBeenCalled();
    vi.resetModules(); await import('../src/background/service-worker');
    vi.mocked(fetchAgenda).mockResolvedValue({ ...result, points: [{ ...task, Titel: 'Synthetic revised assignment' }] });
    await dispatch({ type: 'agenda.check', requestUrl });
    expect(await dispatch({ type: 'tasks.read' })).toMatchObject({ entries: [{ id: itemId, status: 'in-progress' }] });
    const website = { ...sender, url: 'https://schoolware_siw.ksgwl.be/webouders/start.html', tab: { id: 1 }, frameId: 0 };
    for (const type of ['tasks.read', 'activity.read', 'activity.clear']) expect(listener({ type }, website, vi.fn())).toBe(false);
    expect(listener({ type: 'tasks.update', itemId, status: 'open' }, website, vi.fn())).toBe(false);
    await dispatch({ type: 'agenda.check', requestUrl: requestUrl.replace('CompletedTaskForLL=30', 'CompletedTaskForLL=40') });
    expect(await dispatch({ type: 'tasks.update', itemId, status: 'open' })).toMatchObject({ ok: false });
    await dispatch({ type: 'agenda.check', requestUrl });
    expect(await dispatch({ type: 'tasks.read' })).toMatchObject({ entries: [{ id: itemId, status: 'in-progress' }] });
    const logs = validateActivityView(await dispatch({ type: 'activity.read', itemId }))!;
    expect(logs.entries.filter((entry) => entry.action === 'task.status')).toHaveLength(3);
    await dispatch({ type: 'history.clear' });
    expect(await dispatch({ type: 'tasks.read' })).toEqual({ ok: true, entries: [] });
    expect((await new ActivityRepository().read(500, { itemId })).total).toBe(0);
  });

  it('exposes logging failures instead of claiming a complete activity log, and clearing logs resets health', async () => {
    await dispatch({ type: 'preferences.read' });
    const { ActivityRepository: WorkerActivity } = await import('../src/storage/activity');
    const failure = vi.spyOn(WorkerActivity.prototype, 'append').mockRejectedValue(new Error('Synthetic private storage error'));
    expect(await dispatch({ type: 'preferences.read' })).toMatchObject({ ok: true });
    const view = validateActivityView(await dispatch({ type: 'activity.read' }))!;
    expect(view.healthy).toBe(false);
    expect(JSON.stringify(stored)).not.toContain('private storage error');
    failure.mockRestore();
    expect(await dispatch({ type: 'activity.clear' })).toMatchObject({ healthy: true, entries: [] });
  });
});

describe('worker connection lifecycle', () => {
  it('stores only a canonical link and summary, independently of a mounted popup', async () => {
    const result = await dispatch({ type: 'agenda.check', requestUrl });
    expect(stored[CONNECTION_KEY]).toEqual(result);
    expect(result).toMatchObject({ lastCheck: { status: 'success', count: 2 } });
    expect(await dispatch({ type: 'connection.read' })).toEqual(result);
    expect(Object.keys(stored)).toEqual([CONNECTION_KEY, 'schoolwareMonitoringState']);
    expect(JSON.stringify(result)).not.toContain('points');
  });

  it('rejects messages from the Schoolware page or with secret-bearing fields', () => {
    const reply = vi.fn();
    expect(listener({ type: 'agenda.check', requestUrl }, { ...sender, url: requestUrl }, reply)).toBe(false);
    expect(listener({ type: 'agenda.check', requestUrl, cookie: 'synthetic-secret' }, sender, reply)).toBe(false);
    expect(fetchAgenda).not.toHaveBeenCalled();
    expect(reply).not.toHaveBeenCalled();
  });

  it('prevents overlapping manual checks', async () => {
    let finish!: (result: AgendaFetchResult) => void;
    vi.mocked(fetchAgenda).mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const first = dispatch({ type: 'agenda.check', requestUrl });
    await vi.waitFor(() => expect(fetchAgenda).toHaveBeenCalledTimes(1));
    expect(await dispatch({ type: 'agenda.check', requestUrl })).toMatchObject({ lastCheck: { status: 'busy' } });
    finish(success);
    await first;
    expect(fetchAgenda).toHaveBeenCalledTimes(1);
  });

  it('clears local state, revokes access and prevents an in-flight result restoring it', async () => {
    let finish!: (result: AgendaFetchResult) => void;
    vi.mocked(fetchAgenda).mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const first = dispatch({ type: 'agenda.check', requestUrl });
    await vi.waitFor(() => expect(fetchAgenda).toHaveBeenCalledTimes(1));
    const clear = dispatch({ type: 'connection.clear' });
    await vi.waitFor(() => expect(vi.mocked(fetchAgenda).mock.calls[0]?.[1]?.signal?.aborted).toBe(true));
    finish(success);
    expect(await clear).toEqual({ requestUrl: null, lastCheck: null });
    expect(await first).toEqual({ requestUrl: null, lastCheck: null });
    expect(stored).toEqual({});
    expect(removePermission).toHaveBeenCalledOnce();
    expect((await new HistoryRepository().read(requestUrl)).scope).toBeNull();
  });

  it('keeps the baseline through a worker restart and records no events on session failure', async () => {
    await dispatch({ type: 'agenda.check', requestUrl });
    const first = await dispatch({ type: 'history.read' });
    expect(first).toMatchObject({ ok: true, itemCount: 2, eventCount: 2 });
    vi.resetModules();
    await import('../src/background/service-worker');
    await dispatch({ type: 'agenda.check', requestUrl });
    expect(await dispatch({ type: 'history.read' })).toMatchObject({ eventCount: 2,
      lastCounts: { baseline: 0, observed: 0, changed: 0 } });
    vi.mocked(fetchAgenda).mockResolvedValue({ status: 'session-required', count: null });
    await dispatch({ type: 'agenda.check', requestUrl });
    expect(await dispatch({ type: 'history.read' })).toMatchObject({ eventCount: 2, itemCount: 2 });
    expect(JSON.stringify(await dispatch({ type: 'connection.read' }))).not.toContain('Synthetic');
  });

  it('clears the active history without deleting connection settings and starts a new baseline', async () => {
    await dispatch({ type: 'agenda.check', requestUrl });
    expect(await dispatch({ type: 'history.clear' })).toMatchObject({ itemCount: 0, baselineAt: null });
    expect(await dispatch({ type: 'connection.read' })).toMatchObject({ requestUrl: expect.any(String) });
    await dispatch({ type: 'agenda.check', requestUrl });
    expect(await dispatch({ type: 'history.read' })).toMatchObject({ itemCount: 2, lastCounts: { baseline: 2 } });
  });
});

describe('periodic monitoring and optional notifications', () => {
  it('logs why newly observed points do not qualify, using only counts and the configured filters', async () => {
    const test = { ...parsed.points[0]!, TypePunt: 101, Van: '2026-10-03 09:00:00', Tot: '2026-10-03 09:50:00' };
    const baseline: AgendaFetchResult = { ...success, points: [test], count: 1, typeCounts: { tests: 1, assignments: 0, review: 0, other: 0 } };
    await dispatch({ type: 'preferences.save', preferences: { ...DEFAULT_PREFERENCES, notificationsEnabled: true } });
    vi.mocked(fetchAgenda).mockResolvedValue(baseline);
    await dispatch({ type: 'agenda.check', requestUrl });
    const outside = { ...test, ID: test.ID + 1, Van: '2026-10-10 09:00:00', Tot: '2026-10-10 09:50:00', Titel: 'Synthetic private later test' };
    const other = { ...test, ID: test.ID + 2, TypePunt: 1, Titel: 'Synthetic private lesson' };
    vi.mocked(fetchAgenda).mockResolvedValue({ ...baseline, points: [test, outside, other], count: 3 });
    await dispatch({ type: 'agenda.check', requestUrl });
    const audit = validateActivityView(await dispatch({ type: 'activity.read' }))!;
    const selection = audit.entries.find((entry) => entry.action === 'notification.selection');
    expect(selection).toMatchObject({ phase: 'skipped', data: { reason: 'no-events', count: 2,
      baselineCount: 0, categoryExcludedCount: 1, outsideWindowCount: 1, inactiveCount: 0, days: 3, categories: ['tests', 'assignments'] } });
    expect(JSON.stringify(audit)).not.toContain('Synthetic private');
    expect(createNotification).not.toHaveBeenCalled();
  });
  it('starts and disconnects when the optional notifications API is unavailable', async () => {
    notificationPermission = false;
    vi.stubGlobal('chrome', { ...chrome, notifications: undefined });
    vi.resetModules();
    await import('../src/background/service-worker');
    await dispatch({ type: 'agenda.check', requestUrl });
    expect(await dispatch({ type: 'preferences.read' })).toMatchObject({ monitoringScheduled: true, notificationPermission: false });
    expect(await dispatch({ type: 'connection.clear' })).toEqual({ requestUrl: null, lastCheck: null });
  });

  it('records a missing host permission and cancels the periodic schedule', async () => {
    await dispatch({ type: 'agenda.check', requestUrl });
    hostPermission = false;
    expect(await dispatch({ type: 'agenda.check', requestUrl })).toMatchObject({ lastCheck: { status: 'permission-required' } });
    expect(alarm).toBeUndefined();
    expect(fetchAgenda).toHaveBeenCalledTimes(1);
    expect(await dispatch({ type: 'history.read' })).toMatchObject({ itemCount: 2, eventCount: 2 });
  });

  it('does not overlap an alarm with an in-flight manual check', async () => {
    await dispatch({ type: 'agenda.check', requestUrl });
    let finish!: (result: AgendaFetchResult) => void;
    vi.mocked(fetchAgenda).mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const manual = dispatch({ type: 'agenda.check', requestUrl });
    await vi.waitFor(() => expect(fetchAgenda).toHaveBeenCalledTimes(2));
    alarmListener(alarm!);
    await dispatch({ type: 'preferences.read' });
    expect(fetchAgenda).toHaveBeenCalledTimes(2);
    finish(success);
    await manual;
  });

  it('schedules the default interval, restores a missing alarm after restart and keeps rolling dates out of the profile key', async () => {
    await dispatch({ type: 'agenda.check', requestUrl });
    expect(alarm?.periodInMinutes).toBe(15);
    expect(new URL(vi.mocked(fetchAgenda).mock.calls[0]![0] as string).searchParams.get('MaxVan')).toBe('2026-10-17');
    expect((await new HistoryRepository().read(scopeId)).scope?.checks[0]?.coverage).toEqual({ minTot: '2026-09-25', maxVan: '2026-10-17' });
    alarm = undefined;
    vi.resetModules();
    await import('../src/background/service-worker');
    expect(await dispatch({ type: 'preferences.read' })).toMatchObject({ monitoringScheduled: true });
    alarmListener(alarm!);
    await vi.waitFor(() => expect(fetchAgenda).toHaveBeenCalledTimes(2));
    await vi.waitFor(async () => expect((await new HistoryRepository().read(scopeId)).scope?.checks).toHaveLength(2));
  });

  it('updates or cancels the alarm when preferences change and does not fetch while disabled', async () => {
    await dispatch({ type: 'agenda.check', requestUrl });
    const oldAlarm = alarm!;
    await dispatch({ type: 'preferences.save', preferences: { ...DEFAULT_PREFERENCES, intervalMinutes: 5 } });
    expect(alarm?.periodInMinutes).toBe(5);
    await dispatch({ type: 'preferences.save', preferences: { ...DEFAULT_PREFERENCES, monitoringEnabled: false } });
    expect(alarm).toBeUndefined();
    alarmListener(oldAlarm);
    await dispatch({ type: 'preferences.read' });
    expect(fetchAgenda).toHaveBeenCalledTimes(1);
  });

  it('finishes handed-off rapid edits without a UI reply and preserves the reversal across restart', async () => {
    await dispatch({ type: 'preferences.read' });
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    let firstWrite = true;
    vi.mocked(chrome.storage.local.set).mockImplementation(async (value) => {
      if (PREFERENCES_KEY in value && firstWrite) { firstWrite = false; await blocked; }
      Object.assign(stored, value);
    });
    const replies = vi.fn();
    expect(listener({ type: 'preferences.save', preferences: { ...DEFAULT_PREFERENCES,
      notificationsEnabled: true, browserNotificationsEnabled: true } }, sender, replies)).toBe(true);
    await vi.waitFor(() => expect(firstWrite).toBe(false));
    // A closed settings document no longer needs to execute anything for this edit.
    expect(listener({ type: 'preferences.save', preferences: DEFAULT_PREFERENCES }, sender, replies)).toBe(true);
    release();
    await vi.waitFor(() => expect(replies).toHaveBeenCalledTimes(2));
    expect(stored[PREFERENCES_KEY]).toEqual(DEFAULT_PREFERENCES);
    expect(registeredScripts).toEqual([]);
    vi.resetModules();
    await import('../src/background/service-worker');
    expect(await dispatch({ type: 'preferences.read' })).toMatchObject({ preferences: DEFAULT_PREFERENCES });
  });

  it('reconciles a late permission grant against the latest disabled settings', async () => {
    browserPermission = false;
    notificationPermission = false;
    await dispatch({ type: 'preferences.save', preferences: { ...DEFAULT_PREFERENCES,
      notificationsEnabled: true, browserNotificationsEnabled: true } });
    expect(registeredScripts).toEqual([]);
    await dispatch({ type: 'preferences.save', preferences: DEFAULT_PREFERENCES });
    browserPermission = true;
    notificationPermission = true;
    const callbacks = vi.mocked(chrome.permissions.onAdded.addListener).mock.calls.map(([callback]) => callback);
    for (const callback of callbacks) callback({ permissions: ['notifications', 'scripting'],
      origins: ['https://schoolware_siw.ksgwl.be/*'] });
    await dispatch({ type: 'preferences.read' });
    expect(stored[PREFERENCES_KEY]).toEqual(DEFAULT_PREFERENCES);
    expect(registeredScripts).toEqual([]);
    expect(createNotification).not.toHaveBeenCalled();
    // Granting access to a still-enabled banner reconciles without another UI write.
    await dispatch({ type: 'preferences.save', preferences: { ...DEFAULT_PREFERENCES, browserNotificationsEnabled: true } });
    browserPermission = false;
    await dispatch({ type: 'preferences.save', preferences: { ...DEFAULT_PREFERENCES, browserNotificationsEnabled: true } });
    expect(registeredScripts).toEqual([]);
    browserPermission = true;
    for (const callback of callbacks) callback({ permissions: ['scripting'], origins: ['https://schoolware_siw.ksgwl.be/*'] });
    await vi.waitFor(() => expect(registeredScripts).toHaveLength(1));
  });

  it('persists backoff on session failure across a restart and lets a manual check retry immediately', async () => {
    vi.mocked(fetchAgenda).mockResolvedValue({ status: 'session-required', count: null });
    await dispatch({ type: 'agenda.check', requestUrl });
    expect(stored.schoolwareMonitoringState).toMatchObject({ failures: 1, retryAt: '2026-10-02T08:30:00.000Z' });
    vi.resetModules();
    await import('../src/background/service-worker');
    await dispatch({ type: 'connection.read' });
    alarmListener(alarm!);
    await dispatch({ type: 'preferences.read' });
    expect(fetchAgenda).toHaveBeenCalledTimes(1);
    vi.mocked(fetchAgenda).mockResolvedValue(success);
    await dispatch({ type: 'agenda.check', requestUrl });
    expect(stored.schoolwareMonitoringState).toEqual({ failures: 0, retryAt: null });
  });

  it('persists notification intent without permission but prevents delivery', async () => {
    notificationPermission = false;
    expect(await dispatch({ type: 'preferences.save', preferences: { ...DEFAULT_PREFERENCES, notificationsEnabled: true } })).toMatchObject({ ok: true, notificationPermission: false });
    expect(stored[PREFERENCES_KEY]).toMatchObject({ notificationsEnabled: true });
    expect(await dispatch({ type: 'notifications.test' })).toEqual({ status: 'permission-required', permissionLevel: 'unknown', registered: null });
    expect(createNotification).not.toHaveBeenCalled();
  });

  it('reports Chrome notification blocking even when extension permission was granted', async () => {
    vi.mocked(chrome.notifications.getPermissionLevel).mockImplementation(() => Promise.resolve('denied'));
    expect(await dispatch({ type: 'notifications.test' })).toEqual({ status: 'blocked', permissionLevel: 'denied', registered: null });
    expect(createNotification).not.toHaveBeenCalled();
  });

  it('creates a fresh persistent test toast and reports registration without claiming OS visibility', async () => {
    let listed: Record<string, true> = {};
    vi.mocked(chrome.notifications.getAll).mockImplementation(async () => listed);
    createNotification.mockImplementation(async (id: string) => { listed = { [id]: true }; return id; });
    expect(await dispatch({ type: 'notifications.test' })).toEqual({ status: 'accepted', permissionLevel: 'granted', registered: true });
    const firstId = createNotification.mock.calls[0]![0] as string;
    expect(createNotification.mock.calls[0]?.[1]).toMatchObject({ requireInteraction: true });
    await dispatch({ type: 'notifications.test' });
    expect(createNotification.mock.calls[1]![0]).not.toBe(firstId);
    expect(chrome.notifications.clear).toHaveBeenCalledWith(firstId);
    expect(JSON.stringify(stored)).not.toContain('test-');
    clicked(createNotification.mock.calls[1]![0] as string);
    await vi.waitFor(() => expect(chrome.tabs.create).toHaveBeenCalledWith({ url: `chrome-extension://${sender.id}/dashboard.html?alert=test` }));
    expect(await dispatch({ type: 'notifications.details', target: 'test' })).toMatchObject({ status: 'test' });
    expect(await dispatch({ type: 'history.read' })).toMatchObject({ itemCount: 0, eventCount: 0 });
  });

  it('distinguishes a missing registry entry, registry failure and notification creation failure', async () => {
    expect(await dispatch({ type: 'notifications.test' })).toEqual({ status: 'accepted', permissionLevel: 'granted', registered: false });
    vi.mocked(chrome.notifications.getAll).mockRejectedValue(new Error('Synthetic registry error'));
    expect(await dispatch({ type: 'notifications.test' })).toEqual({ status: 'accepted', permissionLevel: 'granted', registered: null });
    createNotification.mockRejectedValue(new Error('Synthetic create error'));
    expect(await dispatch({ type: 'notifications.test' })).toEqual({ status: 'api-error', permissionLevel: 'granted', registered: null });
  });

  it('notifies reopening and cancellation once, keeping completed status and history safe on incomplete responses and session errors', async () => {
    const task = { ...parsed.points[0]!, TypePunt: 1001, Van: '2026-10-03 09:00:00', Tot: '2026-10-03 09:50:00' };
    const result: AgendaFetchResult = { ...success, points: [task], count: 1,
      typeCounts: { assignments: 1, tests: 0, review: 0, other: 0 } };
    await dispatch({ type: 'preferences.save', preferences: { ...DEFAULT_PREFERENCES, notificationsEnabled: true,
      browserNotificationsEnabled: true, notificationCategories: ['assignments'] } });
    vi.mocked(fetchAgenda).mockResolvedValue(result);
    await dispatch({ type: 'agenda.check', requestUrl });
    const id = validateTasksView(await dispatch({ type: 'tasks.read' }))!.entries[0]!.id;
    await dispatch({ type: 'tasks.update', itemId: id, status: 'done' });
    vi.mocked(fetchAgenda).mockResolvedValue({ ...result, points: [{ ...task, PublicComment: 'Synthetic extra work' }] });
    await dispatch({ type: 'agenda.check', requestUrl });
    expect(await dispatch({ type: 'tasks.read' })).toMatchObject({ entries: [{ id, status: 'in-progress' }] });
    expect(createNotification).toHaveBeenCalledOnce();
    expect(createNotification.mock.calls[0]?.[1]).toMatchObject({ message: expect.stringContaining('1 voltooide taken weer op Bezig gezet') });
    const alertId = (createNotification.mock.calls[0]![0] as string).replace('schoolware-watch-', '');
    expect(await dispatch({ type: 'notifications.details', target: alertId })).toMatchObject({
      details: { lessons: [{ items: [{ taskReopened: true }] }] } });
    await dispatch({ type: 'agenda.check', requestUrl });
    expect(createNotification).toHaveBeenCalledOnce();
    vi.mocked(fetchAgenda).mockResolvedValue({ ...result, points: [{ ...task, PublicComment: 'Synthetic extra work', Vervalt: true }] });
    await dispatch({ type: 'agenda.check', requestUrl });
    expect(createNotification).toHaveBeenCalledTimes(2);
    expect(await dispatch({ type: 'tasks.read' })).toMatchObject({ entries: [] });
    expect(await dispatch({ type: 'browser.alerts.read' })).toMatchObject({ entries: [{ changed: 1 }, { changed: 1 }] });
    const before = await dispatch({ type: 'history.read' });
    vi.mocked(fetchAgenda).mockResolvedValue({ ...result, points: [], count: 0,
      typeCounts: { assignments: 0, tests: 0, review: 0, other: 0 } });
    await dispatch({ type: 'agenda.check', requestUrl });
    expect(await dispatch({ type: 'history.read' })).toMatchObject({ eventCount: 3, lastCounts: { disappeared: 0 } });
    vi.mocked(fetchAgenda).mockResolvedValue({ status: 'session-required', count: null });
    await dispatch({ type: 'agenda.check', requestUrl });
    expect(await dispatch({ type: 'history.read' })).toMatchObject({ entries: (before as { entries: unknown[] }).entries });
    expect(createNotification).toHaveBeenCalledTimes(2);
  });

  it('notifies for newly observed or changed upcoming points, never for baseline, unchanged checks or session errors', async () => {
    const upcoming = { ...parsed.points[0]!, TypePunt: 101, Van: '2026-10-03 09:00:00', Tot: '2026-10-03 09:50:00' };
    const baseline: AgendaFetchResult = { ...success, points: [upcoming], count: 1, typeCounts: { tests: 1, assignments: 0, review: 0, other: 0 } };
    await dispatch({ type: 'preferences.save', preferences: { ...DEFAULT_PREFERENCES, notificationsEnabled: true } });
    vi.mocked(fetchAgenda).mockResolvedValue(baseline);
    await dispatch({ type: 'agenda.check', requestUrl });
    expect(createNotification).not.toHaveBeenCalled();
    const changed = { ...upcoming, Titel: 'Synthetic revised test' };
    const added = { ...upcoming, ID: 41000000099, Titel: 'Synthetic new test' };
    vi.mocked(fetchAgenda).mockResolvedValue({ ...baseline, points: [changed, added], count: 2, typeCounts: { tests: 2, assignments: 0, review: 0, other: 0 } });
    await dispatch({ type: 'agenda.check', requestUrl });
    expect(createNotification).toHaveBeenCalledOnce();
    expect(createNotification.mock.calls[0]?.[1]).toMatchObject({ title: 'Schoolware Watch', message: expect.stringContaining('1 nieuwe of opnieuw zichtbare en 1 gewijzigde') });
    expect(JSON.stringify(createNotification.mock.calls)).not.toContain('Synthetic');
    expect(JSON.stringify(createNotification.mock.calls)).not.toContain('410000000');
    vi.resetModules();
    await import('../src/background/service-worker');
    await dispatch({ type: 'agenda.check', requestUrl });
    vi.mocked(fetchAgenda).mockResolvedValue({ status: 'session-required', count: null });
    await dispatch({ type: 'agenda.check', requestUrl });
    expect(createNotification).toHaveBeenCalledOnce();
    const scope = (await new HistoryRepository().read(scopeId)).scope!;
    expect(scope.checks.filter((check) => check.notificationClaimedAt)).toHaveLength(1);
    const notificationId = createNotification.mock.calls[0]![0] as string;
    const target = notificationId.replace('schoolware-watch-', '');
    clicked(notificationId);
    await vi.waitFor(() => expect(chrome.tabs.create).toHaveBeenCalledWith({ url: `chrome-extension://${sender.id}/dashboard.html?alert=${target}` }));
    const details = validateNotificationDetailsView(await dispatch({ type: 'notifications.details', target }))!;
    expect(details.status).toBe('available');
    expect(details.details!.lessons[0]!.items.map((item) => item.kind)).toEqual(['changed', 'observed']);
    expect(JSON.stringify(details)).not.toContain('CompletedTaskForLL');
    expect(JSON.stringify(details)).not.toContain('410000000');
    // Reading from the notification URL remains privileged, while arbitrary
    // query parameters and other extension origins are rejected.
    const routedSender = { ...sender, url: `chrome-extension://${sender.id}/dashboard.html?alert=${target}` };
    const read = await new Promise<unknown>((resolve) => {
      expect(listener({ type: 'notifications.details', target }, routedSender, resolve)).toBe(true);
    });
    expect(read).toEqual(details);
    await dispatch({ type: 'browser.alerts.test' });
    await dispatch({ type: 'browser.alerts.open', alertId: target });
    expect(chrome.tabs.create).toHaveBeenCalledTimes(1); // The OS alert is not in the browser inbox.
    await dispatch({ type: 'history.clear' });
    expect(await dispatch({ type: 'notifications.details', target })).toEqual({ ok: true, status: 'missing', details: null });
  });

  it('keeps a successful check when notification delivery fails and stops checks after disconnect', async () => {
    await dispatch({ type: 'preferences.save', preferences: { ...DEFAULT_PREFERENCES, notificationsEnabled: true } });
    await dispatch({ type: 'agenda.check', requestUrl });
    createNotification.mockRejectedValue(new Error('Synthetic OS failure'));
    const next = { ...parsed.points[0]!, TypePunt: 101, Van: '2026-10-03 09:00:00', Tot: '2026-10-03 09:50:00' };
    vi.mocked(fetchAgenda).mockResolvedValue({ ...success, points: [next, parsed.points[1]!] });
    expect(await dispatch({ type: 'agenda.check', requestUrl })).toMatchObject({ lastCheck: { status: 'success' } });
    expect(createNotification).toHaveBeenCalledOnce();
    const previousAlarm = alarm!;
    await dispatch({ type: 'connection.clear' });
    expect(stored).toEqual({});
    expect(alarm).toBeUndefined();
    alarmListener(previousAlarm);
    await dispatch({ type: 'preferences.read' });
    expect(fetchAgenda).toHaveBeenCalledTimes(2);
  });
});


describe('agenda discovery worker integration', () => {
  it('captures only in the chosen tab and creates a baseline only after explicit confirmation', async () => {
    vi.mocked(chrome.tabs.create).mockImplementation(async () => ({ id: 9 }) as chrome.tabs.Tab);
    const initial = await dispatch({ type: 'connection.discovery.start' }) as { id: string; status: string };
    expect(initial.status).toBe('waiting');
    expect(fetchAgenda).not.toHaveBeenCalled();
    const request = { requestId: 'synthetic-discovery', method: 'GET', url: requestUrl, tabId: 9, frameId: 0,
      parentFrameId: -1, type: 'xmlhttprequest', statusCode: 200, timeStamp: Date.now(),
      initiator: 'https://schoolware_siw.ksgwl.be' } as chrome.webRequest.OnCompletedDetails;
    discovered({ ...request, tabId: 1 });
    expect(await dispatch({ type: 'connection.discovery.read' })).toMatchObject({ status: 'waiting' });
    discovered(request);
    const found = await dispatch({ type: 'connection.discovery.read' }) as { id: string; status: string };
    expect(found.status).toBe('found');
    expect(fetchAgenda).not.toHaveBeenCalled();
    expect(await dispatch({ type: 'connection.read' })).toMatchObject({ requestUrl: null });
    const changed = new URL(requestUrl); changed.searchParams.set('CompletedTaskForLL', '999');
    discovered({ ...request, url: changed.href });
    await dispatch({ type: 'connection.discovery.read' });
    expect(await dispatch({ type: 'connection.discovery.confirm', id: found.id })).toMatchObject({ requestUrl: null });
    expect(fetchAgenda).not.toHaveBeenCalled();
    const next = await dispatch({ type: 'connection.discovery.read' }) as { id: string };
    expect(await dispatch({ type: 'connection.discovery.confirm', id: next.id })).toMatchObject({ lastCheck: { status: 'success' } });
    expect(fetchAgenda).toHaveBeenCalledOnce();
    expect(await dispatch({ type: 'history.read' })).toMatchObject({ itemCount: 2, entries: [{ kind: 'baseline' }, { kind: 'baseline' }] });
    const activity = JSON.stringify(await dispatch({ type: 'activity.read' }));
    expect((await new ActivityRepository().read()).entries.filter((entry) => entry.action === 'connection.discovery' && entry.phase === 'succeeded')).toHaveLength(2);
    expect(activity).not.toContain('CompletedTaskForLL');
    expect(activity).not.toContain(requestUrl);
    expect(session).toEqual({});
  });
  it('rejects discovery from website contexts and expires or clears pending state without history changes', async () => {
    const website = { ...sender, url: 'https://schoolware_siw.ksgwl.be/webouders/start.html', tab: { id: 1 }, frameId: 0 };
    expect(listener({ type: 'connection.discovery.start' }, website, vi.fn())).toBe(false);
    discoveryPermission = false;
    expect(await dispatch({ type: 'connection.discovery.start' })).toMatchObject({ status: 'permission-required' });
    discoveryPermission = true;
    vi.mocked(chrome.tabs.create).mockImplementation(async () => ({ id: 9 }) as chrome.tabs.Tab);
    await dispatch({ type: 'connection.discovery.start' });
    vi.setSystemTime(new Date(Date.now() + 300001));
    alarmListener({ name: 'schoolware-agenda-discovery-expiry', scheduledTime: Date.now(), persistAcrossSessions: true });
    expect(await dispatch({ type: 'connection.discovery.read' })).toMatchObject({ status: 'expired' });
    expect(fetchAgenda).not.toHaveBeenCalled();
    await dispatch({ type: 'connection.discovery.start' });
    await dispatch({ type: 'connection.clear' });
    expect(session).toEqual({});
    expect(await chrome.alarms.get('schoolware-agenda-discovery-expiry')).toBeUndefined();
  });
});

describe('optional progress sync worker integration', () => {
  it('stores a self-chosen participant name without leaking it through diagnostics or website contexts', async () => {
    await dispatch({ type: 'agenda.check', requestUrl });
    const code = `sw1.${'a'.repeat(64)}.${'b'.repeat(64)}`;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ ok: true, acknowledged: [], cursor: 0, head: 0, operations: [] })));
    await dispatch({ type: 'sync.connect', code, seed: false });
    const calls = vi.mocked(fetch).mock.calls.length;
    expect(await dispatch({ type: 'sync.name', label: 'Synthetic parent' })).toMatchObject({ displayName: 'Synthetic parent' });
    expect(vi.mocked(fetch).mock.calls).toHaveLength(calls);
    vi.resetModules(); await import('../src/background/service-worker');
    expect(await dispatch({ type: 'sync.read' })).toMatchObject({ displayName: 'Synthetic parent' });
    expect(JSON.stringify(await dispatch({ type: 'activity.read' }))).not.toContain('Synthetic parent');
    const website = { ...sender, url: 'https://schoolware_siw.ksgwl.be/webouders/start.html', tab: { id: 1 }, frameId: 0 };
    expect(listener({ type: 'sync.name', label: 'Synthetic intruder' }, website, vi.fn())).toBe(false);
  });
  it('creates a group after a baseline and reveals pairing secrets only on explicit request from an extension page', async () => {
    const code = `sw1.${'c'.repeat(64)}.${'d'.repeat(64)}`;
    expect(await dispatch({ type: 'sync.create', code })).toMatchObject({ ok: false });
    await dispatch({ type: 'agenda.check', requestUrl });
    const fetcher = vi.fn(async (_url: string, options: RequestInit) => {
      const body = JSON.parse(options.body as string);
      return Response.json(body.action === 'register' ? { ok: true } :
        { ok: true, acknowledged: [], cursor: 0, head: 0, operations: [] });
    });
    vi.stubGlobal('fetch', fetcher);
    expect(await dispatch({ type: 'sync.create', code })).toMatchObject({ ok: true, enabled: true, error: false });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(await dispatch({ type: 'sync.read' })).not.toHaveProperty('pairingCode');
    expect(await dispatch({ type: 'sync.pairing' })).toMatchObject({ pairingCode: code });
    expect(JSON.stringify(await dispatch({ type: 'activity.read' }))).not.toContain('c'.repeat(64));
    const website = { ...sender, url: 'https://schoolware_siw.ksgwl.be/webouders/start.html', tab: { id: 1 }, frameId: 0 };
    expect(listener({ type: 'sync.create', code }, website, vi.fn())).toBe(false);
    expect(listener({ type: 'sync.pairing' }, website, vi.fn())).toBe(false);
    await dispatch({ type: 'sync.disconnect' });
    hostPermission = false;
    expect(await dispatch({ type: 'sync.create', code })).toMatchObject({ ok: false });
  });
  it('pairs only after an agenda baseline, schedules an independent alarm and never exposes pairing secrets in diagnostics', async () => {
    const code = `sw1.${'a'.repeat(64)}.${'b'.repeat(64)}`;
    expect(await dispatch({ type: 'sync.connect', code, seed: false })).toMatchObject({ ok: false });
    vi.mocked(fetchAgenda).mockResolvedValue(success);
    await dispatch({ type: 'agenda.check', requestUrl });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ ok: true, acknowledged: [], cursor: 0, head: 0, operations: [] })));
    expect(await dispatch({ type: 'sync.connect', code, seed: false })).toMatchObject({ ok: true, enabled: true, error: false });
    expect(await chrome.alarms.get('schoolware-progress-sync')).toMatchObject({ periodInMinutes: 1 });
    expect(await dispatch({ type: 'preferences.read' })).toMatchObject({ monitoringScheduled: true });
    const activity = JSON.stringify(await dispatch({ type: 'activity.read' }));
    expect(activity).not.toContain(code);
    expect(activity).not.toContain('a'.repeat(64));
    await dispatch({ type: 'sync.disconnect' });
    expect(await dispatch({ type: 'sync.read' })).toMatchObject({ enabled: false });
    expect(await chrome.alarms.get('schoolware-progress-sync')).toBeUndefined();
  });
  it('rejects progress pairing from the Schoolware website and without host permission', async () => {
    const message = { type: 'sync.connect', code: `sw1.${'a'.repeat(64)}.${'b'.repeat(64)}`, seed: false };
    expect(listener(message, { ...sender, url: 'https://schoolware_siw.ksgwl.be/webouders/start.html', tab: { id: 1 }, frameId: 0 }, vi.fn())).toBe(false);
    hostPermission = false;
    expect(await dispatch(message)).toMatchObject({ ok: false });
  });
});
