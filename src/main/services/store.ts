// Schlanker Settings-Store (aus der Mottulbox übernommen, project_mega/src/main/services/store.ts):
// eine JSON-Datei in userData, bewusst ohne externe Abhängigkeit. Änderungen werden feldweise
// zusammengeführt (settingsMerge.ts) und die Datei atomar ersetzt – ein Absturz mitten im
// Schreiben kostet nie alle Einstellungen. Neu: Gelesenes wird bereinigt (settingsCheck.ts).

import { app } from 'electron'
import { existsSync, readFileSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { bereinigeEinstellungen } from '@shared/settingsCheck'
import { mergeSettings } from '@shared/settingsMerge'
import { DEFAULT_SETTINGS, type AppSettings, type SettingsPatch } from '@shared/types'
import { writeFileAtomic } from './fsAtomic'
import { logLine } from './log'

let cache: AppSettings | null = null

/** origin = webContents-ID des auslösenden Fensters (null = main). */
type ChangeListener = (settings: AppSettings, origin: number | null) => void
const listeners = new Set<ChangeListener>()

/** Benachrichtigung nach jeder Änderung (z. B. an die übrigen Fenster weiterreichen). */
export function onSettingsChange(fn: ChangeListener): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

function settingsFile(): string {
  return join(app.getPath('userData'), 'settings.json')
}

export function getSettings(): AppSettings {
  if (cache) return cache
  try {
    cache = existsSync(settingsFile())
      ? bereinigeEinstellungen(JSON.parse(readFileSync(settingsFile(), 'utf-8')))
      : { ...DEFAULT_SETTINGS }
  } catch (err) {
    // Defekte Datei NICHT kommentarlos beim nächsten Schreiben überschreiben ->
    // wegsichern (wiederherstellbar) und mit Standardwerten weitermachen.
    try {
      const f = settingsFile()
      if (existsSync(f)) renameSync(f, `${f}.corrupt-${Date.now()}`)
      logLine(
        '[settings] settings.json defekt – gesichert, nutze Standardwerte:',
        err instanceof Error ? err.message : String(err)
      )
    } catch (e2) {
      logLine('[settings] Sichern der defekten settings.json fehlgeschlagen:', String(e2))
    }
    cache = { ...DEFAULT_SETTINGS }
  }
  return cache
}

/** Teiländerung übernehmen (vorher geprüft, settingsCheck.ts) und atomar speichern. */
export function setSettings(patch: SettingsPatch, origin: number | null = null): AppSettings {
  const next = mergeSettings(getSettings(), patch)
  cache = next
  try {
    writeFileAtomic(settingsFile(), JSON.stringify(next, null, 2))
  } catch (err) {
    // nicht kritisch – die Einstellungen bleiben zumindest im Speicher
    logLine(
      '[settings] Speichern fehlgeschlagen:',
      err instanceof Error ? err.message : String(err)
    )
  }
  for (const fn of listeners) fn(next, origin)
  return next
}
