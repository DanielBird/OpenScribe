import { readFileSync } from 'node:fs';
import vue from '@vitejs/plugin-vue';
import type { Plugin } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { defineConfig } from 'vitest/config';

/**
 * The only hosts the app may contact (AGENTS.md rule 2). Adding one also means updating
 * scripts/verify-single-file.mjs (which checks the lists agree), connect-src in src-tauri/tauri.conf.json,
 * docs/DECISIONS.md and the About panel.
 */
const API_HOSTS = [
  'https://api.elevenlabs.io',
  'https://api.anthropic.com',
  'https://generativelanguage.googleapis.com',
];

/** DECISIONS.md T1. `'unsafe-inline'` is unavoidable for a single inlined file; never add `'unsafe-eval'`. */
const CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  'img-src data: blob:',
  'media-src blob:',
  'font-src data:',
  `connect-src ${API_HOSTS.join(' ')}`,
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

/** Injects the CSP meta as the first child of <head>. Build only: the dev server needs HMR and inline modules. */
function cspPlugin(): Plugin {
  return {
    name: 'describe-csp',
    apply: 'build',
    transformIndexHtml() {
      return [
        {
          tag: 'meta',
          attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP },
          injectTo: 'head-prepend',
        },
      ];
    },
  };
}

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version: string;
};

export default defineConfig(({ mode }) => {
  const desktop = mode === 'desktop';
  return {
    base: './',
    clearScreen: false,
    plugins: desktop ? [vue()] : [vue(), viteSingleFile(), cspPlugin()],
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version),
      __BUILD_DATE__: JSON.stringify(new Date().toISOString().slice(0, 10)),
      __DESKTOP__: JSON.stringify(desktop),
    },
    server: {
      port: 5173,
      strictPort: true,
      watch: { ignored: ['**/src-tauri/**'] },
    },
    build: {
      target: 'es2022',
      outDir: desktop ? 'dist-desktop' : 'dist',
      cssCodeSplit: false,
      assetsInlineLimit: 100_000_000,
      chunkSizeWarningLimit: 5000,
    },
    test: {
      environment: 'happy-dom',
      include: ['src/**/*.spec.ts'],
      // Vitest blanks CSS by default; tokens.spec.ts reads the real tokens file.
      css: { include: [/tokens\.css/] },
    },
  };
});
