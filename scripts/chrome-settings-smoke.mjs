import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import process from 'node:process';
import { setTimeout, clearTimeout } from 'node:timers';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const { fetch, WebSocket, console } = globalThis;

// Run only in a fresh profile; never inspect the owner's browser or Schoolware.
const chromePath = process.argv[2];
if (!chromePath) throw new Error('Usage: node scripts/chrome-settings-smoke.mjs PATH_TO_CHROME');
const profile = await mkdtemp(join(tmpdir(), 'schoolware-settings-smoke-'));
const browser = spawn(chromePath, ['--headless=new', '--no-first-run', '--no-default-browser-check',
  '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0',
  '--enable-unsafe-extension-debugging', `--user-data-dir=${profile}`, 'about:blank'],
{ windowsHide: true, stdio: 'ignore' });
let socket;
let sequence = 0;
const pending = new Map();
async function poll(operation) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const value = await operation().catch(() => null);
    if (value) return value;
    await delay(100);
  }
  throw new Error('Synthetic Chrome smoke timed out');
}
function command(method, params = {}, sessionId) {
  const id = ++sequence;
  return new Promise((resolveCommand, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 10000);
    pending.set(id, { resolve: resolveCommand, reject, timer });
    socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
}
async function evaluate(sessionId, expression) {
  const result = await command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
  if (result.exceptionDetails) throw new Error('Synthetic Chrome evaluation failed');
  return result.result.value;
}
try {
  const port = await poll(async () => (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]);
  const version = await poll(async () => {
    const response = await fetch(`http://127.0.0.1:${port}/json/version`);
    return response.json();
  });
  socket = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((resolveOpen, reject) => { socket.onopen = resolveOpen; socket.onerror = reject; });
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    const waiter = pending.get(message.id);
    if (!waiter) return;
    clearTimeout(waiter.timer); pending.delete(message.id);
    if (message.error) waiter.reject(new Error(message.error.message));
    else waiter.resolve(message.result);
  };
  const { id } = await command('Extensions.loadUnpacked', { path: resolve('dist') });
  const optionsUrl = `chrome-extension://${id}/options.html`;
  async function openSettings() {
    const { targetId } = await command('Target.createTarget', { url: optionsUrl });
    const { sessionId } = await command('Target.attachToTarget', { targetId, flatten: true });
    await poll(() => evaluate(sessionId, 'Boolean([...document.querySelectorAll("select")].find(select => select.options[0]?.text === "5 minuten"))'));
    return { targetId, sessionId };
  }
  const page = await openSettings();
  const worker = await poll(async () => {
    const { targetInfos } = await command('Target.getTargets');
    return targetInfos.find((target) => target.type === 'service_worker' && target.url.startsWith(`chrome-extension://${id}/`));
  });
  const { sessionId: workerSession } = await command('Target.attachToTarget', { targetId: worker.targetId, flatten: true });
  // Make the first worker write slow to expose document-owned queue regressions.
  await evaluate(workerSession, `(() => {
    const original = chrome.storage.local.set.bind(chrome.storage.local);
    let first = true;
    chrome.storage.local.set = async (values) => {
      if (values.schoolwarePreferences && first) { first = false; await new Promise(resolve => setTimeout(resolve, 1000)); }
      return original(values);
    };
    return true;
  })()`);
  await evaluate(page.sessionId, `(() => {
    const select = [...document.querySelectorAll('select')].find(select => select.options[0]?.text === '5 minuten');
    select.value = '5'; select.dispatchEvent(new Event('change', { bubbles: true }));
    select.value = '30'; select.dispatchEvent(new Event('change', { bubbles: true }));
    return document.body.textContent.includes('Wijziging wordt opgeslagen');
  })()`);
  await command('Target.closeTarget', { targetId: page.targetId });
  let lastData;
  await poll(async () => {
    const data = await evaluate(workerSession, "chrome.storage.local.get('schoolwarePreferences')");
    lastData = data;
    return data.schoolwarePreferences?.intervalMinutes === 30;
  }).catch((error) => { console.log('Synthetic persisted preferences:', JSON.stringify(lastData)); throw error; });
  const restarted = await openSettings();
  await command('ServiceWorker.enable', {}, restarted.sessionId);
  await command('ServiceWorker.stopAllWorkers', {}, restarted.sessionId);
  const view = await evaluate(restarted.sessionId, "chrome.runtime.sendMessage({ type: 'preferences.read' })");
  assert.equal(view.ok, true);
  assert.equal(view.preferences.intervalMinutes, 30);
  assert.equal(view.preferences.notificationsEnabled, false);
  assert.equal(view.preferences.browserNotificationsEnabled, false);
  assert.equal(view.monitoringScheduled, false);
  console.log(`Chrome settings smoke passed (${version.Browser}): rapid edits, immediate tab closure, worker restart, permissions off by default.`);
  // Seed only the disposable profile with synthetic history to exercise the
  // actual worker projection and React schoolbag UI without a Schoolware fetch.
  await evaluate(restarted.sessionId, `(async () => {
    const now = new Date();
    const date = new Date(now.toLocaleDateString('en-CA', { timeZone: 'Europe/Brussels' }) + 'T12:00:00Z');
    do { date.setUTCDate(date.getUTCDate() + 1); } while ([0, 6].includes(date.getUTCDay()));
    const day = date.toISOString().slice(0, 10);
    const scopeId = 'https://schoolware_siw.ksgwl.be/webouders/bin/server.fcgi/REST/AgendaPunt?AgendaID=10&MapAgendasOp=20&MinTot=2026-01-01&MaxVan=2026-12-31&CompletedTaskForLL=30';
    const prefs = (await chrome.storage.local.get('schoolwarePreferences')).schoolwarePreferences;
    await chrome.storage.local.set({ schoolwarePreferences: { ...prefs, monitoringEnabled: false },
      schoolwareConnection: { requestUrl: scopeId, lastCheck: null } });
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('schoolware-watch-history', 3);
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    const tx = db.transaction('scopes', 'readwrite');
    tx.objectStore('scopes').put({ scopeId, localId: crypto.randomUUID(), baselineAt: now.toISOString(),
      lastSuccessAt: now.toISOString(), events: [], checks: [], items: [{ sourceKey: 'synthetic-bag-point',
        localId: crypto.randomUUID(), category: 'assignments', present: true, taskStatus: 'open',
        firstSeenAt: now.toISOString(), lastSeenAt: now.toISOString(),
        lesson: { key: 'synthetic-lesson', subject: 'Aardrijkskunde', room: '' },
        snapshot: { title: 'Synthetic workbook task', instructions: 'Werkboek pagina 24-34', typePunt: 1001,
          startsAt: day + ' 09:00:00', endsAt: day + ' 09:50:00', validFrom: day + ' 00:00:00',
          hidden: false, cancelled: false, recurrence: '' } }] });
    await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onabort = () => reject(tx.error); });
    db.close(); return true;
  })()`);
  const { targetId: bagTarget } = await command('Target.createTarget', { url: `chrome-extension://${id}/dashboard.html` });
  const { sessionId: bagSession } = await command('Target.attachToTarget', { targetId: bagTarget, flatten: true });
  await poll(() => evaluate(bagSession, `document.querySelector('[aria-label="Boekentas"]')?.textContent.includes('pagina 24-34')`));
  const bag = await evaluate(bagSession, `(() => {
    const section = document.querySelector('[aria-label="Boekentas"]');
    return { text: section.textContent, laptops: [...section.querySelectorAll('li')].filter(li => li.textContent.includes('Altijd meenemen')).length };
  })()`);
  assert.equal(bag.laptops, 2);
  assert.ok(bag.text.includes('Mee naar school') && bag.text.includes('Mee naar huis'));
  assert.ok(bag.text.includes('Aardrijkskunde') && bag.text.includes('Werkboek'));
  console.log('Chrome schoolbag smoke passed: worker projection, both packing lists, laptop defaults and synthetic workbook page range.');
} finally {
  if (socket?.readyState === WebSocket.OPEN) {
    await command('Browser.close').catch(() => {});
    socket.close();
  }
  browser.kill();
  // Keep the isolated synthetic profile for diagnosis; never remove user profiles.
}
