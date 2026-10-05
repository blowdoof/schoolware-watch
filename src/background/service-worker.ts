import { progressSync, synchronizeProgress, leaveSyncMembers, configureProgressSyncAlarm, deleteRemoteProgress, PROGRESS_SYNC_ALARM } from './progress-sync';
import { SYNC_PERMISSION, type SyncView } from '../shared/progress-sync';
import { type DiscoveryView } from '../shared/agenda-discovery';
import { openMainPage } from './navigation';
import type { OpenPageResult } from '../shared/navigation';
import { beginAgendaDiscovery, readAgendaDiscovery, cancelAgendaDiscovery, takeDiscoveredAgenda,
  restoreAgendaDiscovery, registerAgendaDiscovery, observeAgendaRequest, DISCOVERY_ALARM } from './agenda-discovery';
import { fetchAgenda } from '../schoolware/agenda-client';
import { createObservationInput } from '../schoolware/observation-input';
import { monitoringRequest, requestCoverage } from '../schoolware/monitoring-request';
import { HistoryRepository, DEFAULT_RETENTION } from '../storage/history';
import { ActivityRepository, activityInput, type AuditContext } from '../storage/activity';
import { type ActivityAction, type ActivityData, type ActivityPhase, type ActivityView, type ActivityReporter, type ActivityTrigger } from '../shared/activity';
import { createTasksView, type TasksView } from '../shared/tasks';
import { createSchoolbagView, type SchoolbagView } from '../shared/schoolbag';
import { isAlertId } from '../shared/browser-alerts';
import type { Category, HistoryScope } from '../domain/observations';
import { notificationEventSelection } from '../domain/notification-window';
import { todoReminderSelection } from '../domain/todo';
import type { NotificationTestResult } from '../shared/notifications';
import { BROWSER_ALERTS_KEY, browserPermissions, browserAlertsText, isWebsiteSender, type BrowserAlert, type BrowserAlertsView } from '../shared/browser-alerts';
import { BrowserAlertInbox, UNCONNECTED_TEST_SCOPE } from './browser-alert-inbox';
import { configureWebsiteAlerts, broadcastWebsiteAlerts } from './website-alerts';
import { notificationPage, isNotificationTarget, testNotificationDetails, validateNotificationDetails,
  type NotificationDetailsView } from '../shared/notification-details';
import { createHistoryView, type HistoryView } from '../shared/history';
import { DEFAULT_PREFERENCES, PREFERENCES_KEY, validateStoredPreferences, type PreferencesView } from '../shared/preferences';
import { SCHOOLWARE_ORIGIN, schoolwarePermission, schoolwareOrigin } from '../schoolware/agenda-request';
import { CONNECTION_KEY, EMPTY_CONNECTION, isExtensionPage, validateConnectionMessage,
  validateConnectionState, type ConnectionMessage, type ConnectionState } from '../shared/connection';

import { SETUP_KEY } from '../shared/setup';

export const MONITOR_ALARM = 'schoolware-monitor';
export const MONITOR_STATE_KEY = 'schoolwareMonitoringState';
const NOTIFICATION_PREFIX = 'schoolware-watch-';
let notificationListenerRegistered = false;
const history = new HistoryRepository();
const browserInbox = new BrowserAlertInbox();
const activity = new ActivityRepository();
const LOG_HEALTH_KEY = 'schoolwareActivityHealth';
let logWriteFailed = false;
let logGeneration = 0;
let erasingData = false;
interface Trace extends AuditContext { epoch: number; logEpoch: number }
const trace = (context: AuditContext['context'], correlationId: string = crypto.randomUUID()): Trace =>
  ({ correlationId, spanId: crypto.randomUUID(), context, epoch: generation, logEpoch: logGeneration });

async function log(current: Trace, action: ActivityAction, phase: ActivityPhase, data: ActivityData = {}): Promise<void> {
  if (current.epoch !== generation || current.logEpoch !== logGeneration || erasingData) return;
  try { await activity.append(activityInput(current, action, phase, data)); }
  catch {
    if (current.epoch !== generation || current.logEpoch !== logGeneration || erasingData) return;
    if (!logWriteFailed) {
      logWriteFailed = true;
      if (typeof chrome !== 'undefined') await chrome.storage.local.set({ [LOG_HEALTH_KEY]: { failedAt: new Date().toISOString() } }).catch(() => {});
    }
  }
}

async function logAlert(current: Trace, alertId: string, action: ActivityAction, phase: ActivityPhase, data: ActivityData = {}): Promise<void> {
  await log({ ...current, correlationId: alertId }, action, phase, data);
}
const progressReporter = (current: Trace, trigger: ActivityTrigger): ActivityReporter =>
  (action, phase, data = {}) => log(current, action, phase, { ...data, trigger });

async function invalidateTaskViews(): Promise<void> {
  if (chrome.runtime.sendMessage) await chrome.runtime.sendMessage({ type: 'tasks.updated' }).catch(() => {});
}

async function configureWebsite(enabled: boolean, current: Trace): Promise<void> {
  await log(current, 'website.script', 'started');
  try {
    const result = await configureWebsiteAlerts(enabled, true);
    await log(current, 'website.script', result.failedCount ? 'failed' : 'succeeded', { ...result,
      reason: result.failedCount ? 'api-error' : !enabled ? 'disabled' : result.registered ? 'success' : 'permission-required' });
  } catch (error) { await log(current, 'website.script', 'failed', { reason: 'api-error' }); throw error; }
}
// Transient coordination only. History, preferences and retry times are durable.
let activeCheck: AbortController | null = null;
let activeTask: Promise<ConnectionState> | null = null;
let generation = 0;
let mutating = 0;
let mutationQueue: Promise<void> = Promise.resolve();

async function readConnection(): Promise<ConnectionState> {
  const data = await chrome.storage.local.get(CONNECTION_KEY);
  return validateConnectionState(data[CONNECTION_KEY]) ?? EMPTY_CONNECTION;
}

async function readPreferences() {
  const data = await chrome.storage.local.get(PREFERENCES_KEY);
  return validateStoredPreferences(data[PREFERENCES_KEY]) ?? { ...DEFAULT_PREFERENCES,
    notificationCategories: [...DEFAULT_PREFERENCES.notificationCategories] };
}

async function readRetryState(): Promise<{ failures: number; retryAt: string | null }> {
  const data = await chrome.storage.local.get(MONITOR_STATE_KEY);
  const state = data[MONITOR_STATE_KEY] as Record<string, unknown> | undefined;
  if (!state || typeof state.failures !== 'number' || !Number.isSafeInteger(state.failures) || state.failures < 0 ||
      !(state.retryAt === null || (typeof state.retryAt === 'string' && Number.isFinite(Date.parse(state.retryAt))))) {
    return { failures: 0, retryAt: null };
  }
  return { failures: state.failures, retryAt: state.retryAt as string | null };
}

async function ensureAlarm(current?: Trace): Promise<void> {
  const connection = await readConnection();
  const prefs = await readPreferences();
  if (!connection.requestUrl || !prefs.monitoringEnabled ||
      !await chrome.permissions.contains({ origins: [schoolwarePermission(connection.requestUrl)] })) {
    const removed = await chrome.alarms.clear(MONITOR_ALARM);
    if (current) await log(current, 'alarm.configured', removed ? 'succeeded' : 'skipped', { alarm: 'agenda', reason: 'disabled' });
    return;
  }
  const alarm = await chrome.alarms.get(MONITOR_ALARM);
  if (!alarm || alarm.periodInMinutes !== prefs.intervalMinutes) {
    await chrome.alarms.create(MONITOR_ALARM, { delayInMinutes: prefs.intervalMinutes, periodInMinutes: prefs.intervalMinutes });
    if (current) await log(current, 'alarm.configured', 'succeeded', { alarm: 'agenda', intervalMinutes: prefs.intervalMinutes });
  } else if (current) {
    await log(current, 'alarm.configured', 'info', { alarm: 'agenda', reason: 'unchanged', intervalMinutes: prefs.intervalMinutes,
      scheduledAt: new Date(alarm.scheduledTime).toISOString() });
  }
}

async function preferencesView(): Promise<PreferencesView> {
  const preferences = await readPreferences();
  const alarm = await chrome.alarms.get(MONITOR_ALARM);
  const retry = await readRetryState();
  return { ok: true, preferences, notificationPermission: await chrome.permissions.contains({ permissions: ['notifications'] }),
    browserPermission: await chrome.permissions.contains(browserPermissions((await readConnection()).requestUrl ?? SCHOOLWARE_ORIGIN)),
    monitoringScheduled: Boolean(alarm), nextCheckAt: alarm ? new Date(alarm.scheduledTime).toISOString() : null, retryAt: retry.retryAt };
}

async function browserAlertsView(): Promise<BrowserAlertsView> {
  const connection = await readConnection();
  const prefs = await readPreferences();
  const enabled = prefs.browserNotificationsEnabled && await chrome.permissions.contains(browserPermissions(connection.requestUrl ?? SCHOOLWARE_ORIGIN));
  const stored = await history.read(connection.requestUrl);
  const entries = await browserInbox.read(connection.requestUrl ?? UNCONNECTED_TEST_SCOPE, stored.retentionDays);
  const todo = prefs.todoRemindersEnabled && stored.scope ?
    todoReminderSelection(createTasksView(stored.scope), new Date(), prefs.notificationCategories) : null;
  // Keep a delivered banner current without republishing a dismissed reminder.
  // Only generic counts and dates cross into the Schoolware page.
  const currentEntries = entries.flatMap((entry) => entry.kind !== 'todo' ? [entry] :
    todo && stored.scope?.todoReminder?.id === entry.id && stored.scope.todoReminder.day === todo.day ?
      [{ ...entry, pending: todo.pending, targetDay: todo.targetDay }] : []);
  return { ok: true, enabled, entries: enabled ? currentEntries : [] };
}

async function refreshBrowserBadge(broadcast = true, current?: Trace): Promise<void> {
  const view = await browserAlertsView();
  await setBrowserBadge(view);
  if (broadcast) {
    try {
      const result = await broadcastWebsiteAlerts();
      if (current) await log(current, 'banner.broadcast', result.failedCount ? 'failed' : 'succeeded', result);
    } catch (error) {
      if (current) await log(current, 'banner.broadcast', 'failed', { reason: 'api-error' });
      throw error;
    }
  }
}

async function setBrowserBadge(view: BrowserAlertsView): Promise<void> {
  await chrome.action.setBadgeBackgroundColor({ color: '#0f766e' });
  await chrome.action.setBadgeText({ text: view.entries.length ? String(view.entries.length) : '' });
}

async function restoreMonitoring(current = trace('worker'), trigger: ActivityTrigger = 'startup'): Promise<void> {
  await restoreAgendaDiscovery();
  await ensureAlarm(current);
  await configureProgressSyncAlarm(progressReporter(current, trigger));
  const prefs = await readPreferences();
  await configureWebsite(prefs.browserNotificationsEnabled, current);
  await refreshBrowserBadge(false);
}

async function readHistory(category: Category | 'all' = 'all'): Promise<HistoryView> {
  const connection = await readConnection();
  const stored = await history.read(connection.requestUrl);
  return createHistoryView(stored.scope, stored.retentionDays, category);
}

function serializeMutation<T>(operation: () => Promise<T>): Promise<T> {
  mutating++;
  const task = mutationQueue.then(operation);
  mutationQueue = task.then(() => {}, () => {});
  return task.finally(() => { mutating--; });
}

const summary = (status: 'busy' | 'permission-required' | 'storage-error'): ConnectionState => ({
  requestUrl: null, lastCheck: { status, checkedAt: new Date().toISOString(), count: null },
});

async function createNotification(id: string, message: string, requireInteraction = false, current = trace('worker')): Promise<string> {
  registerNotificationListener();
  await log(current, 'notification.system', 'started', { test: requireInteraction });
  try {
    const created = await chrome.notifications.create(`${NOTIFICATION_PREFIX}${id}`, { type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon128.png'), title: 'Schoolware Watch', message, requireInteraction });
    await log(current, 'notification.system', 'succeeded', { test: requireInteraction, reason: 'accepted' });
    return created;
  } catch (error) { await log(current, 'notification.system', 'failed', { reason: 'api-error' }); throw error; }
}

async function testNotification(current: Trace): Promise<NotificationTestResult> {
  if (!await chrome.permissions.contains({ permissions: ['notifications'] }) || !chrome.notifications) {
    await log(current, 'notification.system', 'skipped', { reason: 'permission-required', test: true });
    return { status: 'permission-required', permissionLevel: 'unknown', registered: null };
  }
  // Chrome permission and OS toast visibility are separate. getAll cannot prove
  // that a banner appeared, and a dismissed notification may no longer be listed.
  const permissionLevel = await chrome.notifications.getPermissionLevel().catch(() => 'unknown' as const);
  if (permissionLevel === 'denied') {
    await log(current, 'notification.system', 'skipped', { reason: 'blocked', test: true });
    return { status: 'blocked', permissionLevel, registered: null };
  }
  try {
    const old = await chrome.notifications.getAll().catch(() => ({}));
    for (const id of Object.keys(old)) {
      if (id === `${NOTIFICATION_PREFIX}test` || id.startsWith(`${NOTIFICATION_PREFIX}test-`)) {
        await chrome.notifications.clear(id);
        const oldCorrelation = notificationCorrelation(id);
        if (oldCorrelation) await logAlert(current, oldCorrelation, 'notification.cleared', 'succeeded', { test: true });
      }
    }
    // A fresh identifier avoids updating/replacing a previous native test toast.
    const id = await createNotification(`test-${current.correlationId}`,
      'Dit is een testmelding. Meldingen over je agenda bevatten geen namen of titels.', true, current);
    const listed = await chrome.notifications.getAll().catch(() => null);
    await log(current, 'notification.system', 'info', { test: true, ...(listed === null ? {} : { registered: Object.hasOwn(listed, id) }) });
    return { status: 'accepted', permissionLevel, registered: listed === null ? null : Object.hasOwn(listed, id) };
  } catch { return { status: 'api-error', permissionLevel, registered: null }; }
}

async function notify(scope: HistoryScope, checkId: string, now: Date, currentGeneration: number, current: Trace): Promise<void> {
  const prefs = await readPreferences();
  if (generation !== currentGeneration || (!prefs.notificationsEnabled && !prefs.browserNotificationsEnabled)) {
    await log(current, 'notification.selection', 'skipped', { reason: generation !== currentGeneration ? 'cancelled' : 'disabled' }); return;
  }
  const candidates = scope.events.filter((event) =>
    event.id === JSON.stringify([checkId, event.sourceKey, event.kind]));
  const { events, ...excluded } = notificationEventSelection(candidates, now, prefs.notificationDays, prefs.notificationCategories);
  const selectionData = { ...excluded, count: candidates.length, days: prefs.notificationDays, categories: prefs.notificationCategories };
  if (!events.length || generation !== currentGeneration) {
    await log(current, 'notification.selection', 'skipped', { ...selectionData, reason: generation !== currentGeneration ? 'cancelled' : 'no-events' }); return;
  }
  const added = events.filter((event) => event.kind === 'observed' || event.kind === 'reappeared').length;
  const changed = events.length - added;
  await log(current, 'notification.selection', 'succeeded', { ...selectionData, added, changed });
  if (prefs.browserNotificationsEnabled && await chrome.permissions.contains(browserPermissions((await readConnection()).requestUrl ?? SCHOOLWARE_ORIGIN)) && generation === currentGeneration) {
    const stored = await history.read(scope.scopeId);
    try {
      await browserInbox.publish(scope.scopeId, { id: checkId, createdAt: now.toISOString(), added, changed,
        days: prefs.notificationDays, test: false }, stored.retentionDays);
      await log(current, 'banner.published', 'succeeded', { added, changed, test: false });
    } catch { await log(current, 'banner.published', 'failed', { reason: 'storage-error' }); }
    if (generation === currentGeneration) await refreshBrowserBadge(true, current).catch(() => {});
  }
  if (generation !== currentGeneration || !prefs.notificationsEnabled || !await chrome.permissions.contains({ permissions: ['notifications'] })) {
    await log(current, 'notification.system', 'skipped', { reason: prefs.notificationsEnabled ? 'permission-required' : 'disabled' }); return;
  }
  if (!await history.claimNotification(scope.scopeId, checkId, now.toISOString()) || generation !== currentGeneration) {
    await log(current, 'notification.system', 'skipped', { reason: 'already-claimed' }); return;
  }
  const reopened = events.filter((event) => event.taskReopened).length;
  await createNotification(checkId, `${added} nieuwe of opnieuw zichtbare en ${changed} gewijzigde of niet meer zichtbare agendapunten binnen ${prefs.notificationDays} dagen.${reopened ? ` ${reopened} voltooide taken weer op Bezig gezet.` : ''} Klik voor de lesdetails.`, false, current);
}

async function notifyTodo(scopeId: string, now: Date, currentGeneration: number, current: Trace): Promise<void> {
  const prefs = await readPreferences();
  if (generation !== currentGeneration || !prefs.todoRemindersEnabled) {
    await log(current, 'notification.todo', 'skipped', { reason: generation !== currentGeneration ? 'cancelled' : 'disabled' }); return;
  }
  const browser = prefs.browserNotificationsEnabled && await chrome.permissions.contains(browserPermissions((await readConnection()).requestUrl ?? SCHOOLWARE_ORIGIN));
  const system = prefs.notificationsEnabled && Boolean(chrome.notifications) && await chrome.permissions.contains({ permissions: ['notifications'] });
  if ((!browser && !system) || generation !== currentGeneration) {
    await log(current, 'notification.todo', 'skipped', { reason: generation !== currentGeneration ? 'cancelled' :
      prefs.browserNotificationsEnabled || prefs.notificationsEnabled ? 'permission-required' : 'disabled' }); return;
  }
  await log(current, 'notification.todo', 'started');
  const reminder = await history.claimTodoReminder(scopeId, now, prefs.notificationCategories, { browser, system });
  if (!reminder || generation !== currentGeneration) {
    await log(current, 'notification.todo', 'skipped', { reason: generation !== currentGeneration ? 'cancelled' : 'no-reminder' }); return;
  }
  const alert: BrowserAlert = { id: reminder.id, createdAt: now.toISOString(), added: 0, changed: 0,
    days: 1, test: false, kind: 'todo', pending: reminder.pending, targetDay: reminder.targetDay };
  const reminderTrace = { ...current, correlationId: reminder.id };
  if (!reminder.browser && !reminder.system) {
    await log(reminderTrace, 'notification.todo', 'skipped', { reason: 'already-claimed' });
    await refreshBrowserBadge(browser, reminderTrace).catch(() => {});
    return;
  }
  await log(reminderTrace, 'notification.todo', 'succeeded', { count: reminder.pending });
  if (reminder.browser) {
    try {
      const stored = await history.read(scopeId);
      await browserInbox.publish(scopeId, alert, stored.retentionDays);
      await log(reminderTrace, 'banner.published', 'succeeded', { count: reminder.pending, test: false });
    } catch { await log(reminderTrace, 'banner.published', 'failed', { reason: 'storage-error' }); }
  }
  await refreshBrowserBadge(browser, reminderTrace).catch(() => {});
  if (reminder.system && generation === currentGeneration) {
    await createNotification(reminder.id, `${browserAlertsText([alert])} Klik voor het to-do overzicht.`, false, reminderTrace);
  }
}

async function runCheck(requestUrl: string, controller: AbortController, currentGeneration: number, current: Trace): Promise<ConnectionState> {
  await log(current, 'check', 'started');
  try {
    if (!await chrome.permissions.contains({ origins: [schoolwarePermission(requestUrl)] })) {
      const state = { ...summary('permission-required'), requestUrl };
      if (generation === currentGeneration) {
        await chrome.storage.local.set({ [CONNECTION_KEY]: state });
        await ensureAlarm();
      }
      await log(current, 'check', 'skipped', { reason: 'permission-required' });
      return state;
    }
    if (generation !== currentGeneration) return EMPTY_CONNECTION;
    const previousConnection = await readConnection();
    const prefs = await readPreferences();
    const fetchUrl = monitoringRequest(requestUrl, new Date(), prefs.notificationDays);
    await chrome.storage.local.set({ [CONNECTION_KEY]: { requestUrl, lastCheck: null } });
    await log(current, 'transport', 'started');
    const transportStartedAt = Date.now();
    const result = await fetchAgenda(fetchUrl, { signal: controller.signal });
    await log(current, 'transport', result.status === 'success' ? 'succeeded' : 'failed',
      { reason: result.status, durationMs: Math.max(0, Date.now() - transportStartedAt), ...(result.count === null ? {} : { count: result.count }) });
    if (generation !== currentGeneration) return EMPTY_CONNECTION;
    const now = new Date();
    const checkedAt = now.toISOString();
    let committed: HistoryScope | null = null;
    const checkId = current.correlationId;
    if (result.status === 'success') {
      const input = createObservationInput(requestUrl, result.points, checkId, checkedAt);
      input.coverage = requestCoverage(fetchUrl);
      input.legacyCoverage = requestCoverage(requestUrl);
      if (prefs.notificationsEnabled || prefs.browserNotificationsEnabled) {
        input.notificationSelection = { days: prefs.notificationDays, categories: prefs.notificationCategories };
      }
      committed = await history.record(input, controller.signal, current);
      current.profileId = committed.localId!;
    }
    if (generation !== currentGeneration) return EMPTY_CONNECTION;
    // Never spread the internal fetch result: it contains agenda points.
    const state: ConnectionState = { requestUrl,
      lastCheck: { status: result.status, count: result.count, checkedAt,
        ...(result.status === 'success' ? { typeCounts: result.typeCounts } : {}) } };
    const retry = await readRetryState();
    const failures = result.status === 'success' ? 0 : Math.min(retry.failures + 1, 20);
    const retryAt = failures ? new Date(now.getTime() + Math.min(360, prefs.intervalMinutes * 2 ** failures) * 60000).toISOString() : null;
    await chrome.storage.local.set({ [CONNECTION_KEY]: state, [MONITOR_STATE_KEY]: { failures, retryAt } });
    if (retryAt) await log(current, 'retry.scheduled', 'info', { retryAt });
    if (result.status !== 'success') await log(current, 'check', 'failed', { reason: result.status });
    await ensureAlarm(current);
    // Refresh existing pages as well as persistent registration after reloads.
    await configureWebsite(prefs.browserNotificationsEnabled, current).catch(() => {});
    if (previousConnection.requestUrl && schoolwareOrigin(previousConnection.requestUrl) !== schoolwareOrigin(requestUrl)) {
      await broadcastWebsiteAlerts(schoolwareOrigin(previousConnection.requestUrl)!).catch(() => {});
      await chrome.permissions.remove({ origins: [schoolwarePermission(previousConnection.requestUrl)] }).catch(() => false);
    }
    await refreshBrowserBadge(prefs.browserNotificationsEnabled, current).catch(() => {});
    if (committed) {
      if (await synchronizeProgress(requestUrl, progressReporter(current, 'agenda-check'), current)) await invalidateTaskViews();
      // A notification error cannot invalidate an already committed observation.
      await notify(committed, checkId, now, currentGeneration, current).catch(() => {});
      // This is a progress reminder, separate from source-change events and
      // baselines. The repository re-reads progress after remote synchronization.
      await notifyTodo(requestUrl, now, currentGeneration, current).catch(() => log(current, 'notification.todo', 'failed', { reason: 'unavailable' }));
    }
    return generation === currentGeneration ? state : EMPTY_CONNECTION;
  } catch {
    if (generation !== currentGeneration) return EMPTY_CONNECTION;
    const state = { ...summary('storage-error'), requestUrl };
    await chrome.storage.local.set({ [CONNECTION_KEY]: state }).catch(() => {});
    await log(current, 'check', 'failed', { reason: 'storage-error' });
    return state;
  }
}

function startCheck(requestUrl: string, current = trace('worker')): Promise<ConnectionState> {
  if (activeTask || mutating) return log(current, 'check', 'skipped', { reason: 'busy' }).then(() => summary('busy'));
  const controller = new AbortController();
  activeCheck = controller;
  const task = runCheck(requestUrl, controller, generation, current);
  activeTask = task;
  return task.finally(() => { activeTask = null; activeCheck = null; });
}

type Reply = OpenPageResult | DiscoveryView | SyncView | ConnectionState | HistoryView | PreferencesView | NotificationTestResult | BrowserAlertsView | NotificationDetailsView | TasksView | SchoolbagView | ActivityView;
async function readActivity(message: { limit?: number; correlationId?: string; itemId?: string } = {}): Promise<ActivityView> {
  const view = await activity.read(message.limit, message);
  const health = await chrome.storage.local.get(LOG_HEALTH_KEY);
  return { ...view, healthy: view.healthy && !logWriteFailed && !health[LOG_HEALTH_KEY] };
}

async function handle(message: ConnectionMessage, current: Trace): Promise<Reply> {
  if (message.type === 'ui.open') return serializeMutation(() => openMainPage(message.page));
  // Keep diagnostics accessible when startup restoration failed. Privileged
  // operational messages still require successful storage access isolation.
  if (message.type === 'activity.read') return readActivity(message);
  await initialization;
  if (message.type === 'setup.complete') return serializeMutation(async () => {
    const connection = await readConnection();
    if (!connection.requestUrl || !(await history.read(connection.requestUrl)).scope ||
        !await chrome.permissions.contains({ origins: [schoolwarePermission(connection.requestUrl)] })) throw new Error('Setup incomplete');
    const prefs = await preferencesView();
    if ((prefs.preferences.notificationsEnabled && !prefs.notificationPermission) ||
        (prefs.preferences.browserNotificationsEnabled && !prefs.browserPermission)) throw new Error('Permission missing');
    await chrome.storage.local.set({ [SETUP_KEY]: true, [PREFERENCES_KEY]: prefs.preferences });
    return connection;
  });
  if (message.type === 'connection.discovery.start') return serializeMutation(async () => {
    registerAgendaDiscovery(observeDiscovery);
    return beginAgendaDiscovery(message.origin, message.tabId);
  });
  if (message.type === 'connection.discovery.read') return serializeMutation(readAgendaDiscovery);
  if (message.type === 'connection.discovery.cancel') return serializeMutation(async () => {
    await cancelAgendaDiscovery(); return readAgendaDiscovery();
  });
  if (message.type === 'connection.discovery.confirm') {
    const expectedGeneration = generation;
    return serializeMutation(async () => {
      await activeTask;
      const url = await takeDiscoveredAgenda(message.id);
      if (expectedGeneration !== generation) return EMPTY_CONNECTION;
      const controller = new AbortController();
      activeCheck = controller;
      const task = runCheck(url, controller, generation, current);
      activeTask = task;
      try { return await task; } finally { activeTask = null; activeCheck = null; }
    });
  }
  if (message.type === 'activity.exported') {
    await log(current, 'log.exported', 'succeeded', { count: message.count }); return readActivity();
  }
  if (message.type === 'activity.clear') return serializeMutation(async () => {
    await activeTask;
    logGeneration++;
    await activity.clear();
    logWriteFailed = false;
    await chrome.storage.local.remove(LOG_HEALTH_KEY);
    return readActivity();
  });
  if (message.type === 'sync.read') return progressSync.view();
  if (message.type === 'sync.pairing') {
    const state = await progressSync.read();
    return { ...await progressSync.view(), ...(state ? { pairingCode: `sw1.${state.token}.${state.key}` } : {}) };
  }
  if (message.type === 'sync.name') {
    return serializeMutation(async () => {
      await activeTask;
      await progressSync.setDisplayName(message.label);
      await log(current, 'progress.name', 'succeeded', { trigger: 'manual' });
      // Save typing locally without delaying later edits on a network request.
      // The existing durable alarm announces the latest label on its next run.
      await configureProgressSyncAlarm(progressReporter(current, 'manual'));
      await invalidateTaskViews();
      return progressSync.view();
    });
  }
  if (message.type === 'sync.create' || message.type === 'sync.connect' || message.type === 'sync.run' || message.type === 'sync.disconnect' || message.type === 'sync.delete') {
    return serializeMutation(async () => {
      await activeTask;
      const connection = await readConnection();
      if (message.type === 'sync.create' || message.type === 'sync.connect') {
        if (!connection.requestUrl || !await chrome.permissions.contains({ origins: [SYNC_PERMISSION] })) throw new Error('Sync unavailable');
        await progressSync.connect(connection.requestUrl, message.code, message.type === 'sync.create' || message.seed, message.type === 'sync.create', message.label);
        await log(current, 'progress.connection', 'succeeded', { trigger: 'manual', reason: 'success' });
      }
      if (message.type === 'sync.disconnect') {
        await leaveSyncMembers(progressReporter(current, 'disconnect')); await progressSync.disconnect();
        await log(current, 'progress.connection', 'succeeded', { trigger: 'disconnect', reason: 'disabled' });
      }
      if (message.type === 'sync.delete') await deleteRemoteProgress(progressReporter(current, 'manual'));
      if (message.type === 'sync.disconnect' || message.type === 'sync.delete') await chrome.permissions.remove({ origins: [SYNC_PERMISSION] });
      await configureProgressSyncAlarm(progressReporter(current, 'manual'));
      if (message.type === 'sync.create' || message.type === 'sync.connect' || message.type === 'sync.run') {
        await synchronizeProgress(connection.requestUrl, progressReporter(current, 'manual'), current);
      }
      await invalidateTaskViews();
      await refreshBrowserBadge(true, current).catch(() => {});
      return progressSync.view();
    });
  }
  if (message.type === 'schoolbag.read') {
    return serializeMutation(async () => {
      const connection = await readConnection();
      return createSchoolbagView((await history.read(connection.requestUrl)).scope);
    });
  }
  if (message.type === 'tasks.read') {
    const connection = await readConnection();
    return createTasksView((await history.read(connection.requestUrl)).scope);
  }
  if (message.type === 'tasks.update' || message.type === 'tasks.updateMany') {
    const pending = activeTask;
    return serializeMutation(async () => {
      await pending;
      const connection = await readConnection();
      if (!connection.requestUrl) throw new Error('Task unavailable');
      await history.setTaskStatuses(connection.requestUrl,
        message.type === 'tasks.update' ? [message.itemId] : message.itemIds, message.status, current);
      // Local status/outbox are already durable. Do not delay the UI on an
      // offline server; the alarm retries after an interrupted deferred upload.
      const sync = await progressSync.read();
      if (sync?.scopeId === connection.requestUrl) {
        void serializeMutation(async () => {
          await activeTask;
          if (await synchronizeProgress((await readConnection()).requestUrl, progressReporter(current, 'task-edit'), current)) await invalidateTaskViews();
          await refreshBrowserBadge(true, current).catch(() => {});
        }).catch(() => log(current, 'progress.sync', 'failed', { trigger: 'task-edit', reason: 'unavailable' }));
      } else {
        await log(current, 'progress.sync', 'skipped', { trigger: 'task-edit', reason: sync ? 'profile-mismatch' : 'disabled' });
      }
      await invalidateTaskViews();
      await refreshBrowserBadge(true, current).catch(() => {});
      return createTasksView((await history.read(connection.requestUrl)).scope);
    });
  }
  if (message.type === 'permission.result') {
    await log(current, 'permission.requested', 'info', { permission: message.permission, reason: message.granted ? 'granted' : 'denied' });
    return preferencesView();
  }
  if (message.type === 'connection.read') return readConnection();
  if (message.type === 'history.read') return readHistory(message.category);
  if (message.type === 'preferences.read') return preferencesView();
  if (message.type === 'notifications.details') {
    await log(current, 'notification.details', 'info', { test: message.target === 'test' });
    if (message.target === 'test') return { ok: true, status: 'test', details: testNotificationDetails() };
    const connection = await readConnection();
    const scope = (await history.read(connection.requestUrl)).scope;
    if (scope?.todoReminder?.id === message.target) return { ok: true, status: 'todo', details: null };
    const details = validateNotificationDetails(scope?.checks.find((check) => check.checkId === message.target)?.notificationDetails);
    return { ok: true, status: details ? 'available' : 'missing', details };
  }
  if (message.type === 'browser.alerts.read') {
    const view = await browserAlertsView();
    await setBrowserBadge(view);
    return view;
  }
  if (message.type === 'browser.alerts.rendered') {
    const view = await browserAlertsView();
    for (const id of message.alertIds) {
      const alert = view.entries.find((entry) => entry.id === id);
      if (!alert) throw new Error('Alert unavailable');
      await logAlert(current, id, 'banner.rendered', 'info', { test: alert.test });
    }
    return view;
  }
  if (message.type === 'browser.alerts.open') {
    const view = await browserAlertsView();
    const alert = message.alertId ? view.entries.find((entry) => entry.id === message.alertId) : view.entries[0];
    // Only a retained alert in the current profile can open a notification target.
    if (message.alertId && !alert) throw new Error('Alert unavailable');
    await chrome.tabs.create({ url: chrome.runtime.getURL(alert ? notificationPage(alert.test ? 'test' : alert.id) : 'dashboard.html') });
    if (alert) await logAlert(current, alert.id, 'banner.opened', 'succeeded', { test: alert.test });
    return browserAlertsView();
  }
  if (message.type === 'browser.alerts.test' || message.type === 'browser.alerts.dismiss') {
    return serializeMutation(async () => {
      const connection = await readConnection();
      const prefs = await readPreferences();
      const scopeId = connection.requestUrl ?? UNCONNECTED_TEST_SCOPE;
      const stored = await history.read(connection.requestUrl);
      if (message.type === 'browser.alerts.test') {
        if (!await chrome.permissions.contains(browserPermissions((await readConnection()).requestUrl ?? SCHOOLWARE_ORIGIN))) {
          await log(current, 'banner.published', 'skipped', { reason: 'permission-required', test: true });
          throw new Error('Website permission required');
        }
        await configureWebsite(true, current);
        await chrome.storage.local.set({ [PREFERENCES_KEY]: { ...prefs, browserNotificationsEnabled: true } });
        await browserInbox.publish(scopeId, { id: current.correlationId, createdAt: new Date().toISOString(), added: 0,
          changed: 0, days: prefs.notificationDays, test: true }, stored.retentionDays);
        await log(current, 'banner.published', 'succeeded', { test: true });
      } else {
        const dismissed = await browserInbox.read(scopeId, stored.retentionDays);
        await browserInbox.dismiss(scopeId, stored.retentionDays);
        for (const alert of dismissed) await logAlert(current, alert.id, 'banner.dismissed', 'succeeded', { test: alert.test, reason: 'user' });
      }
      await refreshBrowserBadge(true, current);
      return browserAlertsView();
    });
  }
  if (message.type === 'notifications.test') {
    return testNotification(current);
  }
  if (message.type === 'preferences.save' || message.type === 'connection.clear' ||
      message.type === 'history.clear' || message.type === 'history.retention') {
    const pending = activeTask;
    if (message.type === 'connection.clear' || message.type === 'history.clear') { generation++; activeCheck?.abort(); }
    return serializeMutation(async () => {
      await pending;
      if (message.type === 'preferences.save') {
        // Persist intent independently of permission prompts in the settings tab.
        // Delivery and injection still enforce the actual Chrome permissions.
        await chrome.storage.local.set({ [PREFERENCES_KEY]: message.preferences });
        await log(current, 'preferences.saved', 'succeeded', { intervalMinutes: message.preferences.intervalMinutes, days: message.preferences.notificationDays,
          monitoringEnabled: message.preferences.monitoringEnabled, notificationsEnabled: message.preferences.notificationsEnabled,
          browserNotificationsEnabled: message.preferences.browserNotificationsEnabled, categories: message.preferences.notificationCategories,
          todoRemindersEnabled: message.preferences.todoRemindersEnabled,
          newColor: message.preferences.newColor, changedColor: message.preferences.changedColor });
        await ensureAlarm(current);
        await configureWebsite(message.preferences.browserNotificationsEnabled, current);
        await refreshBrowserBadge(true, current);
        return preferencesView();
      }
      if (message.type === 'connection.clear') {
        erasingData = true;
        try {
        const oldConnection = await readConnection();
        await cancelAgendaDiscovery(false, false);
        await chrome.alarms.clear(MONITOR_ALARM);
        await configureWebsiteAlerts(false);
        const notifications = chrome.notifications ? await chrome.notifications.getAll().catch(() => ({})) : {};
        for (const id of Object.keys(notifications)) if (id.startsWith(NOTIFICATION_PREFIX)) await chrome.notifications.clear(id);
        await leaveSyncMembers(progressReporter(current, 'disconnect'));
        await progressSync.disconnect();
        await configureProgressSyncAlarm(progressReporter(current, 'disconnect'));
        await history.clearAll();
        await browserInbox.clear(DEFAULT_RETENTION);
        await chrome.storage.local.remove([CONNECTION_KEY, PREFERENCES_KEY, MONITOR_STATE_KEY, BROWSER_ALERTS_KEY, LOG_HEALTH_KEY, SETUP_KEY]);
        logGeneration++;
        logWriteFailed = false;
        await chrome.action.setBadgeText({ text: '' });
        await broadcastWebsiteAlerts(schoolwareOrigin(oldConnection.requestUrl) ?? SCHOOLWARE_ORIGIN);
        await chrome.permissions.remove({ origins: [schoolwarePermission(oldConnection.requestUrl ?? SCHOOLWARE_ORIGIN), SYNC_PERMISSION], permissions: ['scripting', 'webRequest'] });
        await invalidateTaskViews();
        return EMPTY_CONNECTION;
        } finally { erasingData = false; }
      }
      if (message.type === 'history.clear') {
        const connection = await readConnection();
        const sync = await progressSync.read();
        if (sync?.scopeId === connection.requestUrl) await leaveSyncMembers(progressReporter(current, 'disconnect'));
        if (connection.requestUrl) await history.clearScope(connection.requestUrl);
        const stored = await history.read(connection.requestUrl);
        await browserInbox.dismiss(connection.requestUrl ?? UNCONNECTED_TEST_SCOPE, stored.retentionDays);
        await invalidateTaskViews();
      } else await history.setRetention(message.days);
      await refreshBrowserBadge(true, current);
      return readHistory();
    });
  }
  return startCheck(message.requestUrl, current);
}

async function loggedHandle(message: ConnectionMessage, current: Trace): Promise<Reply> {
  // Polling discovery status must not fill the activity store or expose candidates.
  if (message.type === 'connection.discovery.read') return handle(message, current);
  if (message.type === 'activity.read') {
    await initialization.catch(() => {});
    await log(current, 'request', 'started', { request: message.type });
    const view = await readActivity(message);
    await log(current, 'request', 'succeeded', { request: message.type });
    return view;
  }
  await initialization;
  const deleting = ['connection.clear', 'history.clear', 'activity.clear'].includes(message.type);
  const connection = await readConnection();
  const scope = (await history.read(message.type === 'agenda.check' ? message.requestUrl : connection.requestUrl)).scope;
  if (scope?.localId) current.profileId = scope.localId;
  if (message.type === 'notifications.details' && scope?.checks.some((check) => check.checkId === message.target)) {
    current.correlationId = message.target;
  }
  if (message.type === 'browser.alerts.open') {
    const view = await browserAlertsView();
    const alert = message.alertId ? view.entries.find((entry) => entry.id === message.alertId) : view.entries[0];
    if (alert) current.correlationId = alert.id;
  }
  const startedAt = Date.now();
  if (!deleting) await log(current, 'request', 'started', { request: message.type });
  try {
    const result = await handle(message, current);
    if (!deleting) await log(current, 'request', 'succeeded', { request: message.type, durationMs: Math.max(0, Date.now() - startedAt) });
    return result;
  } catch (error) {
    await log(current, 'request', 'failed', { request: message.type, reason: 'unavailable', durationMs: Math.max(0, Date.now() - startedAt) });
    throw error;
  }
}

const storageReady = chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
const initialization = storageReady.then(() => serializeMutation(async () => {
  const current = trace('worker');
  await log(current, 'worker.started', 'info');
  await restoreMonitoring(current);
}));
void initialization.catch(() => log(trace('worker'), 'worker.started', 'failed', { reason: 'api-error' }));

chrome.runtime.onMessage.addListener((raw: unknown, sender, sendResponse) => {
  const message = validateConnectionMessage(raw);
  if (!message) { void initialization.then(() => log(trace('worker'), 'message.rejected', 'info', { reason: 'invalid-message' })).catch(() => {}); return false; }
  if (!isExtensionPage(sender, chrome.runtime.id)) {
    if (!isWebsiteSender(sender, chrome.runtime.id, schoolwareOrigin(sender.url) ?? '') || !['browser.alerts.read', 'browser.alerts.dismiss', 'browser.alerts.open', 'browser.alerts.rendered'].includes(message.type)) {
      void initialization.then(() => log(trace('worker'), 'message.rejected', 'info', { reason: 'untrusted-sender' })).catch(() => {}); return false;
    }
    void (async () => {
      const origin = schoolwareOrigin((await readConnection()).requestUrl) ?? SCHOOLWARE_ORIGIN;
      if (!isWebsiteSender(sender, chrome.runtime.id, origin)) return { ok: true, enabled: false, entries: [] } satisfies BrowserAlertsView;
      if (!await chrome.permissions.contains(browserPermissions((await readConnection()).requestUrl ?? SCHOOLWARE_ORIGIN)) || !(await readPreferences()).browserNotificationsEnabled) {
        return { ok: true, enabled: false, entries: [] } satisfies BrowserAlertsView;
      }
      return loggedHandle(message, trace('schoolware'));
    })().then(sendResponse, () => sendResponse({ ok: false, enabled: false, entries: [] }));
    return true;
  }
  const context = sender.url?.includes('/options.html') ? 'options' : sender.url?.includes('/popup.html') ? 'popup' : 'dashboard';
  const current = trace(context);
  void loggedHandle(message, current).then(sendResponse, () => {
    if (message.type.startsWith('connection.discovery.') && message.type !== 'connection.discovery.confirm') sendResponse({ status: 'error', id: null });
    else if (message.type.startsWith('sync.')) sendResponse({ ok: false, enabled: false, pending: 0, lastSuccessAt: null, error: true });
    else if (message.type.startsWith('browser.alerts.')) sendResponse({ ok: false, enabled: false, entries: [] });
    else if (message.type === 'notifications.test') sendResponse({ status: 'api-error', permissionLevel: 'unknown', registered: null });
    else if (message.type === 'notifications.details') sendResponse({ ok: false, status: 'missing', details: null });
    else if (message.type === 'schoolbag.read') sendResponse({ ok: false, lastSuccessAt: null, points: [] });
    else if (message.type.startsWith('tasks.')) sendResponse({ ok: false, entries: [] });
    else if (message.type.startsWith('activity.')) sendResponse({ ok: false, healthy: false, entries: [], total: 0, retentionDays: DEFAULT_RETENTION });
    else if (message.type.startsWith('history.')) sendResponse({ ...createHistoryView(null, DEFAULT_RETENTION), ok: false });
    else if (message.type.startsWith('preferences.')) sendResponse({ ok: false,
      preferences: DEFAULT_PREFERENCES, notificationPermission: false, browserPermission: false, monitoringScheduled: false, nextCheckAt: null, retryAt: null });
    else if (message.type === 'ui.open') sendResponse({ ok: false });
    else sendResponse(summary('storage-error'));
  });
  return true;
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === DISCOVERY_ALARM) {
    const current = trace('alarm');
    void initialization.then(() => serializeMutation(async () => {
      await log(current, 'alarm.fired', 'info', { alarm: 'agenda-discovery', scheduledAt: new Date(alarm.scheduledTime).toISOString() });
      await readAgendaDiscovery();
    })).catch(() => log(current, 'alarm.fired', 'failed', { alarm: 'agenda-discovery', reason: 'unavailable' }));
    return;
  }
  if (alarm.name === PROGRESS_SYNC_ALARM) {
    const current = trace('alarm');
    void initialization.then(() => serializeMutation(async () => {
      await log(current, 'alarm.fired', 'info', { alarm: 'progress-sync', trigger: 'alarm', scheduledAt: new Date(alarm.scheduledTime).toISOString() });
      await activeTask;
      const connection = await readConnection();
      const scope = (await history.read(connection.requestUrl)).scope;
      if (scope?.localId) current.profileId = scope.localId;
      if (await synchronizeProgress(connection.requestUrl, progressReporter(current, 'alarm'), current)) await invalidateTaskViews();
      await refreshBrowserBadge(true, current).catch(() => {});
      await configureProgressSyncAlarm(progressReporter(current, 'alarm'));
    })).catch(() => log(current, 'progress.sync', 'failed', { trigger: 'alarm', reason: 'unavailable' }));
    return;
  }
  if (alarm.name !== MONITOR_ALARM) return;
  void (async () => {
    await initialization;
    const current = trace('alarm');
    await log(current, 'alarm.fired', 'info', { alarm: 'agenda', scheduledAt: new Date(alarm.scheduledTime).toISOString() });
    const connection = await readConnection();
    const prefs = await readPreferences();
    const retry = await readRetryState();
    if (!connection.requestUrl || !prefs.monitoringEnabled || (retry.retryAt && Date.parse(retry.retryAt) > Date.now())) {
      await log(current, 'check', 'skipped', { reason: retry.retryAt && Date.parse(retry.retryAt) > Date.now() ? 'backoff' : 'disabled' }); return;
    }
    await startCheck(connection.requestUrl, current);
  })().catch(() => {});
});

// Register synchronously so a network event can wake a suspended worker.
const observeDiscovery = (details: chrome.webRequest.OnCompletedDetails) => {
  const current = trace('worker');
  void initialization.then(() => serializeMutation(async () => {
    if (await observeAgendaRequest(details)) await log(current, 'connection.discovery', 'succeeded', { reason: 'success' });
  })).catch(() => log(current, 'connection.discovery', 'failed', { reason: 'storage-error' }));
};
registerAgendaDiscovery(observeDiscovery);
chrome.permissions.onAdded.addListener((permissions) => {
  if (permissions.permissions?.includes('webRequest')) registerAgendaDiscovery(observeDiscovery);
});

function notificationCorrelation(id: string): string | null {
  if (!id.startsWith(NOTIFICATION_PREFIX)) return null;
  const suffix = id.slice(NOTIFICATION_PREFIX.length);
  const correlation = suffix.startsWith('test-') ? suffix.slice(5) : suffix;
  return isAlertId(correlation) ? correlation : null;
}

function registerNotificationListener(): void {
  if (notificationListenerRegistered || !chrome.notifications?.onClicked) return;
  chrome.notifications.onClicked.addListener((id) => {
    if (!id.startsWith(NOTIFICATION_PREFIX)) return;
    const suffix = id.slice(NOTIFICATION_PREFIX.length);
    const target = suffix === 'test' || (suffix.startsWith('test-') && isNotificationTarget(suffix.slice(5))) ? 'test' : suffix;
    if (!isNotificationTarget(target)) return;
    const current = trace('system', notificationCorrelation(id) ?? crypto.randomUUID());
    void (async () => {
      await initialization;
      const existing = await activity.read(1, { correlationId: current.correlationId });
      if (existing.entries[0]?.profileId) current.profileId = existing.entries[0].profileId;
      if (existing.total) await log(current, 'notification.clicked', 'info', { test: target === 'test' });
      try {
        await chrome.tabs.create({ url: chrome.runtime.getURL(notificationPage(target)) });
        await chrome.notifications.clear(id);
        if (existing.total) await log(current, 'notification.cleared', 'succeeded', { test: target === 'test' });
      } catch { await log(current, 'notification.clicked', 'failed', { reason: 'api-error' }); }
    })().catch(() => {});
  });
  chrome.notifications.onClosed?.addListener((id, byUser) => {
    const correlationId = notificationCorrelation(id);
    if (!correlationId || erasingData) return;
    const current = trace('system', correlationId);
    void (async () => {
      await initialization;
      const existing = await activity.read(1, { correlationId });
      if (existing.entries[0]?.profileId) current.profileId = existing.entries[0].profileId;
      // Ignore late closure events after deletion, rather than recreating erased IDs.
      if (existing.total) await log(current, 'notification.closed', 'info', { byUser, ...(byUser ? { reason: 'user' as const } : {}) });
    })().catch(() => {});
  });
  notificationListenerRegistered = true;
}
registerNotificationListener();
chrome.permissions.onAdded.addListener(registerNotificationListener);
chrome.permissions.onAdded.addListener(() => {
  void initialization.then(() => serializeMutation(async () => {
    const current = trace('worker');
    await log(current, 'permission.changed', 'info', { reason: 'granted' });
    await restoreMonitoring(current, 'permission-change');
  })).catch(() => {});
});
chrome.permissions.onRemoved?.addListener(() => {
  if (erasingData) return;
  void initialization.then(async () => {
    if (!(await readConnection()).requestUrl) return;
    await log(trace('worker'), 'permission.changed', 'info', { reason: 'denied' });
    await serializeMutation(() => restoreMonitoring(trace('worker'), 'permission-change'));
  }).catch(() => {});
});

chrome.runtime.onStartup.addListener(() => { void serializeMutation(async () => { const current = trace('worker');
  await log(current, 'browser.started', 'info'); await restoreMonitoring(current); }).catch(() => {}); });
chrome.runtime.onInstalled.addListener(() => {
  void serializeMutation(async () => { const current = trace('worker'); await log(current, 'worker.installed', 'info');
    await restoreMonitoring(current, 'installation'); }).catch(() => {});
});
