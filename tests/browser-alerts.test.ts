import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { BrowserAlertInbox, UNCONNECTED_TEST_SCOPE } from '../src/background/browser-alert-inbox';
import { BROWSER_ALERTS_KEY, browserAlertsText, validateBrowserAlertsView, type BrowserAlert } from '../src/shared/browser-alerts';
import { validateAgendaRequest } from '../src/schoolware/agenda-request';
import { validateConnectionMessage } from '../src/shared/connection';
import { requestUrl } from './fixtures/agenda-request';

let stored: Record<string, unknown>;
const scopeId = validateAgendaRequest(requestUrl)!;
const alert = (overrides: Partial<BrowserAlert> = {}): BrowserAlert => ({ id: crypto.randomUUID(),
  createdAt: '2026-10-02T08:00:00.000Z', added: 1, changed: 0, days: 3, test: false, ...overrides });

beforeEach(() => {
  vi.setSystemTime(new Date('2026-10-02T08:00:00Z'));
  stored = {};
  vi.stubGlobal('chrome', { storage: { local: {
    get: vi.fn(async () => ({ ...stored })),
    set: vi.fn(async (next: Record<string, unknown>) => { Object.assign(stored, next); }),
  } } });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('generic Schoolware alert inbox', () => {
  it('validates generic to-do counts/dates, replaces previous reminders and keeps source alerts and other profiles intact', async () => {
    const inbox = new BrowserAlertInbox();
    const reminder = alert({ added: 0, days: 1, kind: 'todo', pending: 2, targetDay: '2026-10-05' });
    const source = alert(); await inbox.publish(scopeId, source, 90);
    await inbox.publish(scopeId, reminder, 90);
    const other = validateAgendaRequest(requestUrl.replace('CompletedTaskForLL=30', 'CompletedTaskForLL=40'))!;
    await inbox.publish(other, alert({ ...reminder, id: crypto.randomUUID() }), 90);
    const latest = { ...reminder, id: crypto.randomUUID(), pending: 3 };
    await inbox.publish(scopeId, latest, 90);
    expect(await inbox.read(scopeId, 90)).toEqual([latest, source]);
    expect(await inbox.read(other, 90)).toHaveLength(1);
    const safe = validateBrowserAlertsView({ ok: true, enabled: true, entries: [{ ...latest, title: 'Synthetic private title', scopeId }] })!;
    expect(safe.entries).toEqual([latest]); expect(JSON.stringify(safe)).not.toContain('private');
    expect(browserAlertsText([latest])).toContain('To-do: 3'); expect(browserAlertsText([latest])).toContain('maandag 5 oktober');
    for (const overrides of [{ pending: 0 }, { pending: -1 }, { targetDay: '2026-02-30' }, { test: true }, { added: 1 }, { kind: 'unknown' }, { days: 30 }]) {
      expect(validateBrowserAlertsView({ ok: true, enabled: true, entries: [{ ...latest, ...overrides }] })).toBeNull();
    }
  });
  it('deduplicates publication, isolates scopes, strips private fields and survives re-instantiation', async () => {
    const inbox = new BrowserAlertInbox();
    const first = alert();
    await inbox.publish(scopeId, first, 90);
    await inbox.publish(scopeId, first, 90);
    const other = validateAgendaRequest(requestUrl.replace('CompletedTaskForLL=30', 'CompletedTaskForLL=40'))!;
    await inbox.publish(other, alert(), 90);
    const restarted = new BrowserAlertInbox();
    expect(await restarted.read(scopeId, 90)).toEqual([first]);
    expect(JSON.stringify(await restarted.read(scopeId, 90))).not.toContain('CompletedTaskForLL');
    await restarted.dismiss(scopeId, 90);
    expect(await restarted.read(scopeId, 90)).toEqual([]);
    expect(await restarted.read(other, 90)).toHaveLength(1);
    const view = validateBrowserAlertsView({ ok: true, enabled: true, entries: [{ ...first, scopeId, title: 'Synthetic private title' }] })!;
    expect(view.entries).toEqual([first]);
    expect(JSON.stringify(view)).not.toContain('private');
  });

  it('serializes concurrent publications, bounds the inbox and prunes expired alerts', async () => {
    const inbox = new BrowserAlertInbox();
    await Promise.all(Array.from({ length: 25 }, () => inbox.publish(scopeId, alert(), 30)));
    expect(await inbox.read(scopeId, 30)).toHaveLength(20);
    vi.setSystemTime(new Date('2026-11-03T08:00:00Z'));
    expect(await inbox.read(scopeId, 30)).toEqual([]);
    expect(stored[BROWSER_ALERTS_KEY]).toEqual([]);
    await inbox.publish(UNCONNECTED_TEST_SCOPE, alert({ test: true, added: 0, createdAt: '2026-11-03T08:00:00.000Z' }), 30);
    expect(await inbox.read(scopeId, 30)).toEqual([]);
    await inbox.clear(30);
    expect(await inbox.read(UNCONNECTED_TEST_SCOPE, 30)).toEqual([]);
  });

  it('validates replies and refuses untrusted destination or payload parameters', () => {
    const first = alert();
    expect(validateBrowserAlertsView({ ok: true, enabled: true, entries: [first, first] })).toBeNull();
    expect(validateBrowserAlertsView({ ok: true, enabled: false, entries: [first] })).toBeNull();
    expect(validateBrowserAlertsView({ ok: true, enabled: true, entries: [{ ...first, added: -1 }] })).toBeNull();
    expect(validateConnectionMessage({ type: 'browser.alerts.open', url: 'https://example.test/' })).toBeNull();
    expect(validateConnectionMessage({ type: 'browser.alerts.test', title: 'Synthetic data' })).toBeNull();
    expect(browserAlertsText([first])).not.toContain(scopeId);
    expect(browserAlertsText([alert({ test: true, added: 0 })])).toContain('testmelding');
  });
});
