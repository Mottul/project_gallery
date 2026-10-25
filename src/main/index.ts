// Lebenszyklus der App. Reihenfolge beim Start: Netzsperre und Wächter vor dem ersten Fenster,
// dann IPC, dann das Hauptfenster.
import { app, BrowserWindow } from 'electron'
import { registerIpcHandlers } from './ipc/registry'
import { logLine } from './services/log'
import { installNetzsperre } from './services/netzsperre'
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
    installNetzsperre(appPages)
    installWindowGuards()
    registerIpcHandlers()
    openMainWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) openMainWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
