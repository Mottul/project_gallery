// ESLint-Flat-Config: TypeScript (main/preload/renderer/shared) + React-Hooks. Aus der Mottulbox
// übernommen (project_mega/eslint.config.mjs), ergänzt um die Netz-Sperre im main (Schicht A).
// Bewusst OHNE type-aware Linting (schnell, kein tsconfig-Projekt nötig) und mit
// eslint-config-prettier am Ende, damit Formatfragen allein Prettier gehören.
// Gelintet wird der Quellcode; Build-Skripte, E2E, Skills und JS-Configs bleiben außen vor.

import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import prettier from 'eslint-config-prettier'

/** Im main nie synchron auf einen Prozess warten: Fenster und IPC stünden so lange still. */
const blockierendeProzesse = ['node:child_process', 'child_process'].map((name) => ({
  name,
  importNames: ['spawnSync', 'execSync', 'execFileSync'],
  message: 'Blockiert den main-Prozess – asynchron starten.'
}))

/**
 * Schicht A („Nichts verlässt den Rechner“, docs/PLAN.md): Der main öffnet von sich aus keine
 * Verbindung. Einzige Ausnahme ist services/update/ (App-Aktualisierung, nur nach Zustimmung) –
 * die Sperre nie lockern, auch nicht „nur zum Testen“ (Skill bildschutz).
 */
const NETZ = 'Kein Netz im main (Schicht A, Skill bildschutz) – einzige Ausnahme: services/update/.'
const netzModule = ['http', 'https', 'http2', 'net', 'tls', 'dgram', 'dns'].flatMap((m) => [
  { name: m, message: NETZ },
  { name: `node:${m}`, message: NETZ }
])
const netzGlobale = ['fetch', 'WebSocket', 'EventSource', 'XMLHttpRequest'].map((name) => ({
  name,
  message: NETZ
}))

export default tseslint.config(
  {
    ignores: [
      'out/**',
      'dist/**',
      'node_modules/**',
      'build/**',
      'resources/**',
      'scripts/**',
      '.claude/**',
      'e2e/**',
      '*.config.js',
      '*.config.mjs'
    ]
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      // Ungenutztes ist ein Fehler; per _-Präfix bewusst ignorierbar.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }
      ]
    }
  },
  {
    // Tests dürfen beides (z. B. lokale Spion-Server, synchrone Hilfsprogramme).
    files: ['src/main/**/*.ts'],
    ignores: ['**/*.test.ts', 'src/main/services/update/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            ...blockierendeProzesse,
            ...netzModule,
            { name: 'electron', importNames: ['net', 'netLog'], message: NETZ }
          ]
        }
      ],
      'no-restricted-globals': ['error', ...netzGlobale]
    }
  },
  {
    // Die App-Aktualisierung darf ins Netz – aber auch dort nie blockierend auf Prozesse warten.
    files: ['src/main/services/update/**/*.ts'],
    ignores: ['**/*.test.ts'],
    rules: {
      'no-restricted-imports': ['error', { paths: blockierendeProzesse }]
    }
  },
  prettier
)
