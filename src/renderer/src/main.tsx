import React from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { applyTheme, storedThemeMode } from './lib/theme'
import './assets/main.css'

// Gespeichertes Design SYNCHRON vor dem ersten Rendern setzen -> kein Flackern.
// (settings.json bleibt die Quelle der Wahrheit; useAppearanceSync gleicht danach ab.)
applyTheme(storedThemeMode())

const container = document.getElementById('root')
if (!container) throw new Error('#root nicht gefunden')

// Unbehandelte Fehler ins Debug-Log des main spiegeln (Diagnose ohne offene DevTools).
// Best effort – darf selbst nie werfen.
function toMainLog(prefix: string, value: unknown): void {
  try {
    const msg = value instanceof Error ? `${value.message}\n${value.stack ?? ''}` : String(value)
    window.api?.log?.(`[renderer] ${prefix}: ${msg}`)
  } catch {
    /* ignore */
  }
}
window.addEventListener('error', (e) => toMainLog('error', e.error ?? e.message))
window.addEventListener('unhandledrejection', (e) => toMainLog('unhandledrejection', e.reason))

// Fehlt die Preload-Brücke, kann nichts arbeiten -> klare Meldung statt weißem Fenster.
if (!window.api) {
  container.innerHTML =
    '<div style="height:100%;display:flex;align-items:center;justify-content:center;' +
    'font-family:system-ui;text-align:center;padding:2rem">' +
    '<div><h1 style="font-size:1.1rem;margin:0 0 .5rem">Programmbrücke nicht geladen</h1>' +
    '<p style="opacity:.7;font-size:.9rem;margin:0">Bitte die App neu starten.</p></div></div>'
} else {
  createRoot(container).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  )
}
