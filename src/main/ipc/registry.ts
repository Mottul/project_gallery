import { Channels } from '@shared/ipc-contracts'
import { logLine } from '../services/log'
import { on } from './handle'
import { registerSettingsHandlers } from './settings.handlers'

/** Größte Länge einer Log-Nachricht des Renderers (ein Stack reicht, kein Datenkanal). */
const LOG_MAX = 4000

let handlersRegistered = false

/** Registriert alle IPC-Kanäle – genau einmal. */
export function registerIpcHandlers(): void {
  if (handlersRegistered) return
  handlersRegistered = true

  registerSettingsHandlers()
  // Fehler des Renderers ins gemeinsame Debug-Log (Einweg)
  on(Channels.appLog, (_e, message) => {
    if (typeof message === 'string') logLine(message.slice(0, LOG_MAX))
  })
}
