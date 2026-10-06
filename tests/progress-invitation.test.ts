import { describe, expect, it } from 'vitest';
import { extensionInvitation, progressInvitation, STORE_URL } from '../src/shared/progress-invitation';

describe('private progress invitation', () => {
  it('keeps public installation sharing separate from group access', () => {
    const publicText = extensionInvitation();
    expect(publicText.match(/https:\/\/\S+/g)).toEqual([STORE_URL]);
    expect(publicText).not.toContain('sw1.');
    expect(publicText).not.toContain('Koppelen aan een bestaande computer');
    expect(publicText).toContain('zelfstandig gebruiken en testen');
    expect(publicText).toContain('geen toegang');
  });
  it('includes a public install URL and separate code with explicit existing-group instructions', () => {
    const code = `sw1.${'a'.repeat(64)}.${'b'.repeat(64)}`;
    const text = progressInvitation(code);
    expect(text).toContain(code);
    expect(text).toContain('Koppelen aan een bestaande computer');
    expect(text).toContain('eigen account');
    expect(text).toContain('dezelfde leerling');
    expect(text).toContain('lezen en wijzigen');
    expect(text.match(/https:\/\/\S+/g)).toEqual([STORE_URL]);
    expect(new URL(STORE_URL).search).toBe('');
    expect(new URL(STORE_URL).hash).toBe('');
  });
  it.each(['', 'sw1.invalid.invalid', 'sw1.' + 'a'.repeat(64) + '.' + 'b'.repeat(64) + '\nInjected text'])(
    'rejects malformed code %s', (code) => expect(() => progressInvitation(code)).toThrow());
});
