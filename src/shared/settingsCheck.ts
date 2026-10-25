// Einstellungen prüfen – rein, getestet in settingsCheck.test.ts.
//
// Zwei Wege, auf denen fremde Werte hereinkommen: eine Teiländerung über IPC (auch der eigene
// Renderer gilt als fremde Eingabe, Skill ipc-kanal) und eine settings.json, die von Hand oder
// von einer älteren/neueren Version geändert wurde. Eine ungültige Teiländerung wird abgelehnt
// (Fehler, nie still „korrigiert“); eine gelesene Datei wird bereinigt – Unbekanntes fällt weg,
// ungültige Werte bekommen ihre Vorgabe, damit die App immer startet.

import { DEFAULT_SETTINGS, THEME_MODES, type AppSettings, type SettingsPatch } from './types'

type Pruefer = { [K in keyof AppSettings]: (v: unknown) => v is AppSettings[K] }

const PRUEFER: Pruefer = {
  theme: (v): v is AppSettings['theme'] =>
    typeof v === 'string' && (THEME_MODES as readonly string[]).includes(v)
}

const SCHLUESSEL = Object.keys(PRUEFER) as (keyof AppSettings)[]

function istObjekt(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** Teiländerung aus dem Renderer prüfen; wirft bei unbekannten Feldern oder ungültigen Werten. */
export function pruefeAenderung(raw: unknown): SettingsPatch {
  if (!istObjekt(raw)) throw new Error('Einstellungen: Teiländerung ist kein Objekt')
  const patch: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(raw)) {
    if (value === undefined) continue
    if (!(SCHLUESSEL as string[]).includes(key)) {
      throw new Error(`Einstellungen: unbekanntes Feld „${key.slice(0, 40)}“`)
    }
    if (!PRUEFER[key as keyof AppSettings](value)) {
      throw new Error(`Einstellungen: ungültiger Wert für „${key}“`)
    }
    patch[key] = value
  }
  return patch as SettingsPatch
}

/** Gelesene Einstellungen bereinigen: nur bekannte Felder, ungültige Werte -> Vorgabe. */
export function bereinigeEinstellungen(raw: unknown): AppSettings {
  const src = istObjekt(raw) ? raw : {}
  const out = { ...DEFAULT_SETTINGS }
  for (const key of SCHLUESSEL) {
    const value = src[key]
    if (PRUEFER[key](value)) (out as Record<string, unknown>)[key] = value
  }
  return out
}
