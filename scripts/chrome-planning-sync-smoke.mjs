import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { setTimeout, clearTimeout } from 'node:timers';
import process from 'node:process';

const { fetch, WebSocket, console } = globalThis;
const chromePath = process.argv[2];
if (!chromePath) throw new Error('Usage: node scripts/chrome-planning-sync-smoke.mjs PATH_TO_CHROME');
const profile = await mkdtemp(join(tmpdir(), 'schoolware-planning-sync-'));
const secondBuild = join(profile, 'second-extension');
await cp(resolve('dist'), secondBuild, { recursive: true });
const browser = spawn(chromePath, ['--headless=new', '--no-first-run', '--no-default-browser-check',
  '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0', '--enable-unsafe-extension-debugging',
  `--user-data-dir=${profile}`, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
let socket; let sequence = 0; let bindingError;
const pending = new Map();
const server = new Map();
const serverMembers = new Map();
async function poll(operation) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (bindingError) throw bindingError;
    const value = await operation().catch(() => null);
    if (value) return value;
    await delay(100);
  }
  throw new Error('Synthetic shared planning smoke timed out');
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
  if (result.exceptionDetails) throw new Error(`Synthetic Chrome evaluation failed: ${result.exceptionDetails.exception?.description ?? result.exceptionDetails.text}`);
  return result.result.value;
}
async function routeBinding(message) {
  const request = JSON.parse(message.params.payload);
  assert.equal(request.url, 'https://schoolware.bumper.be/sync.php');
  assert.equal(request.options.credentials, 'omit');
  const body = JSON.parse(request.options.body);
  assert.ok(!request.options.body.includes('Synthetic shared notes'));
  const token = request.options.headers.Authorization;
  if (body.action === 'members') {
    const members = serverMembers.get(token) ?? new Map(); serverMembers.set(token, members);
    assert.deepEqual(Object.keys(body.device).sort(), ['ciphertext', 'id', 'iv']);
    members.set(body.device.id, { ...body.device, lastSeenAt: new Date().toISOString().replace(/\.\d{3}Z$/, '.000Z') });
    await evaluate(message.sessionId, `globalThis.syntheticReply(${JSON.stringify(request.id)}, ${JSON.stringify({ ok: true, members: [...members.values()] })})`);
    return;
  }
  assert.equal(body.action, 'exchange');
  const records = server.get(token) ?? []; server.set(token, records);
  for (const operation of body.operations) {
    assert.deepEqual(Object.keys(operation).sort(), ['ciphertext', 'id', 'iv']);
    assert.ok(operation.ciphertext.length <= 2048);
    if (!records.some((entry) => entry.id === operation.id)) records.push({ ...operation, revision: records.length + 1 });
  }
  const operations = records.filter((entry) => entry.revision > body.cursor).slice(0, 200);
  const response = { ok: true, acknowledged: body.operations.map((entry) => entry.id), operations,
    cursor: operations.at(-1)?.revision ?? records.length, head: records.length };
  await evaluate(message.sessionId, `globalThis.syntheticReply(${JSON.stringify(request.id)}, ${JSON.stringify(response)})`);
}
try {
  const port = await poll(async () => (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]);
  const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
  socket = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((resolveOpen, reject) => { socket.onopen = resolveOpen; socket.onerror = reject; });
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.method === 'Runtime.bindingCalled' && message.params.name === 'syntheticExchange') {
      void routeBinding(message).catch((error) => { bindingError = error; }); return;
    }
    const waiter = pending.get(message.id); if (!waiter) return;
    clearTimeout(waiter.timer); pending.delete(message.id);
    if (message.error) waiter.reject(new Error(message.error.message)); else waiter.resolve(message.result);
  };
  async function device(path, pupil) {
    const { id } = await command('Extensions.loadUnpacked', { path });
    const { targetId } = await command('Target.createTarget', { url: `chrome-extension://${id}/dashboard.html` });
    const { sessionId } = await command('Target.attachToTarget', { targetId, flatten: true });
    await poll(() => evaluate(sessionId, `Boolean(document.querySelector('[aria-label="Speciale dagen"]'))`));
    const worker = await poll(async () => (await command('Target.getTargets')).targetInfos.find((target) =>
      target.type === 'service_worker' && target.url.startsWith(`chrome-extension://${id}/`)));
    const { sessionId: workerSession } = await command('Target.attachToTarget', { targetId: worker.targetId, flatten: true });
    await command('Runtime.enable', {}, workerSession);
    await command('Runtime.addBinding', { name: 'syntheticExchange' }, workerSession);
    // Every worker request is handled by the in-memory binding. No Schoolware
    // session or real sync host is contacted, and no real permission is granted.
    await evaluate(workerSession, `(() => {
      chrome.permissions.contains = async () => true;
      globalThis.syntheticNotifications = [];
      chrome.notifications ??= {};
      chrome.notifications.create = async (id, options) => { syntheticNotifications.push({ id, options }); return id; };
      const replies = new Map();
      globalThis.syntheticReply = (id, body) => { replies.get(id)(Response.json(body)); replies.delete(id); };
      globalThis.fetch = async (url, options) => new Promise(resolve => {
        const id = crypto.randomUUID(); replies.set(id, resolve);
        syntheticExchange(JSON.stringify({ id, url, options }));
      }); return true;
    })()`);
    const day = await evaluate(sessionId, `(async () => {
      const preferences = (await chrome.runtime.sendMessage({ type: 'preferences.read' })).preferences;
      const now = new Date();
      const date = new Date(now.toLocaleDateString('en-CA', { timeZone: 'Europe/Brussels' }) + 'T12:00:00Z');
      do { date.setUTCDate(date.getUTCDate() + 1); } while ([0, 6].includes(date.getUTCDay()));
      const day = date.toISOString().slice(0, 10);
      const scopeId = 'https://schoolware_siw.ksgwl.be/webouders/bin/server.fcgi/REST/AgendaPunt?AgendaID=10&MapAgendasOp=20&MinTot=2026-01-01&MaxVan=2026-12-31&CompletedTaskForLL=${pupil}';
      await chrome.storage.local.set({ schoolwarePreferences: { ...preferences, monitoringEnabled: false, notificationsEnabled: false },
        schoolwareConnection: { requestUrl: scopeId, lastCheck: null } });
      const db = await new Promise((resolve, reject) => {
        const request = indexedDB.open('schoolware-watch-history', 3);
        request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
      });
      const tx = db.transaction('scopes', 'readwrite');
      tx.objectStore('scopes').put({ scopeId, localId: crypto.randomUUID(), baselineAt: now.toISOString(),
        lastSuccessAt: now.toISOString(), events: [], checks: [], items: [{ sourceKey: '[11,22,33,null,null]',
          localId: crypto.randomUUID(), category: 'assignments', present: true, taskStatus: 'open',
          firstSeenAt: now.toISOString(), lastSeenAt: now.toISOString(), lesson: { key: 'synthetic', subject: 'Synthetic subject', room: '' },
          snapshot: { title: 'Synthetic shared task', instructions: 'Werkboek pagina 10', typePunt: 1001,
            startsAt: day + ' 09:00:00', endsAt: day + ' 09:50:00', validFrom: day + ' 00:00:00', hidden: false, cancelled: false, recurrence: '' } }] });
      await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onabort = () => reject(tx.error); }); db.close();
      const connected = await chrome.runtime.sendMessage({ type: 'sync.connect', code: 'sw1.' + 'a'.repeat(64) + '.' + 'b'.repeat(64), seed: false,
        label: '${pupil === 30 ? 'Synthetic parent' : 'Synthetic pupil'}' });
      if (!connected.ok) throw new Error('Synthetic connection failed');
      return day;
    })()`);
    return { id, targetId, sessionId, workerSession, day };
  }
  const parent = await device(resolve('dist'), 30);
  const pupil = await device(secondBuild, 31);
  assert.notEqual(parent.id, pupil.id);
  assert.equal(parent.day, pupil.day);
  await evaluate(parent.sessionId, `(async () => {
    const view = await chrome.runtime.sendMessage({ type: 'specialDays.read' });
    const entry = { id: crypto.randomUUID(), revision: 0, day: ${JSON.stringify(parent.day)}, kind: 'home-study', title: 'Synthetic shared home study',
      notes: 'Synthetic shared notes', useTimetable: true, preparationDay: new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Brussels' }),
      checklist: [{ id: crypto.randomUUID(), text: 'Synthetic shared folders', done: false, pack: true }] };
    const saved = await chrome.runtime.sendMessage({ type: 'specialDays.save', profileId: view.profileId, entry });
    if (!saved.ok) throw new Error('Synthetic event save failed');
    return chrome.runtime.sendMessage({ type: 'sync.run' });
  })()`);
  await evaluate(pupil.sessionId, `chrome.runtime.sendMessage({ type: 'sync.run' })`);
  await poll(() => evaluate(pupil.sessionId, `document.querySelector('[aria-label="Speciale dagen"]').textContent.includes('Synthetic shared notes')`));
  // After the evening cutoff, today's bring-home reminder must not select today
  // for the school/study list. The separate home list retains today's choices.
  await evaluate(pupil.sessionId, `(() => {
    const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Brussels', hour: '2-digit', hourCycle: 'h23' }).format(new Date()));
    if (hour >= 16) {
      const panel = document.querySelector('[aria-label="Boekentas"]');
      if (panel.querySelector('select')?.value !== ${JSON.stringify(pupil.day)} || !panel.textContent.includes('Nodig voor thuisstudie') || !panel.textContent.includes('Meenemen naar huis op'))
        throw new Error('Synthetic evening preparation kept the study list on today');
    }
    return true;
  })()`);
  assert.equal(await evaluate(pupil.sessionId, `(async () => (await chrome.runtime.sendMessage({ type: 'specialDays.read' })).sharing.enabled)()`), true);
  assert.equal(await evaluate(pupil.sessionId, `document.querySelector('[aria-label="Speciale dagen"]').textContent.includes('Laatst gesynchroniseerd:')`), true);
  await evaluate(pupil.sessionId, `(() => {
    [...document.querySelector('[aria-label="Speciale dagen"]').querySelectorAll('label')].find(label => label.textContent.includes('Synthetic shared folders')).querySelector('input').click(); return true;
  })()`);
  await poll(() => evaluate(pupil.sessionId, `(async () => (await chrome.runtime.sendMessage({ type: 'specialDays.read' })).entries[0]?.checklist[0]?.done)()`));
  await evaluate(pupil.sessionId, `chrome.runtime.sendMessage({ type: 'sync.run' })`);
  await evaluate(parent.sessionId, `chrome.runtime.sendMessage({ type: 'sync.run' })`);
  await poll(() => evaluate(parent.sessionId, `Boolean([...document.querySelector('[aria-label="Speciale dagen"]').querySelectorAll('label')].find(label => label.textContent.includes('Synthetic shared folders'))?.querySelector('input')?.checked)`));
  await poll(() => evaluate(parent.sessionId, `Boolean(document.querySelector('[aria-label="Boekentas"] input[aria-label="Laptop ingepakt"]:not(:disabled)'))`));
  await evaluate(parent.sessionId, `(() => { document.querySelector('[aria-label="Boekentas"] input[aria-label="Laptop ingepakt"]').click(); return true; })()`);
  await poll(() => evaluate(parent.sessionId, `(async () => (await chrome.runtime.sendMessage({ type: 'schoolbag.read' })).choices?.some(choice => choice.state === 'packed'))()`));
  await evaluate(parent.sessionId, `chrome.runtime.sendMessage({ type: 'sync.run' })`);
  await evaluate(pupil.sessionId, `chrome.runtime.sendMessage({ type: 'sync.run' })`);
  await poll(() => evaluate(pupil.sessionId, `Boolean(document.querySelector('[aria-label="Boekentas"] input[aria-label="Laptop ingepakt"]')?.checked)`));
  await evaluate(parent.sessionId, `(async () => {
    const view = await chrome.runtime.sendMessage({ type: 'specialDays.read' });
    const entry = view.entries[0];
    await chrome.runtime.sendMessage({ type: 'specialDays.delete', profileId: view.profileId, id: entry.id, revision: entry.revision });
    return chrome.runtime.sendMessage({ type: 'sync.run' });
  })()`);
  await evaluate(pupil.sessionId, `chrome.runtime.sendMessage({ type: 'sync.run' })`);
  await poll(() => evaluate(pupil.sessionId, `!document.querySelector('[aria-label="Speciale dagen"]').textContent.includes('Synthetic shared notes')`));
  await evaluate(parent.sessionId, `chrome.runtime.sendMessage({ type: 'sync.run' })`);
  await poll(() => evaluate(parent.sessionId, `(async () => (await chrome.runtime.sendMessage({ type: 'tasks.read' })).helpRecipients?.some(member => member.label === 'Synthetic pupil'))()`));
  await evaluate(parent.sessionId, `(() => {
    const panel = document.querySelector('[aria-label="To-do voor de volgende schooldag"]');
    [...panel.querySelectorAll('label')].find(label => label.textContent === 'Hulp nodig').querySelector('input').click(); return true;
  })()`);
  await poll(() => evaluate(parent.sessionId, `Boolean([...document.querySelectorAll('label')].find(label => label.textContent.trim() === 'Synthetic pupil'))`));
  await evaluate(parent.sessionId, `(() => {
    const panel = document.querySelector('[aria-label="To-do voor de volgende schooldag"]');
    [...panel.querySelectorAll('label')].find(label => label.textContent.trim() === 'Synthetic pupil').querySelector('input').click();
    [...panel.querySelectorAll('button')].find(button => button.textContent === 'Hulpvraag opslaan').click(); return true;
  })()`);
  await poll(() => evaluate(parent.sessionId, `(async () => (await chrome.runtime.sendMessage({ type: 'tasks.read' })).entries[0]?.help?.recipients.length === 1)()`));
  await evaluate(parent.sessionId, `(async () => {
    const tasks = await chrome.runtime.sendMessage({ type: 'tasks.read' });
    await chrome.runtime.sendMessage({ type: 'tasks.update', itemId: tasks.entries[0].id, status: 'done' });
    return chrome.runtime.sendMessage({ type: 'sync.run' });
  })()`);
  await evaluate(pupil.sessionId, `(async () => {
    const preferences = (await chrome.runtime.sendMessage({ type: 'preferences.read' })).preferences;
    await chrome.storage.local.set({ schoolwarePreferences: { ...preferences, notificationsEnabled: true } });
    return chrome.runtime.sendMessage({ type: 'sync.run' });
  })()`);
  await poll(() => evaluate(pupil.sessionId, `document.querySelector('[aria-label="Hulpvragen"]')?.textContent.includes('Hulp aan jou gevraagd')`));
  const help = await evaluate(pupil.sessionId, `(async () => (await chrome.runtime.sendMessage({ type: 'tasks.read' })).entries[0])()`);
  assert.equal(help.status, 'done'); assert.equal(help.help.needed, true); assert.equal(help.helpForYou, true);
  assert.equal(await evaluate(pupil.workerSession, `syntheticNotifications.filter(entry => entry.id.startsWith('schoolware-watch-help-')).length`), 1);
  await evaluate(pupil.sessionId, `chrome.runtime.sendMessage({ type: 'sync.run' })`);
  assert.equal(await evaluate(pupil.workerSession, `syntheticNotifications.filter(entry => entry.id.startsWith('schoolware-watch-help-')).length`), 1);
  await evaluate(parent.sessionId, `(async () => {
    const tasks = await chrome.runtime.sendMessage({ type: 'tasks.read' });
    await chrome.runtime.sendMessage({ type: 'tasks.help', itemId: tasks.entries[0].id, needed: false, recipients: [] });
    return chrome.runtime.sendMessage({ type: 'sync.run' });
  })()`);
  await evaluate(pupil.sessionId, `chrome.runtime.sendMessage({ type: 'sync.run' })`);
  await poll(() => evaluate(pupil.sessionId, `!document.querySelector('[aria-label="Hulpvragen"]')`));
  assert.equal(server.size, 1);
  assert.ok([...server.values()][0].length > 0);
  console.log(`Chrome two-device encrypted planning/help smoke passed (${version.Browser}): isolated stores, real workers, live planning/packing, recipient picker, help alongside completion, targeted notification without replay, cancellation; no Schoolware or production service contacted.`);
} finally {
  if (socket?.readyState === WebSocket.OPEN) { await command('Browser.close').catch(() => {}); socket.close(); }
  for (const waiter of pending.values()) { clearTimeout(waiter.timer); waiter.reject(new Error('Synthetic browser closed')); }
  browser.kill();
}
