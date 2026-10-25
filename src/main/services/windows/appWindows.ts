// App-Fenster mit sicheren Vorgaben (aus der Mottulbox übernommen,
// project_mega/src/main/services/windows/appWindows.ts, ohne deren Werkzeug- und Ausgabefenster).
// Für ALLE Fenster gelten außerdem die Wächter aus windowGuards.ts und die Netzsperre.
import { app, BrowserWindow, nativeTheme, type WebPreferences } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { APP_NAME } from '@shared/brand'
import { logLine } from '../log'
import { devServerUrl, type AppPages } from './windowPolicy'

const indexFile = join(__dirname, '../renderer/index.html')
const devUrl = devServerUrl(app.isPackaged, process.env['ELECTRON_RENDERER_URL'])

/** Wo die App-Seite liegt – Wächter und Netzsperre lassen nur sie zu. */
export const appPages: AppPages = {
  indexFile: pathToFileURL(indexFile).href,
  devOrigin: devUrl ? new URL(devUrl).origin : null
}

/** Grund der Seite je Design (--bg in assets/main.css) – kein heller Blitz beim Öffnen. */
export function windowBackground(): string {
  return nativeTheme.shouldUseDarkColors ? '#09090b' : '#fcfcfd'
}

/**
 * Sichere Vorgaben für jedes Fenster mit App-Seite: Sandbox, getrennter Kontext, kein Node, keine
 * Webviews; die Seite spricht nur über die typisierte API des Preloads (Schicht C). Zusätzliche
 * Optionen können diese nicht überschreiben. Ohne Rechtschreibprüfung: Sie lädt außerhalb von
 * Windows Wörterbücher aus dem Netz (Schicht A).
 */
export function secureWebPreferences(
  extra: Omit<
    WebPreferences,
    'preload' | 'sandbox' | 'contextIsolation' | 'nodeIntegration' | 'webviewTag' | 'spellcheck'
  > = {}
): WebPreferences {
  return {
    ...extra,
    preload: join(__dirname, '../preload/index.js'),
    sandbox: true,
    contextIsolation: true,
    nodeIntegration: false,
    webviewTag: false,
    spellcheck: false
  }
}

/** Pfad zu icon.png (gepackt: extraResources, Entwicklung: build/), sonst ohne Symbol. */
function appIconPath(): string | undefined {
  const candidate = app.isPackaged
    ? join(process.resourcesPath, 'icon.png')
    : join(app.getAppPath(), 'build', 'icon.png')
  return existsSync(candidate) ? candidate : undefined
}

/** Route der App-Seite laden: beim Entwickeln vom Vite-Server, sonst die gebaute index.html. */
export function loadRoute(win: BrowserWindow, hash: string): void {
  const onLoadErr = (e: unknown): void =>
    logLine('[fenster] Laden fehlgeschlagen:', e instanceof Error ? e.message : String(e))
  if (devUrl) win.loadURL(devUrl + (hash ? `#${hash}` : '')).catch(onLoadErr)
  else win.loadFile(indexFile, hash ? { hash } : undefined).catch(onLoadErr)
}

/** Hauptfenster der Galerie. */
export function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 720,
    minHeight: 480,
    show: false,
    backgroundColor: windowBackground(),
    autoHideMenuBar: true,
    title: APP_NAME,
    icon: appIconPath(),
    webPreferences: secureWebPreferences()
  })

  // Sicherheitsnetz aus der Mottulbox: In deren Linux-CI blieb das Hauptfenster zweimal über
  // 15 s unsichtbar – kommt 'ready-to-show' nicht, nach 5 s trotzdem zeigen.
  const notfalls = setTimeout(() => {
    if (!win.isDestroyed() && !win.isVisible()) win.show()
  }, 5000)
  win.once('ready-to-show', () => {
    clearTimeout(notfalls)
    win.show()
  })
  win.once('closed', () => clearTimeout(notfalls))

  // Seitenzoom per Strg+Mausrad/Pinch abschalten – die Galerie nutzt Strg+Mausrad für die
  // Kachelgröße, der Betrachter zoomt selbst.
  win.webContents.setVisualZoomLevelLimits(1, 1).catch(() => {})

  // F12 / Strg+Umschalt+I öffnet die DevTools (auch im gepackten Programm -> Diagnose)
  win.webContents.on('before-input-event', (_e, input) => {
    if (input.type !== 'keyDown') return
    if (input.key === 'F12' || (input.control && input.shift && input.key.toLowerCase() === 'i')) {
      win.webContents.toggleDevTools()
    }
  })

  loadRoute(win, '')
  return win
}
