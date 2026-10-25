// Aus der Mottulbox übernommen (project_mega/src/main/services/broadcast.ts, Stand 0cc14cb).
import { BrowserWindow } from 'electron'

// Sendet ein Event an ALLE offenen Fenster (z. B. geänderte Einstellungen) –
// so bleiben alle Fenster auf demselben Stand.
export function broadcast(channel: string, ...args: unknown[]): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send(channel, ...args)
  }
}

/** Wie broadcast, aber ohne das auslösende Fenster (das kennt seine Änderung schon –
 *  ein Echo würde schnelle Folgeänderungen kurz zurückspringen lassen). */
export function broadcastExcept(
  exceptId: number | null,
  channel: string,
  ...args: unknown[]
): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed() && w.webContents.id !== exceptId) w.webContents.send(channel, ...args)
  }
}
