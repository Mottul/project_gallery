// Regel der Netzsperre (Schicht A, docs/PLAN.md) – rein, getestet in netzRegel.test.ts;
// angewendet von netzsperre.ts auf jede Anfrage der Standard-Sitzung.
//
// Erlaubt ist nur, was die App-Seite selbst braucht: ihre eigenen Dateien (der Ordner der
// gebauten index.html), beim Entwickeln der Vite-Server auf diesem Rechner und die eigenen
// Protokolle (thumb:, später bild:). Alles andere wird abgewiesen – Webadressen ohnehin, aber
// auch file:-Adressen außerhalb der App: Eine file://-Seite dürfte sonst jede Datei der Platte
// als <img> laden (Schicht C, Renderer ohne Dateizugriff).

import { filePathKey, type AppPages } from './windows/windowPolicy'

/** Ohne Netz und ohne Datei: Inhalte, die die Seite selbst erzeugt, und die DevTools (F12). */
const INTERN = new Set(['data:', 'blob:', 'devtools:'])

/** Ordner der gebauten Seite als Pfad-Präfix, kleingeschrieben (Windows: Laufwerk, Groß/Klein). */
function rendererDir(indexFile: string): string | null {
  const path = filePathKey(new URL(indexFile).pathname)
  return path === null ? null : path.slice(0, path.lastIndexOf('/') + 1)
}

/** Darf die Standard-Sitzung diese Adresse laden? */
export function anfrageErlaubt(
  url: string,
  pages: AppPages,
  eigeneProtokolle: readonly string[] = []
): boolean {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return false
  }
  if (INTERN.has(u.protocol)) return true
  if (eigeneProtokolle.includes(u.protocol.slice(0, -1))) return true
  if (pages.devOrigin) {
    // Vite-Server samt Hot-Reload-Verbindung (ws: auf demselben Rechner und Port)
    const dev = new URL(pages.devOrigin)
    const ws = dev.protocol === 'https:' ? 'wss:' : 'ws:'
    if (u.origin === dev.origin) return true
    if (u.protocol === ws && u.host === dev.host) return true
  }
  if (u.protocol !== 'file:' || u.host !== '') return false
  // Kein „..“-Trick: URL normalisiert den Pfad bereits; kodierte Trenner wären nach dem
  // Dekodieren wieder Pfadteile – also ablehnen statt raten.
  if (/%2f|%5c/i.test(u.pathname)) return false
  const path = filePathKey(u.pathname)
  const dir = rendererDir(pages.indexFile)
  return path !== null && dir !== null && path.startsWith(dir)
}

/**
 * Kurzform einer Adresse fürs Log: Protokoll und Rechner, nie Pfad oder Anfrage – die könnten
 * Dateinamen oder Daten enthalten (Schicht D, Log ohne Inhalte).
 */
export function kurzeAdresse(url: string): string {
  try {
    const u = new URL(url)
    return u.host ? `${u.protocol}//${u.host}` : u.protocol
  } catch {
    return '(ungültige Adresse)'
  }
}
