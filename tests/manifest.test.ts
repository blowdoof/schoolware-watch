import { readFileSync, existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const manifest = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));

describe('extension security contract', () => {
  it('uses a module service worker and only bundled scripts', () => {
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.background.type).toBe('module');
    expect(manifest.content_security_policy.extension_pages).toBe("script-src 'self'; object-src 'self'");
  });

  it('only permits local settings and optional access to the verified installation', () => {
    expect(manifest.permissions ?? []).toEqual(['storage']);
    expect(manifest.host_permissions ?? []).toEqual([]);
    expect(manifest.optional_host_permissions).toEqual(['https://schoolware_siw.ksgwl.be/*']);
    expect(manifest.content_scripts ?? []).toEqual([]);
  });

  it('references existing UI entry points', () => {
    for (const page of [manifest.action.default_popup, manifest.options_ui.page]) {
      expect(existsSync(new URL(`../${page}`, import.meta.url))).toBe(true);
    }
  });
});
