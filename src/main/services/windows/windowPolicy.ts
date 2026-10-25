// Regeln der Fenster-Wächter – rein (ohne Electron), getestet in windowPolicy.test.ts.
// Aus der Mottulbox übernommen (project_mega/src/main/services/windows/windowPolicy.ts), für die
// Galerie enger: keine Mikrofon-Ausnahme, keine Audio-Ausgabewahl.

/** Wo die App-Seite liegt: gebaute index.html (file://) bzw. im Entwickeln der Vite-Server. */
export interface AppPages {
  /** file://-Adresse der gebauten index.html */
  indexFile: string
  /** Ursprung des Vite-Servers (http://localhost:5173), sonst null */
  devOrigin: string | null
}

/**
 * Adresse des Vite-Servers – nur beim Entwickeln und nur auf diesem Rechner. Die fertige App
 * folgt `ELECTRON_RENDERER_URL` nie: Sonst lüde sie mit gesetzter Umgebungsvariable eine fremde
 * Seite und gäbe ihr die App-API (Preload).
 */
export function devServerUrl(isPackaged: boolean, env: string | undefined): string | null {
  if (isPackaged || !env) return null
  try {
    const u = new URL(env)
    const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '[::1]'
    return (u.protocol === 'http:' || u.protocol === 'https:') && local ? env : null
  } catch {
    return null
  }
}

/**
 * Pfad einer file:-Adresse zum Vergleichen: dekodiert und kleingeschrieben (Laufwerksbuchstabe
 * und Groß-/Kleinschreibung können je nach Quelle abweichen). null bei kaputter %-Kodierung –
 * decodeURIComponent wirft dann, und ein Wächter, der wirft, verhindert nichts (in der Mottulbox
 * ging so die Navigation zu `file:///C:/x%E0.html` durch).
 */
export function filePathKey(pathname: string): string | null {
  try {
    return decodeURIComponent(pathname).toLowerCase()
  } catch {
    return null
  }
}

/** Gehört die Adresse zur App-Seite (beliebige Route im Hash)? */
export function isAppPage(url: string | undefined, pages: AppPages): boolean {
  if (!url) return false
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return false
  }
  if (pages.devOrigin) return u.origin === pages.devOrigin
  if (u.protocol !== 'file:') return false
  const path = filePathKey(u.pathname)
  return path !== null && path === filePathKey(new URL(pages.indexFile).pathname)
}

/**
 * Browser-Berechtigungen: Die Galerie braucht fast keine. Erlaubt nur für die App-Seite selbst:
 * Vollbild (Betrachter, Videos) und Text in die Zwischenablage. Kamera, Mikrofon, Standort,
 * Benachrichtigungen, MIDI, USB, Bildschirmaufnahme … nie – auch nicht als Abfrage, sonst sähe
 * eine Seite etwa die Namen aller Geräte.
 */
const ERLAUBT = new Set(['fullscreen', 'clipboard-sanitized-write'])

export function permissionAllowed(permission: string, fromApp: boolean): boolean {
  return fromApp && ERLAUBT.has(permission)
}
