import { withVueTs, vueTsConfigs } from '@vue/eslint-config-typescript';
import prettierConfig from 'eslint-config-prettier/flat';
import { globalIgnores } from 'eslint/config';
import pluginVue from 'eslint-plugin-vue';

const LAYERING = 'See AGENTS.md hard rule 4 (layering).';
const NO_VUE_OR_PINIA = [
  { name: 'vue', message: LAYERING },
  { name: 'pinia', message: LAYERING },
];

// zod must run in jitless mode under our CSP, so it is only imported via src/lib/zod.ts (DECISIONS.md T8).
// ESLint replaces (does not merge) rule options per file, so every no-restricted-imports block repeats this.
const ZOD_MESSAGE = "Import { z } from 'src/lib/zod' instead (DECISIONS.md T8).";
const NO_DIRECT_ZOD = { name: 'zod', message: ZOD_MESSAGE };
const NO_ZOD_SUBPATHS = { group: ['zod/*'], message: ZOD_MESSAGE };

// Only src/storage/folder.ts calls the File System Access API (AGENTS.md rule 4).
const FOLDER_ACCESS = 'Use src/storage/folder.ts (AGENTS.md rule 4).';
const NO_FOLDER_PICKER = { name: 'showDirectoryPicker', message: FOLDER_ACCESS };

export default withVueTs(
  globalIgnores([
    'dist/**',
    'release/**',
    'test-results/**',
    'playwright-report/**',
    'coverage/**',
    // The desktop build and Tauri's generated files (gitignored).
    'dist-desktop/**',
    'src-tauri/target/**',
    'src-tauri/gen/**',
    // Local agent and design tooling (gitignored); ESLint doesn't read .gitignore.
    '.claude/**',
    '.impeccable/**',
  ]),
  pluginVue.configs['flat/recommended'],
  vueTsConfigs.recommended,
  {
    name: 'describe/general',
    rules: {
      'no-console': ['error', { allow: ['warn', 'error'] }],
      // Model text must never become HTML: the CSP allows inline script (PROJECTS.md §5.5).
      'vue/no-v-html': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    name: 'describe/zod-via-lib',
    files: ['src/**/*.ts', 'src/**/*.vue'],
    ignores: ['src/lib/zod.ts'],
    rules: {
      'no-restricted-imports': ['error', { paths: [NO_DIRECT_ZOD], patterns: [NO_ZOD_SUBPATHS] }],
    },
  },
  {
    // Specs may wire layers together (e.g. a domain test feeding provider output into buildTranscriptDoc).
    name: 'describe/layering-domain',
    files: ['src/domain/**/*.ts'],
    ignores: ['src/domain/**/*.spec.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [...NO_VUE_OR_PINIA, NO_DIRECT_ZOD],
          patterns: [
            {
              group: [
                '@vue/*',
                '**/providers/**',
                '**/storage/**',
                '**/stores/**',
                '**/features/**',
                '**/ui/**',
              ],
              message: `src/domain is pure TypeScript. ${LAYERING}`,
            },
            NO_ZOD_SUBPATHS,
          ],
        },
      ],
      'no-restricted-globals': [
        'error',
        'window',
        'document',
        'navigator',
        'localStorage',
        'sessionStorage',
        'indexedDB',
        'fetch',
        'XMLHttpRequest',
        NO_FOLDER_PICKER,
      ],
    },
  },
  {
    name: 'describe/layering-providers-features-media',
    files: ['src/providers/**/*.ts', 'src/features/**/*.ts', 'src/media/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [...NO_VUE_OR_PINIA, NO_DIRECT_ZOD],
          patterns: [
            {
              group: ['@vue/*', '**/stores/**', '**/storage/**', '**/ui/**', '*.vue'],
              message: LAYERING,
            },
            NO_ZOD_SUBPATHS,
          ],
        },
      ],
    },
  },
  {
    name: 'describe/layering-stores',
    files: ['src/stores/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [NO_DIRECT_ZOD],
          patterns: [
            { group: ['**/ui/**', '*.vue'], message: `Stores don't import the UI. ${LAYERING}` },
            NO_ZOD_SUBPATHS,
          ],
        },
      ],
    },
  },
  {
    // The domain block above repeats the global, because ESLint replaces rule options per file.
    name: 'describe/folder-access',
    files: ['src/**/*.ts', 'src/**/*.vue'],
    ignores: ['src/domain/**', 'src/storage/folder.ts', 'src/storage/folder.spec.ts'],
    rules: {
      'no-restricted-globals': ['error', NO_FOLDER_PICKER],
      'no-restricted-properties': [
        'error',
        { object: 'window', property: 'showDirectoryPicker', message: FOLDER_ACCESS },
        { object: 'globalThis', property: 'showDirectoryPicker', message: FOLDER_ACCESS },
      ],
    },
  },
  {
    // Node CLI scripts print their results.
    name: 'describe/node-scripts',
    files: ['scripts/**/*.mjs'],
    rules: { 'no-console': 'off' },
  },
  prettierConfig,
);
