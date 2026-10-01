import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const entry = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  base: './',
  plugins: [
    react(),
    tailwindcss(),
    {
      name: 'extension-manifest',
      generateBundle() {
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
