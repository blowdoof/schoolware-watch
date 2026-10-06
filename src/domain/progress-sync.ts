import type { Snapshot } from './observations';
import { isSecret } from '../shared/progress-sync';
import { normalizeAgendaText } from './agenda-normalization';

export const hex = (bytes: ArrayBuffer | Uint8Array): string => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
export function unhex(value: string): Uint8Array<ArrayBuffer> {
  if (!/^(?:[a-f0-9]{2})+$/.test(value)) throw new Error('Invalid encoding');
  return Uint8Array.from(value.match(/../g)!.map((pair) => parseInt(pair, 16)));
}
const encode = (value: string) => new TextEncoder().encode(value);
export function progressVersionText(snapshot: Snapshot): string {
  // Completion is bound to meaningful content; GeldigVan alone does not reopen.
  return JSON.stringify([normalizeAgendaText(snapshot.title), normalizeAgendaText(snapshot.instructions), snapshot.typePunt, snapshot.startsAt,
    snapshot.endsAt, snapshot.hidden, snapshot.cancelled, snapshot.recurrence]);
}
export async function progressVersion(snapshot: Snapshot): Promise<string> {
  return hex(await crypto.subtle.digest('SHA-256', encode(progressVersionText(snapshot))));
}
export async function progressItemKey(key: string, sourceKey: string, origin = 'https://schoolware_siw.ksgwl.be'): Promise<string> {
  if (!isSecret(key)) throw new Error('Invalid key');
  const cryptoKey = await crypto.subtle.importKey('raw', unhex(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', cryptoKey, encode(JSON.stringify(['schoolware-progress-v1',
    origin, sourceKey]))));
}
export async function encryptProgress(key: string, id: string, value: unknown): Promise<{ iv: string; ciphertext: string }> {
  if (!isSecret(key)) throw new Error('Invalid key');
  const cryptoKey = await crypto.subtle.importKey('raw', unhex(key), 'AES-GCM', false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = encode(JSON.stringify(value));
  if (plaintext.length > 512) throw new Error('Progress payload too large');
  // JSON whitespace padding remains readable by existing sw1 clients.
  const padded = new Uint8Array(512).fill(32);
  padded.set(plaintext);
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: encode(`sw1:${id}`) }, cryptoKey, padded);
  return { iv: hex(iv), ciphertext: hex(ciphertext) };
}
export async function decryptProgress(key: string, id: string, iv: string, ciphertext: string): Promise<unknown> {
  const cryptoKey = await crypto.subtle.importKey('raw', unhex(key), 'AES-GCM', false, ['decrypt']);
  const bytes = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unhex(iv), additionalData: encode(`sw1:${id}`) }, cryptoKey, unhex(ciphertext));
  return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
}
