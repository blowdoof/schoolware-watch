import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { defineConfig, build } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const entry = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  base: './',
  plugins: [
    react(),
    tailwindcss(),
    {
      name: 'website-alert-script',
      async generateBundle() {
        this.addWatchFile(entry('./src/content/website-alert.ts'));
        this.addWatchFile(entry('./src/shared/browser-alerts.ts'));
        // Chrome content scripts are classic scripts, so bundle one standalone
        // IIFE rather than sharing ES module imports with extension pages.
        const result = await build({ configFile: false, logLevel: 'warn', build: { write: false,
          lib: { entry: entry('./src/content/website-alert.ts'), name: 'SchoolwareWatchAlerts', formats: ['iife'] } } });
        const bundles = Array.isArray(result) ? result : 'output' in result ? [result] : [];
        const script = bundles.flatMap((bundle) => bundle.output).find((output) => output.type === 'chunk');
        if (!script || script.type !== 'chunk') throw new Error('Missing content script');
        this.emitFile({ type: 'asset', fileName: 'website-alert.js', source: script.code });
      },
    },
    {
      name: 'extension-manifest',
      generateBundle() {
        for (const [path, fileName] of [['./LICENSE', 'LICENSE.txt'], ['./THIRD-PARTY-NOTICES.txt', 'THIRD-PARTY-NOTICES.txt']] as const) {
          this.emitFile({ type: 'asset', fileName, source: readFileSync(entry(path), 'utf8') });
        }
        this.emitFile({
          type: 'asset',
          fileName: 'manifest.json',
          source: readFileSync(entry('./manifest.json'), 'utf8'),
        });
      },
    },
  ],
  build: {
    rollupOptions: {
      input: {
        popup: entry('./popup.html'),
        dashboard: entry('./dashboard.html'),
        options: entry('./options.html'),
        background: entry('./src/background/service-worker.ts'),
      },
      output: {
        entryFileNames: (chunk) => chunk.name === 'background'
          ? 'background.js' : 'assets/[name]-[hash].js',
      },
    },
  },
});
