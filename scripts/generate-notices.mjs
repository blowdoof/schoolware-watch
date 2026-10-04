import { readFileSync, writeFileSync } from 'node:fs';
import { URL } from 'node:url';

const root = new URL('../', import.meta.url);
const components = [
  ['react', 'LICENSE'],
  ['react-dom', 'LICENSE'],
  ['scheduler', 'LICENSE'],
  ['idb', 'LICENSE'],
  ['tailwindcss', 'LICENSE'],
  ['vite', 'LICENSE.md'],
];
const heading = `Third-party notices for Schoolware Watch

Generated from the installed packages by npm run licenses.
React, React DOM, scheduler and idb provide runtime functionality.
Tailwind CSS provides generated styles. The Vite core license covers its
module-preload helper. Build-only dependencies are not part of this notice set.
Each component retains its own license and copyright holders.
`;
const notices = components.map(([name, licenseFile]) => {
  const directory = new URL(`node_modules/${name}/`, root);
  const metadata = JSON.parse(readFileSync(new URL('package.json', directory), 'utf8'));
  const original = readFileSync(new URL(licenseFile, directory), 'utf8');
  const license = name === 'vite' ? original.split('# Licenses of bundled dependencies')[0] : original;
  return `\n${'='.repeat(72)}\n${name} ${metadata.version}\n${'='.repeat(72)}\n\n${license.trim()}\n`;
});
writeFileSync(new URL('THIRD-PARTY-NOTICES.txt', root), heading + notices.join(''));
