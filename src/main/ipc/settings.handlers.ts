import { nativeTheme } from 'electron'
import { Channels } from '@shared/ipc-contracts'
import { pruefeAenderung } from '@shared/settingsCheck'
import type { AppSettings } from '@shared/types'
import { broadcastExcept } from '../services/broadcast'
import { getSettings, onSettingsChange, setSettings } from '../services/store'
import { handle } from './handle'

/**
 * Design an Electron weitergeben: Titelleiste und native Dialoge folgen damit, und
 * `prefers-color-scheme` der Seite meldet bei „System“ die Windows-Einstellung.
 */
function applyTheme(s: AppSettings): void {
  nativeTheme.themeSource = s.theme
}

export function registerSettingsHandlers(): void {
  applyTheme(getSettings())
  handle(Channels.settingsGet, () => getSettings())
  // Teiländerung vom Renderer ist fremde Eingabe: prüfen, Ungültiges ablehnen
  handle(Channels.settingsSet, (e, patch) => setSettings(pruefeAenderung(patch), e.sender.id))
  // Änderungen an alle übrigen Fenster melden; das auslösende kennt sie schon
  onSettingsChange((s, origin) => {
    applyTheme(s)
    broadcastExcept(origin, Channels.settingsChanged, s)
  })
}
