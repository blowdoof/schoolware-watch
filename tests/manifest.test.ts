import { readFileSync, existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const manifest = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));

describe('extension security contract', () => {
  it('uses a module service worker and only bundled scripts', () => {
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.background.type).toBe('module');
    expect(manifest.content_security_policy.extension_pages).toBe("script-src 'self'; object-src 'self'");
  });

  it('only permits local settings, alarms and optional notifications/site access', () => {
    expect(manifest.permissions ?? []).toEqual(['storage', 'alarms']);
    expect(manifest.optional_permissions).toEqual(['notifications', 'scripting', 'webRequest']);
    expect(manifest.host_permissions ?? []).toEqual([]);
    expect(manifest.optional_host_permissions).toEqual(['https://schoolware_siw.ksgwl.be/*', 'https://schoolware.bumper.be/*']);
    expect(manifest.content_scripts ?? []).toEqual([]);
    expect(existsSync(new URL(`../public/${manifest.icons['128']}`, import.meta.url))).toBe(true);
  });

  it('references existing UI entry points', () => {
    for (const page of [manifest.action.default_popup, manifest.options_ui.page]) {
      expect(existsSync(new URL(`../${page}`, import.meta.url))).toBe(true);
    }
  });
});
