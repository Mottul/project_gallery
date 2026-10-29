// Lebenszyklus der App. Reihenfolge beim Start: eigene Protokolle anmelden (vor ready), dann
// Netzsperre und Wächter vor dem ersten Fenster, dann IPC, dann das Hauptfenster.
import { app, BrowserWindow } from 'electron'
import { registerIpcHandlers } from './ipc/registry'
import { beiFokus, bibliothekBeenden, bibliothekStarten } from './services/library/library'
import { logLine } from './services/log'
import { installNetzsperre } from './services/netzsperre'
import { bildProtokollBedienen } from './services/protocols/bild'
import { EIGENE_PROTOKOLLE, eigeneSchemataAnmelden } from './services/protocols/schemata'
import { thumbProtokollBedienen } from './services/protocols/thumb'
import { appPages, createMainWindow } from './services/windows/appWindows'
import { installWindowGuards } from './services/windows/windowGuards'

// Globale Auffanglinien: unbehandelte Fehler landen im Debug-Log (im gepackten Programm sonst
// unsichtbar), statt die App still zu destabilisieren.
process.on('unhandledRejection', (reason) => {
  logLine(
    '[unhandledRejection]',
    reason instanceof Error ? (reason.stack ?? reason.message) : reason
  )
})
process.on('uncaughtException', (err) => {
  logLine('[uncaughtException]', err.stack ?? err.message)
})

// Eigene Protokolle müssen vor `ready` angemeldet sein (Netzsperre und CSP kennen sie auch)
eigeneSchemataAnmelden()

// Nur eine Galerie je Benutzerprofil: Index und Cache haben genau einen Schreiber. Ein zweiter
// Start holt das vorhandene Fenster nach vorn.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  let mainWin: BrowserWindow | null = null

  const openMainWindow = (): void => {
    const win = createMainWindow()
    mainWin = win
    win.on('closed', () => {
      if (mainWin === win) mainWin = null
    })
  }

  app.on('second-instance', () => {
    if (!mainWin) return
    if (mainWin.isMinimized()) mainWin.restore()
    mainWin.focus()
  })

  app.whenReady().then(() => {
    logLine('--- Start ---', `version=${app.getVersion()}`, `packaged=${app.isPackaged}`)
    installNetzsperre(appPages, EIGENE_PROTOKOLLE)
    thumbProtokollBedienen()
    bildProtokollBedienen()
    installWindowGuards()
    registerIpcHandlers()
    openMainWindow()
    // Index öffnen und alle Ordner im Hintergrund abgleichen (Bilddienst), nach dem Fenster
    try {
      bibliothekStarten()
    } catch (err) {
      logLine(
        '[bibliothek] Start fehlgeschlagen:',
        err instanceof Error ? err.message : String(err)
      )
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) openMainWindow()
    })
    // zurück in der App: nicht erreichbare und periodisch abgeglichene Ordner prüfen (1.6)
    app.on('browser-window-focus', () => beiFokus())

    // Diagnose: Stand die Ereignisschleife des main (dann hängen Fenster und IPC)? Nur die Dauer
    // ins Log – gesehen bei der Abnahme mit 50.000 Bildern (1.6)
    let faellig = Date.now() + 100
    setInterval(() => {
      const verspaetet = Date.now() - faellig
      if (verspaetet > 250) logLine(`[main] Ereignisschleife ${verspaetet} ms blockiert`)
      faellig = Date.now() + 100
    }, 100).unref()
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  // Laufende Scans abbrechen, Bilddienst beenden, Index sauber schließen (WAL zurückschreiben)
  app.on('will-quit', () => bibliothekBeenden())
}
