import { resolve } from 'path'
import { defineConfig } from 'vitest/config'

// Unit-Tests für die reinen Logik-Module (kein Electron, kein DOM). Alias-Auflösung spiegelt
// electron.vite.config.ts, damit Tests dieselben @shared/@renderer-Importe nutzen wie die App.
// (Aus der Mottulbox übernommen.)
export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve('src/shared'),
      '@renderer': resolve('src/renderer/src')
    }
  },
  test: {
    environment: 'node',
    include: ['src/**/*.{test,spec}.{ts,tsx}', 'scripts/**/*.test.mjs']
  }
})
