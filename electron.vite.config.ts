// Aus der Mottulbox übernommen (project_mega/electron.vite.config.ts), ohne deren NDI-Binding,
// dafür mit strengerer CSP im Build.
import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'

const CSP_DEV = "script-src 'self' 'unsafe-inline'"

/**
 * Inline-Skripte braucht nur der Vite-Dev-Server (React-Refresh). Im Build verbietet die CSP sie –
 * eingeschleuster Text (etwa aus Bild-Metadaten) könnte sonst als Skript laufen. Fehlt die
 * erwartete Zeile, bricht der Build ab, statt still mit der schwächeren CSP auszuliefern.
 */
function cspOhneInlineSkripte(): Plugin {
  return {
    name: 'csp-ohne-inline-skripte',
    apply: 'build',
    transformIndexHtml(html) {
      if (!html.includes(CSP_DEV)) throw new Error(`index.html: „${CSP_DEV}“ nicht gefunden`)
      return html.replace(CSP_DEV, "script-src 'self'")
    }
  }
}

// main + preload werden als CommonJS gebaut (kein "type":"module" in package.json), damit
// native Module (better-sqlite3, sharp) per require geladen werden können. Laufzeit-
// Abhängigkeiten in `dependencies` werden über externalizeDepsPlugin NICHT gebündelt, sondern
// zur Laufzeit aus node_modules geladen; alles für den Renderer baut Vite ein.
export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: { '@shared': resolve('src/shared') }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: { '@shared': resolve('src/shared') }
    }
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@shared': resolve('src/shared')
      }
    },
    plugins: [react(), cspOhneInlineSkripte()]
  }
})
