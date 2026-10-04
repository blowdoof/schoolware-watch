import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { InfoPanel, paypalUrl } from '../src/ui/InfoPanel';

describe('local information and external donation navigation', () => {
  it('opens the owner-provided PayPal profile without a generic donation route or prefilled payment data', () => {
    const url = new URL(paypalUrl);
    expect(url.origin).toBe('https://www.paypal.biz');
    expect(url.pathname).toBe('/bumperpuntbe');
    expect(url.search).toBe('');
    const html = renderToStaticMarkup(<InfoPanel section="donate" onSectionChange={() => {}} onSettings={() => {}} />);
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('blowdoof@gmail.com');
    expect(html).toContain(`href="${paypalUrl}"`);
    expect(html).toContain('Steun Bumper.be via PayPal');
    expect(html).not.toContain('_donations');
    for (const embedded of ['<script', '<iframe', '<img', '<form']) expect(html).not.toContain(embedded);
  });

  it('preserves the complete project and shipped dependency copyrights locally', () => {
    const html = renderToStaticMarkup(<InfoPanel section="licenses" onSectionChange={() => {}} onSettings={() => {}} />);
    expect(html).toContain('Bumper.be and contributors');
    expect(html).toContain('WITHOUT WARRANTY');
    const notices = readFileSync(new URL('../THIRD-PARTY-NOTICES.txt', import.meta.url), 'utf8');
    for (const [name, licenseFile] of [['react', 'LICENSE'], ['react-dom', 'LICENSE'], ['scheduler', 'LICENSE'],
      ['idb', 'LICENSE'], ['tailwindcss', 'LICENSE'], ['vite', 'LICENSE.md']] as const) {
      const directory = new URL(`../node_modules/${name}/`, import.meta.url);
      const metadata = JSON.parse(readFileSync(new URL('package.json', directory), 'utf8')) as { version: string };
      const original = readFileSync(new URL(licenseFile, directory), 'utf8');
      const license = name === 'vite' ? original.split('# Licenses of bundled dependencies')[0]!.trim() : original.trim();
      expect(notices).toContain(`${name} ${metadata.version}`);
      expect(notices).toContain(license);
    }
  });
});
