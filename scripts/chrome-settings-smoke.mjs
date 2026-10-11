import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { Buffer } from 'node:buffer';
import process from 'node:process';
import { setTimeout, clearTimeout } from 'node:timers';
import { mkdtemp, readFile, mkdir, writeFile, copyFile } from 'node:fs/promises';
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
  async function openSettings(checkGuide = false) {
    const { targetId } = await command('Target.createTarget', { url: optionsUrl });
    const { sessionId } = await command('Target.attachToTarget', { targetId, flatten: true });
    await poll(() => evaluate(sessionId, `document.querySelectorAll('.workspace-section').length === 5`));
    assert.equal(await evaluate(sessionId, `document.querySelectorAll('.workspace-section[open]').length`), 0);
    // Open the groups through their native summaries for the existing full-form checks.
    await evaluate(sessionId, `(() => { for (const section of document.querySelectorAll('.workspace-section:not([open])')) section.querySelector('summary').click(); return true; })()`);
    if (checkGuide) {
      await poll(() => evaluate(sessionId, `document.querySelector('[aria-label="Installatiehulp"]')?.textContent.includes('Stap 1 van 3')`));
      await poll(() => evaluate(sessionId, `Boolean([...document.querySelectorAll('button')].find(button => button.textContent === 'Schoolware verbinden'))`));
      for (const label of ['Lokale geschiedenis', 'Voortgang synchroniseren', 'Activiteitenlog']) {
        assert.equal(await evaluate(sessionId, `Boolean(document.querySelector('[aria-label="${label}"]'))`), true);
      }
      // Simulate a denied prompt without granting hosts or contacting Schoolware.
      await evaluate(sessionId, `(() => {
        chrome.permissions.request = async () => false;
        [...document.querySelectorAll('button')].find(button => button.textContent === 'Schoolware verbinden').click();
        return true;
      })()`);
      await poll(() => evaluate(sessionId, `document.body.textContent.includes('Geef toestemming om je agenda in Schoolware te herkennen.')`));
      const local = await evaluate(sessionId, "chrome.storage.local.get(['schoolwareConnection', 'schoolwareSetupComplete'])");
      assert.equal(local.schoolwareConnection, undefined);
      assert.equal(local.schoolwareSetupComplete, undefined);
      console.log('Chrome setup smoke passed: first-opening guide and denied access leave the agenda unconnected.');
    }
    await poll(() => evaluate(sessionId, `(() => {
      const later = [...document.querySelectorAll('button')].find(button => button.textContent === 'Later instellen');
      if (later) later.click();
      return Boolean([...document.querySelectorAll('select')].find(select => select.options[0]?.text === '5 minuten'));
    })()`));
    return { targetId, sessionId };
  }
  const page = await openSettings(true);
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
    await chrome.storage.local.set({ schoolwarePreferences: { ...prefs, monitoringEnabled: false, schoolbagEnabled: true },
      schoolwareConnection: { requestUrl: scopeId, lastCheck: null } });
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('schoolware-watch-history', 3);
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    const tx = db.transaction('scopes', 'readwrite');
    const laterItems = Array.from({ length: 6 }, (_, index) => {
      do { date.setUTCDate(date.getUTCDate() + 1); } while ([0, 6].includes(date.getUTCDay()));
      const laterDay = date.toISOString().slice(0, 10);
      return { sourceKey: 'synthetic-planning-' + index, localId: crypto.randomUUID(), category: 'assignments', present: true,
        taskStatus: 'open', firstSeenAt: now.toISOString(), lastSeenAt: now.toISOString(),
        snapshot: { title: 'Synthetic later planning ' + (index + 1), instructions: '', typePunt: 1001,
          startsAt: laterDay + ' 09:00:00', endsAt: laterDay + ' 09:50:00', validFrom: laterDay + ' 00:00:00',
          hidden: false, cancelled: false, recurrence: '' } };
    });
    tx.objectStore('scopes').put({ scopeId, localId: crypto.randomUUID(), baselineAt: now.toISOString(),
      lastSuccessAt: now.toISOString(), events: [], checks: [], items: [{ sourceKey: 'synthetic-bag-point',
        localId: crypto.randomUUID(), category: 'assignments', present: true, taskStatus: 'open',
        firstSeenAt: now.toISOString(), lastSeenAt: now.toISOString(),
        lesson: { key: 'synthetic-lesson', subject: 'Aardrijkskunde', room: '' },
        snapshot: { title: 'Synthetic workbook task', instructions: 'Werkboek pagina 24-34', typePunt: 1001,
          startsAt: day + ' 09:00:00', endsAt: day + ' 09:50:00', validFrom: day + ' 00:00:00',
          hidden: false, cancelled: false, recurrence: '' } }, ...laterItems] });
    await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onabort = () => reject(tx.error); });
    db.close(); return true;
  })()`);
  const { targetId: bagTarget } = await command('Target.createTarget', { url: `chrome-extension://${id}/dashboard.html` });
  const { sessionId: bagSession } = await command('Target.attachToTarget', { targetId: bagTarget, flatten: true });
  await poll(() => evaluate(bagSession, `(() => {
    return document.querySelector('[aria-label="Boekentas"]')?.textContent.includes('pagina 24-34');
  })()`));
  const bag = await evaluate(bagSession, `(() => {
    const section = document.querySelector('[aria-label="Boekentas"]');
    return { text: section.textContent, homeText: [...section.querySelectorAll('h3')].find(heading => heading.textContent === 'Mee naar huis').parentElement.textContent, laptops: [...section.querySelectorAll('li')].filter(li => li.textContent.includes('Altijd meenemen')).length };
  })()`);
  assert.equal(bag.laptops, 2);
  assert.ok(bag.text.includes('Mee naar school') && bag.text.includes('Mee naar huis'));
  assert.ok(bag.text.includes('Aardrijkskunde') && bag.text.includes('Werkboek'));
  assert.ok(!bag.homeText.includes('Werkboek'), 'Same-day workbook must not appear in next-day home packing');
  console.log('Chrome schoolbag smoke passed: worker projection, both packing lists, laptop defaults and synthetic workbook page range.');
  // Create and check a local special day through the real React form, then
  // restart the worker and verify the optional v3 profile fields remain durable.
  await poll(() => evaluate(bagSession, `Boolean(document.querySelector('[aria-label="Speciale dagen"] button:not(:disabled)'))`));
  assert.equal(await evaluate(bagSession, `document.querySelectorAll('.workspace-section[open]').length`), 1);
  await poll(() => evaluate(bagSession, `Boolean(document.getElementById('overview-status'))`));
  assert.equal(await evaluate(bagSession, `document.getElementById('overview-status').open`), false);
  assert.equal(await evaluate(bagSession, `document.querySelector('[aria-label="Snel naar onderdeel"]').querySelectorAll('button').length`), 5);
  await evaluate(bagSession, `document.querySelector('button[aria-controls="overview-schoolbag"]').click()`);
  await poll(() => evaluate(bagSession, `document.getElementById('overview-schoolbag').open && document.activeElement === document.getElementById('overview-schoolbag').querySelector('summary')`));
  await evaluate(bagSession, `document.getElementById('overview-schoolbag').querySelector('summary').click()`);
  await poll(() => evaluate(bagSession, `!document.getElementById('overview-schoolbag').open`));
  await evaluate(bagSession, `document.querySelector('[aria-label="Speciale dagen"]').closest('.workspace-section').querySelector('summary').focus()`);
  await command('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', text: '\r', unmodifiedText: '\r', windowsVirtualKeyCode: 13 }, bagSession);
  await command('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 }, bagSession);
  await poll(() => evaluate(bagSession, `document.querySelector('[aria-label="Speciale dagen"]').closest('.workspace-section').open`));
  await evaluate(bagSession, `(() => {
    [...document.querySelector('[aria-label="Speciale dagen"]').querySelectorAll('button')].find(button => button.textContent === 'Speciale dag toevoegen').click();
    return true;
  })()`);
  await poll(() => evaluate(bagSession, `Boolean(document.querySelector('[aria-label="Speciale dagen"] form'))`));
  await evaluate(bagSession, `(() => {
    [...document.querySelector('[aria-label="Speciale dagen"] form').querySelectorAll('button')].find(button => button.textContent === 'Checklistpunt toevoegen').click();
    return true;
  })()`);
  await poll(() => evaluate(bagSession, `Boolean([...document.querySelector('[aria-label="Speciale dagen"] form').querySelectorAll('label')].find(label => label.textContent.startsWith('Checklistpunt 1'))?.querySelector('input'))`));
  await evaluate(bagSession, `(() => {
    [...document.querySelector('[aria-label="Speciale dagen"] form').querySelectorAll('label')].find(label => label.textContent.startsWith('Checklistpunt 1')).querySelector('input').focus();
    return true;
  })()`);
  await command('Input.insertText', { text: 'Synthetic folders and charger' }, bagSession);
  await evaluate(bagSession, `document.querySelector('[aria-label="Speciale dagen"]').closest('.workspace-section').querySelector('summary').click()`);
  await poll(() => evaluate(bagSession, `!document.querySelector('[aria-label="Speciale dagen"]').closest('.workspace-section').open`));
  await evaluate(bagSession, `document.querySelector('[aria-label="Speciale dagen"]').closest('.workspace-section').querySelector('summary').click()`);
  await poll(() => evaluate(bagSession, `document.querySelector('[aria-label="Speciale dagen"]').closest('.workspace-section').open`));
  assert.equal(await evaluate(bagSession, `[...document.querySelector('[aria-label="Speciale dagen"] form').querySelectorAll('label')].find(label => label.textContent.startsWith('Checklistpunt 1')).querySelector('input').value`), 'Synthetic folders and charger');
  console.log('Chrome compact navigation smoke passed: collapsed settings, to-do open by default, native disclosure and preserved special-day draft.');
  await evaluate(bagSession, `(() => {
    [...document.querySelector('[aria-label="Speciale dagen"] form').querySelectorAll('label')].find(label => label.textContent.includes('Ook tonen in boekentas')).querySelector('input').click();
    document.querySelector('[aria-label="Speciale dagen"] form button[type="submit"]').click(); return true;
  })()`);
  await poll(() => evaluate(bagSession, `!document.querySelector('[aria-label="Speciale dagen"] form') && document.querySelector('[aria-label="Speciale dagen"]').textContent.includes('Synthetic folders and charger')`));
  await evaluate(bagSession, `(() => {
    [...document.querySelector('[aria-label="Speciale dagen"]').querySelectorAll('label')].find(label => label.textContent.includes('Synthetic folders and charger')).querySelector('input').click(); return true;
  })()`);
  await poll(() => evaluate(bagSession, `(async () => (await chrome.runtime.sendMessage({ type: 'specialDays.read' })).entries[0]?.checklist[0]?.done)()`));
  await command('ServiceWorker.stopAllWorkers', {}, restarted.sessionId);
  const special = await evaluate(bagSession, `chrome.runtime.sendMessage({ type: 'specialDays.read' })`);
  assert.equal(special.ok, true);
  assert.equal(special.entries[0].checklist[0].text, 'Synthetic folders and charger');
  assert.equal(special.entries[0].checklist[0].done, true);
  assert.equal(special.entries[0].revision, 2);
  const specialBag = await evaluate(bagSession, `chrome.runtime.sendMessage({ type: 'schoolbag.read' })`);
  assert.equal(specialBag.specialDays[0].checklist[0].pack, true);
  // Download the CSV to this disposable profile only and inspect the actual file.
  const downloadPath = join(profile, 'downloads');
  await mkdir(downloadPath);
  await command('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath });
  await evaluate(bagSession, `(() => {
    [...document.querySelectorAll('summary')].find(summary => summary.textContent === 'Taken exporteren (CSV)').click();
    [...document.querySelectorAll('button')].find(button => button.textContent.startsWith('CSV downloaden')).click(); return true;
  })()`);
  const csv = await poll(async () => readFile(join(downloadPath, 'schoolware-watch-taken.csv'), 'utf8'));
  assert.ok(csv.startsWith('\uFEFF"Datum";'));
  assert.ok(csv.includes('Synthetic workbook task'));
  assert.ok(csv.includes('Synthetic later planning 6'), 'Export must include tasks beyond the initial five-day planning window');
  assert.ok(!csv.includes(special.profileId));
  assert.ok(!csv.includes('Synthetic folders and charger'), 'Task CSV must not silently include free-form special-day notes');
  await evaluate(bagSession, `(async () => {
    const view = await chrome.runtime.sendMessage({ type: 'specialDays.read' });
    return chrome.runtime.sendMessage({ type: 'specialDays.delete', profileId: view.profileId, id: view.entries[0].id, revision: view.entries[0].revision });
  })()`);
  await poll(() => evaluate(bagSession, `!document.querySelector('[aria-label="Speciale dagen"]').textContent.includes('Synthetic folders and charger')`));
  console.log('Chrome CSV/special-day smoke passed: real form, checklist, local book bag projection, worker restart, deletion and full-selection CSV file download.');
  const { targetId: livePopupTarget } = await command('Target.createTarget', { url: `chrome-extension://${id}/popup.html` });
  const { sessionId: livePopupSession } = await command('Target.attachToTarget', { targetId: livePopupTarget, flatten: true });
  await poll(() => evaluate(livePopupSession, `document.body.textContent.includes('Synthetic workbook task')`));
  await evaluate(restarted.sessionId, `(async () => {
    const view = await chrome.runtime.sendMessage({ type: 'tasks.read' });
    const item = view.entries.find(item => item.snapshot.title === 'Synthetic workbook task');
    await chrome.runtime.sendMessage({ type: 'tasks.update', itemId: item.id, status: 'in-progress' });
    return true;
  })()`);
  const busyTaskVisible = `(() => {
    const item = [...document.querySelectorAll('li')].find(li => li.textContent.includes('Synthetic workbook task') && li.querySelector('input[type="checkbox"]'));
    return Boolean(item && [...item.querySelectorAll('label')].find(label => label.textContent.includes('Bezig'))?.querySelector('input')?.checked);
  })()`;
  await poll(() => evaluate(bagSession, busyTaskVisible));
  await poll(() => evaluate(livePopupSession, busyTaskVisible));
  await poll(() => evaluate(restarted.sessionId, `document.querySelector('[aria-label="Activiteitenlog"]')?.textContent.includes('task.status')`));
  await evaluate(restarted.sessionId, `(async () => {
    const view = await chrome.runtime.sendMessage({ type: 'tasks.read' });
    await chrome.runtime.sendMessage({ type: 'tasks.update', itemId: view.entries.find(item => item.snapshot.title === 'Synthetic workbook task').id, status: 'open' });
    return true;
  })()`);
  await command('Target.closeTarget', { targetId: livePopupTarget });
  console.log('Chrome live progress smoke passed: existing popup, dashboard and settings log update without reload.');
  assert.equal(await evaluate(bagSession, `Boolean(document.querySelector('[aria-label="To-do voor de volgende schooldag"]').compareDocumentPosition(document.querySelector('[aria-label="Boekentas"]')) & Node.DOCUMENT_POSITION_FOLLOWING)`), true);
  assert.equal(await evaluate(bagSession, `Boolean(document.querySelector('[aria-label="Boekentas"]').compareDocumentPosition(document.querySelector('[aria-label="Taken, toetsen en voortgang"]')) & Node.DOCUMENT_POSITION_FOLLOWING)`), true);
  assert.equal(await evaluate(bagSession, `document.querySelectorAll('[aria-label="To-do voor de volgende schooldag"]').length`), 1);
  assert.equal(await evaluate(bagSession, `document.querySelector('[aria-label="Taken, toetsen en voortgang"]').textContent.includes('Synthetic later planning 6')`), false);
  await evaluate(bagSession, `([...document.querySelectorAll('button')].find(button => button.textContent.includes('Verder vooruit kijken'))).click()`);
  await poll(() => evaluate(bagSession, `document.querySelector('[aria-label="Taken, toetsen en voortgang"]').textContent.includes('Synthetic later planning 6')`));
  const packedSelector = '[aria-label="Aardrijkskunde Werkboek ingepakt"]';
  await poll(() => evaluate(bagSession, `document.querySelector('${packedSelector}') && !document.querySelector('${packedSelector}').disabled`));
  await evaluate(bagSession, `document.querySelector('${packedSelector}').click()`);
  await poll(() => evaluate(bagSession, `document.querySelector('${packedSelector}')?.checked && !document.querySelector('${packedSelector}').disabled`));
  await command('Page.reload', {}, bagSession);
  await poll(() => evaluate(bagSession, `document.querySelector('${packedSelector}')?.checked && !document.querySelector('${packedSelector}').disabled`));
  await evaluate(bagSession, `document.querySelector('${packedSelector}').closest('li').querySelector('button').click()`);
  await poll(() => evaluate(bagSession, `!document.querySelector('${packedSelector}') && document.querySelector('[aria-label="Boekentas"]').textContent.includes('Verborgen suggesties tonen (1)')`));
  await evaluate(bagSession, `[...document.querySelectorAll('button')].find(button => button.textContent.includes('Verborgen suggesties tonen')).click()`);
  await poll(() => evaluate(bagSession, `document.querySelector('${packedSelector}') && !document.querySelector('${packedSelector}').disabled`));
  await evaluate(bagSession, `document.querySelector('${packedSelector}').closest('li').querySelector('button').click()`);
  await poll(() => evaluate(bagSession, `!document.querySelector('[aria-label="Boekentas"]').textContent.includes('Terugzetten')`));
  await evaluate(bagSession, `(async () => {
    const { schoolwareConnection: connection } = await chrome.storage.local.get('schoolwareConnection');
    await chrome.storage.local.set({ schoolwareConnection: { ...connection, lastCheck: { status: 'session-required', count: null, checkedAt: new Date().toISOString() } } });
    return true;
  })()`);
  await poll(() => evaluate(bagSession, `document.querySelector('[aria-label="Koppelingsstatus"]')?.textContent.includes('Opnieuw aanmelden')`));
  assert.equal(await evaluate(bagSession, `document.querySelector('[aria-label="Koppelingsstatus"]').textContent.includes('Laatste geslaagde controle: nog geen')`), false);
  console.log('Chrome overview smoke passed: one to-do, compact planning with expansion, durable packing choices, hide/restore and expired-session status.');
  await poll(() => evaluate(restarted.sessionId, `(() => {
    const panel = document.querySelector('[aria-label="Voortgang synchroniseren"]');
    const name = [...panel.querySelectorAll('label')].find(label => label.textContent.includes('op deze computer (optioneel)'))?.querySelector('input');
    const create = [...panel.querySelectorAll('button')].find(button => button.textContent === 'Nieuwe leerlinggroep aanmaken');
    return name?.value === '' && create && !create.disabled;
  })()`));
  console.log('Chrome privacy smoke passed: group setup allows an empty optional participant label without sending a network request.');
  assert.equal(await evaluate(restarted.sessionId, `Boolean([...document.querySelectorAll('button')].find(button => button.textContent === 'Leerlingvoortgang delen')?.disabled)`), true);
  await evaluate(restarted.sessionId, `(() => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => { throw new Error('Synthetic denied clipboard'); } } });
    [...document.querySelectorAll('button')].find(button => button.textContent === 'Extensie delen').click(); return true;
  })()`);
  await poll(() => evaluate(restarted.sessionId, `document.body.textContent.includes('openbare installatiebericht')`));
  assert.equal(await evaluate(restarted.sessionId, `(() => {
    const text = document.querySelector('[aria-label="Voortgang synchroniseren"] textarea')?.value ?? '';
    return text.includes('chromewebstore.google.com/detail/phngkgibiapcabhnfjafkfibjobgkkaf') && !text.includes('sw1.') &&
      !text.includes('Koppelen aan een bestaande computer');
  })()`), true);
  await evaluate(restarted.sessionId, `(async () => {
    const { schoolwareConnection: connection } = await chrome.storage.local.get('schoolwareConnection');
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('schoolware-watch-history', 3);
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    const tx = db.transaction('sync', 'readwrite');
    tx.objectStore('sync').put({ connectionId: crypto.randomUUID(), scopeId: connection.requestUrl,
      token: 'a'.repeat(64), key: 'b'.repeat(64), cursor: 0, head: 0, outbox: [], remote: {},
      lastSuccessAt: null, error: false }, 'progressSync');
    await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = reject; });
    db.close(); return true;
  })()`);
  await command('Page.reload', {}, restarted.sessionId);
  await poll(() => evaluate(restarted.sessionId, `Boolean([...document.querySelectorAll('button')].find(button => button.textContent === 'Leerlingvoortgang delen' && !button.disabled))`));
  await evaluate(restarted.sessionId, `(() => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => { throw new Error('Synthetic denied clipboard'); } } });
    [...document.querySelectorAll('button')].find(button => button.textContent === 'Leerlingvoortgang delen').click(); return true;
  })()`);
  await poll(() => evaluate(restarted.sessionId, `document.body.textContent.includes('Automatisch kopiëren is niet gelukt')`));
  assert.equal(await evaluate(restarted.sessionId, `(() => {
    const text = document.querySelector('[aria-label="Voortgang synchroniseren"] textarea')?.value ?? '';
    return text.includes('chromewebstore.google.com/detail/phngkgibiapcabhnfjafkfibjobgkkaf') &&
      text.includes('sw1.' + 'a'.repeat(64) + '.' + 'b'.repeat(64)) && text.includes('Koppelen aan een bestaande computer');
  })()`), true);
  await evaluate(restarted.sessionId, `(async () => {
    [...document.querySelectorAll('button')].find(button => button.textContent === 'Uitnodiging verbergen').click();
    const db = await new Promise(resolve => { const request = indexedDB.open('schoolware-watch-history', 3); request.onsuccess = () => resolve(request.result); });
    const tx = db.transaction('sync', 'readwrite'); tx.objectStore('sync').delete('progressSync');
    await new Promise(resolve => { tx.oncomplete = resolve; }); db.close(); return true;
  })()`);
  await command('Page.reload', {}, restarted.sessionId);
  await poll(() => evaluate(restarted.sessionId, `Boolean([...document.querySelectorAll('button')].find(button => button.textContent === 'Nieuwe leerlinggroep aanmaken'))`));
  console.log('Chrome sharing smoke passed: separate public installation and private progress actions, pairing requirement and copy fallback.');
  const toggleSchoolbag = () => evaluate(restarted.sessionId, `(() => {
    [...document.querySelectorAll('label')].find(label => label.textContent.includes('Boekentas tonen onder de to-do')).querySelector('input').click();
    return true;
  })()`);
  await poll(() => evaluate(restarted.sessionId, `Boolean([...document.querySelectorAll('label')].find(label => label.textContent.includes('Boekentas tonen onder de to-do'))?.querySelector('input').checked)`));
  await toggleSchoolbag();
  await poll(() => evaluate(bagSession, `!document.querySelector('[aria-label="Boekentas"]')`));
  assert.equal(await evaluate(bagSession, `getComputedStyle([...document.querySelectorAll('.workspace-section')].find(section => section.querySelector('summary').textContent.trim().startsWith('Boekentas'))).display`), 'none');
  assert.equal(await evaluate(bagSession, `getComputedStyle(document.querySelector('button[aria-controls="overview-schoolbag"]')).display`), 'none');
  assert.equal(await evaluate(bagSession, `(async () => (await chrome.runtime.sendMessage({ type: 'preferences.read' })).preferences.schoolbagEnabled)()`), false);
  await toggleSchoolbag();
  await poll(() => evaluate(bagSession, `document.querySelector('[aria-label="Boekentas"]')?.textContent.includes('pagina 24-34')`));
  console.log('Chrome schoolbag preference smoke passed: below to-do and above planning, immediate hide/show and durable visibility preference.');
  // The dashboard must retain its own content while setup/repair is pending.
  assert.equal(await evaluate(bagSession, `Boolean(document.querySelector('[aria-label="Taken, toetsen en voortgang"]'))`), true);
  assert.equal(await evaluate(restarted.sessionId, `Boolean(document.querySelector('[aria-label="Voortgang synchroniseren"]'))`), true);
  console.log('Chrome navigation smoke passed: dashboard tasks and full settings remain available during setup.');
  const { targetId: upgradeTarget } = await command('Target.createTarget', { url: optionsUrl });
  const { sessionId: upgradeSession } = await command('Target.attachToTarget', { targetId: upgradeTarget, flatten: true });
  await poll(() => evaluate(upgradeSession, `Boolean(document.querySelector('[aria-label="Automatische controle en meldingen"]'))`));
  // Simulate the UI host-permission result; no actual permission or session is granted.
  await evaluate(upgradeSession, `(async () => {
    chrome.permissions.contains = async () => true;
    const data = await chrome.storage.local.get('schoolwareConnection');
    await chrome.storage.local.set({ schoolwareConnection: { ...data.schoolwareConnection,
      lastCheck: { status: 'success', count: 1, checkedAt: '2026-10-05T08:00:00Z' } } });
    return true;
  })()`);
  await poll(() => evaluate(upgradeSession, `!document.querySelector('[aria-label="Installatiehulp"]')`));
  assert.equal(await evaluate(upgradeSession, `Boolean(document.querySelector('[aria-label="Lokale geschiedenis"]'))`), true);
  console.log('Chrome upgrade smoke passed: existing connection/preferences need no new setup marker.');

  // Test the bundled content script on a synthetic page with a simulated runtime.
  // No real Schoolware tab, payload or browser session is inspected.
  const { targetId: bannerTarget } = await command('Target.createTarget', { url: 'about:blank' });
  const { sessionId: bannerSession } = await command('Target.attachToTarget', { targetId: bannerTarget, flatten: true });
  await evaluate(bannerSession, `(() => {
    globalThis.syntheticListeners = [];
    globalThis.syntheticReports = 0;
    globalThis.syntheticAlert = { id: '11111111-1111-4111-8111-111111111111', createdAt: '2026-10-05T08:00:00Z', added: 0, changed: 0, days: 3, test: true };
    globalThis.syntheticView = { ok: true, enabled: true, entries: [globalThis.syntheticAlert] };
    globalThis.schoolwareAlertAttached = true;
    globalThis.chrome = { runtime: { id: 'synthetic-extension',
      sendMessage: async (message) => { if (message.type === 'browser.alerts.rendered') globalThis.syntheticReports++; return globalThis.syntheticView; },
      onMessage: { addListener: (listener) => globalThis.syntheticListeners.push(listener),
        removeListener: (listener) => { globalThis.syntheticListeners = globalThis.syntheticListeners.filter(value => value !== listener); } } } };
    return true;
  })()`);
  const bannerScript = await readFile(resolve('dist/website-alert.js'), 'utf8');
  await evaluate(bannerSession, bannerScript);
  await poll(() => evaluate(bannerSession, `document.querySelector('schoolware-watch-alert')?.getBoundingClientRect().height > 0`));
  await evaluate(bannerSession, bannerScript);
  await poll(() => evaluate(bannerSession, `globalThis.syntheticReports === 2`));
  assert.deepEqual(await evaluate(bannerSession, `({ hosts: document.querySelectorAll('schoolware-watch-alert').length, listeners: globalThis.syntheticListeners.length })`), { hosts: 1, listeners: 1 });
  await evaluate(bannerSession, `(() => {
    globalThis.syntheticView = { ok: true, enabled: true, entries: [] };
    globalThis.syntheticListeners.forEach(listener => listener({ type: 'browser.alerts.updated' }, { id: 'synthetic-extension' })); return true;
  })()`);
  await poll(() => evaluate(bannerSession, `!document.querySelector('schoolware-watch-alert')`));
  await evaluate(bannerSession, `(() => {
    globalThis.syntheticView = { ok: true, enabled: true, entries: [globalThis.syntheticAlert] };
    globalThis.syntheticListeners.forEach(listener => listener({ type: 'browser.alerts.updated' }, { id: 'synthetic-extension' })); return true;
  })()`);
  await poll(() => evaluate(bannerSession, `Boolean(document.querySelector('schoolware-watch-alert'))`));
  console.log('Chrome banner smoke passed: stale attachment recovery, single listener/host after reinjection, dismissal and redisplay.');
  if (process.argv.includes('--store-assets')) {
    const assets = resolve('artifacts/chrome-web-store');
    await mkdir(assets, { recursive: true });
    await copyFile(resolve('public/icons/icon128.png'), join(assets, 'icon128.png'));
    // Add a second fictional due day for the home packing screenshot only.
    await evaluate(restarted.sessionId, `(async () => {
      const db = await new Promise((resolve, reject) => {
        const request = indexedDB.open('schoolware-watch-history', 3);
        request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
      });
      const tx = db.transaction('scopes', 'readwrite');
      const store = tx.objectStore('scopes');
      const request = store.getAll();
      request.onsuccess = () => {
        const scope = request.result[0]; const first = scope.items[0];
        const date = new Date(first.snapshot.startsAt.slice(0, 10) + 'T12:00:00Z');
        do { date.setUTCDate(date.getUTCDate() + 1); } while ([0, 6].includes(date.getUTCDay()));
        const day = date.toISOString().slice(0, 10);
        scope.items.push({ ...first, sourceKey: 'synthetic-home-point', localId: crypto.randomUUID(),
          lesson: { key: 'synthetic-french-lesson', subject: 'Frans', room: '' },
          snapshot: { ...first.snapshot, title: 'Oefeningen voorbereiden', instructions: 'Cursus pagina 50-65',
            startsAt: day + ' 10:00:00', endsAt: day + ' 10:50:00' } });
        first.snapshot.title = 'Oefeningen in het werkboek'; store.put(scope);
      };
      await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onabort = () => reject(tx.error); });
      db.close(); return true;
    })()`);
    await command('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false }, bagSession);
    await command('Page.enable', {}, bagSession);
    await command('Page.navigate', { url: `chrome-extension://${id}/dashboard.html` }, bagSession);
    await poll(() => evaluate(bagSession, `(() => {
      [...document.querySelectorAll('button')].find(button => button.textContent === 'Later instellen')?.click();
      return document.querySelector('[aria-label="Boekentas"]')?.textContent.includes('pagina 50-65');
    })()`));
    const capture = async (fileName, selector) => {
      await evaluate(bagSession, `(() => {
        const group = document.querySelector(${JSON.stringify(selector)}).closest('.workspace-section');
        if (group && !group.open) group.querySelector('summary').click();
        document.querySelector(${JSON.stringify(selector)}).scrollIntoView({ block: 'start' });
        window.scrollBy(0, -80);
        let label = document.getElementById('synthetic-store-label');
        if (!label) { label = document.createElement('div'); label.id = 'synthetic-store-label'; document.body.append(label); }
        label.textContent = 'Voorbeeld met fictieve agendagegevens';
        label.style.cssText = 'position:fixed;bottom:12px;right:12px;background:#134e4a;color:white;padding:8px 12px;border-radius:8px;font:12px Arial;z-index:9999';
        return true;
      })()`);
      await delay(200);
      const { data } = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, bagSession);
      await writeFile(join(assets, fileName), Buffer.from(data, 'base64'));
    };
    await capture('screenshot-schoolbag-1280x800.png', '[aria-label="Boekentas"]');
    await capture('screenshot-tasks-1280x800.png', '[aria-label="Taken, toetsen en voortgang"]');
    const icon = (await readFile(resolve('public/icons/icon128.png'))).toString('base64');
    const { targetId: promoTarget } = await command('Target.createTarget', { url: 'about:blank' });
    const { sessionId: promoSession } = await command('Target.attachToTarget', { targetId: promoTarget, flatten: true });
    await command('Emulation.setDeviceMetricsOverride', { width: 440, height: 280, deviceScaleFactor: 1, mobile: false }, promoSession);
    await command('Page.enable', {}, promoSession);
    await command('Page.setDocumentContent', { frameId: (await command('Page.getFrameTree', {}, promoSession)).frameTree.frame.id,
      html: '<html><body style="margin:0"><canvas width="440" height="280"></canvas></body></html>' }, promoSession);
    await evaluate(promoSession, `(async () => {
      const context = document.querySelector('canvas').getContext('2d');
      const gradient = context.createLinearGradient(0, 0, 440, 280);
      gradient.addColorStop(0, '#134e4a'); gradient.addColorStop(1, '#0f766e');
      context.fillStyle = gradient; context.fillRect(0, 0, 440, 280);
      const image = new Image(); image.src = 'data:image/png;base64,${icon}';
      await new Promise(resolve => image.onload = resolve);
      context.drawImage(image, 164, 24, 112, 112);
      context.fillStyle = '#ffffff'; context.textAlign = 'center'; context.font = 'bold 30px Arial';
      context.fillText('Schoolware Watch', 220, 181);
      context.font = '17px Arial'; context.fillStyle = '#ccfbf1';
      context.fillText('Agenda, taken en boekentas', 220, 216);
      context.font = '12px Arial'; context.fillText('Een onafhankelijk project van Bumper.be', 220, 250);
      return true;
    })()`);
    const { data } = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, promoSession);
    await writeFile(join(assets, 'promo-440x280.png'), Buffer.from(data, 'base64'));
    console.log('Store assets generated from the real extension UI with synthetic data only.');
  }
} finally {
  if (socket?.readyState === WebSocket.OPEN) {
    await command('Browser.close').catch(() => {});
    socket.close();
  }
  browser.kill();
  // Keep the isolated synthetic profile for diagnosis; never remove user profiles.
}
