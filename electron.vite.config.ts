// Aus der Mottulbox übernommen (project_mega/electron.vite.config.ts), ohne deren NDI-Binding,
// dafür mit strengerer CSP im Build.
import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
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
// Abhängigkeiten in `dependencies` werden NICHT gebündelt, sondern zur Laufzeit aus node_modules
// geladen (electron-vite 6: build.externalizeDeps, ab Werk an); alles für den Renderer baut Vite
// ein. Der main hat zwei Einstiege: die App und den Bilddienst (eigener Prozess,
// services/bilddienst/einstieg.ts → out/main/bilddienst.js).
export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/main/index.ts'),
          bilddienst: resolve('src/main/services/bilddienst/einstieg.ts')
        }
      }
    },
    resolve: {
      alias: { '@shared': resolve('src/shared') }
    }
  },
  preload: {
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
