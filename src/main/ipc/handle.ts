// IPC-Handler nur für die App-Seite: Jede Anfrage wird am Absender geprüft (Rahmen zeigt die
// App-Seite), bevor der Handler läuft. Fenster können ohnehin nicht wegnavigieren (windowGuards.ts)
// – diese Prüfung hält auch dann, wenn eine fremde Seite doch einmal in einem Rahmen landet.
// Neue Kanäle immer hierüber anmelden, nie direkt mit ipcMain (Skill ipc-kanal).

import { ipcMain, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron'
import { logLine } from '../services/log'
import { appPages } from '../services/windows/appWindows'
import { isAppPage } from '../services/windows/windowPolicy'

function vonApp(e: IpcMainEvent | IpcMainInvokeEvent, channel: string): boolean {
  const ok = isAppPage(e.senderFrame?.url, appPages)
  if (!ok) logLine('[ipc] Anfrage von fremder Seite abgewiesen:', channel)
  return ok
}

/** Anfrage mit Antwort (ipcRenderer.invoke). */
export function handle(
  channel: string,
  fn: (e: IpcMainInvokeEvent, ...args: unknown[]) => unknown
): void {
  ipcMain.handle(channel, (e, ...args) => {
    if (!vonApp(e, channel)) throw new Error('Anfrage nicht erlaubt')
    return fn(e, ...args)
  })
}

/** Nachricht ohne Antwort (ipcRenderer.send). */
export function on(channel: string, fn: (e: IpcMainEvent, ...args: unknown[]) => void): void {
  ipcMain.on(channel, (e, ...args) => {
    if (vonApp(e, channel)) fn(e, ...args)
  })
}
