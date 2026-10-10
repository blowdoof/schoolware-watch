// Synthetic protocol compatibility check using the actual 0.1.0 crypto code.
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { webcrypto as crypto } from 'node:crypto';
import process from 'node:process';
import { log } from 'node:console';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import ts from 'typescript';

const root = fileURLToPath(new URL('../../', import.meta.url));
const baseline = 'fe1f32e';
const source = (path, legacy) => legacy
  ? execFileSync('git', ['show', `${baseline}:${path}`], { cwd: root, encoding: 'utf8' })
  : readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const declaration = (path, name, legacy) => {
  const text = source(path, legacy);
  const parsed = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
  const node = parsed.statements.find((statement) => statement.name?.text === name ||
    statement.declarationList?.declarations.some((entry) => entry.name.text === name));
  assert.ok(node, `Missing ${name}`);
  return node.getText(parsed);
};
async function codec(legacy) {
  const cryptoSource = source('src/domain/progress-sync.ts', legacy).replace(/^import .*;\r?\n/gm, '');
  const helpers = declaration('src/shared/progress-sync.ts', 'isSecret', legacy) + '\n' +
    declaration('src/shared/progress-sync.ts', 'parsePairingCode', legacy) + '\n' +
    declaration('src/shared/progress-sync.ts', 'isRemoteProgress', legacy) + '\n' +
    declaration('src/domain/tasks.ts', 'TASK_STATUSES', legacy) + '\n' +
    declaration('src/domain/tasks.ts', 'isTaskStatus', legacy) + '\n' +
    (legacy ? '' : source('src/domain/agenda-normalization.ts', false));
  const output = ts.transpileModule(helpers + '\n' + cryptoSource, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}`);
}
const [url, token] = process.argv.slice(2);
assert.equal(new URL(url).hostname, '127.0.0.1', 'Local disposable API only');
const key = 'b'.repeat(64);
const old = await codec(true);
const current = await codec(false);
assert.deepEqual(old.parsePairingCode(`sw1.${token}.${key}`), current.parsePairingCode(`sw1.${token}.${key}`));
assert.equal(await old.progressItemKey(key, 'synthetic-source'), await current.progressItemKey(key, 'synthetic-source'));
async function call(body) {
  const response = await globalThis.fetch(url, { method: 'POST', headers: {
    'Content-Type': 'application/json', Authorization: `Bearer ${token}`,
    'X-Schoolware-Version': '0.3.0', 'X-Schoolware-Protocol': '2',
  }, body: JSON.stringify(body) });
  assert.equal(response.status, 200);
  return response.json();
}
const before = await call({ action: 'exchange', cursor: 0, operations: [] });
let cursor = before.head;
for (const [writer, reader] of [[old, current], [current, old], [old, old]]) {
  const id = crypto.randomUUID();
  const value = { item: 'a'.repeat(64), version: 'c'.repeat(64), status: 'done', kind: 'manual' };
  const operation = { id, ...await writer.encryptProgress(key, id, value) };
  const result = await call({ action: 'exchange', cursor, operations: [operation] });
  assert.deepEqual(result.acknowledged, [id]);
  assert.equal(result.head, cursor + 1);
  const remote = result.operations[0];
  assert.equal(remote.id, id);
  const decrypted = await reader.decryptProgress(key, id, remote.iv, remote.ciphertext);
  assert.deepEqual(decrypted, value);
  assert.ok(reader.isRemoteProgress(decrypted));
  const retry = await call({ action: 'exchange', cursor, operations: [operation] });
  assert.equal(retry.head, result.head);
  assert.equal(retry.operations[0].ciphertext, remote.ciphertext);
  cursor = result.cursor;
}
const devices = [];
for (const writer of [old, current]) {
  const id = crypto.randomUUID();
  const device = { id, ...await writer.encryptProgress(key, `member:${id}`, { label: 'Synthetic participant' }) };
  devices.push(device);
  const result = await call({ action: 'members', device });
  for (const member of result.members) {
    for (const reader of [old, current]) {
      assert.deepEqual(await reader.decryptProgress(key, `member:${member.id}`, member.iv, member.ciphertext),
        { label: 'Synthetic participant' });
    }
  }
}
for (const device of devices) await call({ action: 'member.leave', id: device.id });
await call({ action: 'delete' });
assert.equal((await call({ action: 'exchange', cursor, operations: [] })).head, cursor);
log(`0.1.0 (${baseline}) / current compatibility passed: pairing, item keys, bidirectional encrypted progress, retry, participants, leave and deletion with cursor preservation.`);
