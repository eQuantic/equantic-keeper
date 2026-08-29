import { copyFileSync, createReadStream, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
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

/**
 * pdf.js decodes JBIG2/CCITT and JPEG2000 images — the compressions scanners
 * actually produce — in WebAssembly that it fetches at runtime, defaulting to a
 * CDN. This app's CSP allows `connect-src 'self'` only, so those files have to
 * come from our own origin: serve them in dev and copy them into the build.
 *
 * Copied from node_modules rather than committed under `public/`, so the binary
 * and the installed library can never drift apart. The licence files travel
 * with them, as their licences require.
 *
 * `quickjs-eval.wasm` is deliberately left out: it exists to run JavaScript
 * embedded in a PDF, which this viewer never enables.
 */
const WASM_DIR = 'pdfjs-wasm';

function servePdfWasm(): Plugin {
  const require = createRequire(import.meta.url);
  const source = resolve(dirname(require.resolve('pdfjs-dist/package.json')), 'wasm');
  const wanted = () => readdirSync(source).filter((name) => !name.startsWith('quickjs-eval'));
  let outDir = 'dist';
  // Vitest resolves the config too, with a placeholder outDir. Copying there
  // would litter the repo on every `npm test`, so the copy only runs on a real
  // build — `apply: 'build'` is not an option, the dev server needs this plugin.
  let building = false;

  return {
    name: 'keeper:pdfjs-wasm',
    configResolved(config) {
      building = config.command === 'build';
      outDir = resolve(config.root, config.build.outDir);
    },
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const match = request.url?.match(new RegExp(`/${WASM_DIR}/([\\w.-]+)$`));
        if (!match || !wanted().includes(match[1]!)) return next();
        response.setHeader('Content-Type', match[1]!.endsWith('.wasm') ? 'application/wasm' : 'text/javascript');
        createReadStream(resolve(source, match[1]!)).pipe(response);
      });
    },
    closeBundle() {
      if (!building) return;
      const target = resolve(outDir, WASM_DIR);
      mkdirSync(target, { recursive: true });
      for (const name of wanted()) copyFileSync(resolve(source, name), resolve(target, name));
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
    servePdfWasm(),
    VitePWA({
      registerType: 'autoUpdate',
      // A separate file instead of an inline snippet, so the CSP can stay
      // free of 'unsafe-inline' for scripts.
      injectRegister: 'script-defer',
      includeAssets: ['favicon.svg', 'icons/apple-touch-icon.png'],
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
        // The PDF viewer is ~1.8 MB of library, worker and WebAssembly. Making
        // every install pay for it up front would punish the majority of
        // sessions, which never open a scan; leaving it uncached would break
        // offline viewing for the ones that do. So it is cached at runtime:
        // fetched once, on the first document opened, and available offline
        // from then on.
        globIgnores: [`${WASM_DIR}/**`, 'assets/AttachmentViewer-*.js', 'assets/pdf.worker*'],
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            urlPattern: ({ url, sameOrigin }) =>
              !!sameOrigin &&
              (url.pathname.includes(`/${WASM_DIR}/`) ||
                /\/assets\/(AttachmentViewer-|pdf\.worker)/.test(url.pathname)),
            handler: 'CacheFirst',
            options: {
              cacheName: 'keeper-pdf-viewer',
              expiration: { maxEntries: 12 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
