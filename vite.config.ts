import { copyFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';
import type { Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

/**
 * GitHub writes the custom domain into a CNAME file at the repository root when
 * you set it under Settings > Pages. The Actions deployment publishes only the
 * build output, so copy that file into it — the settings-managed file stays the
 * single source of truth instead of being duplicated under public/, where it
 * would silently go stale if the domain ever changed.
 */
function copyCustomDomain(): Plugin {
  let root = process.cwd();
  let outDir = 'dist';
  return {
    name: 'keeper:copy-cname',
    apply: 'build',
    configResolved(config) {
      root = config.root;
      outDir = config.build.outDir;
    },
    closeBundle() {
      const source = resolve(root, 'CNAME');
      if (existsSync(source)) copyFileSync(source, resolve(root, outDir, 'CNAME'));
    },
  };
}

// `VITE_BASE` is provided by the GitHub Pages workflow (`/equantic-keeper/` for a
// project page, `/` for a custom domain). Local dev serves from the root.
const rawBase = process.env.VITE_BASE || '/';
const base = rawBase.endsWith('/') ? rawBase : `${rawBase}/`;

export default defineConfig({
  base,
  build: {
    target: 'es2022',
    sourcemap: false,
  },
  plugins: [
    react(),
    tailwindcss(),
    copyCustomDomain(),
    VitePWA({
      registerType: 'autoUpdate',
      // A separate file instead of an inline snippet, so the CSP can stay
      // free of 'unsafe-inline' for scripts.
      injectRegister: 'script-defer',
      includeAssets: ['favicon.svg', 'icons/icon-192.png', 'icons/icon-512.png'],
      manifest: {
        name: 'eQuantic Keeper',
        short_name: 'Keeper',
        description:
          'Cofre de segredos para desenvolvedores. Criptografia ponta a ponta no navegador, sincronizado no seu Google Drive.',
        theme_color: '#0b0f17',
        background_color: '#0b0f17',
        display: 'standalone',
        orientation: 'portrait-primary',
        start_url: '.',
        scope: '.',
        categories: ['productivity', 'utilities', 'developer'],
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Only the app shell is precached. Google APIs are never cached: secrets
        // must not linger in the Cache Storage of the browser.
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'],
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
        runtimeCaching: [],
      },
      devOptions: { enabled: false },
    }),
  ],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
