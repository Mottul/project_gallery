// Aus der Mottulbox übernommen (project_mega/src/renderer/src/lib/settings.ts), ohne die
// localStorage-Übernahme (die Galerie hat keine Altdaten).
//
// Einstellungen (settings.json) im Renderer: EIN gemeinsamer Stand je Fenster, der über
// onSettingsChanged mit den anderen Fenstern und dem main-Prozess abgeglichen bleibt.
// Lesen per useSettings(selector), Schreiben per updateSettings(teiländerung) – nie den
// ganzen Bereich zurückschreiben (main führt Teiländerungen feldweise zusammen).

import { create } from 'zustand'
import { mergeSettings } from '@shared/settingsMerge'
import type { AppSettings, SettingsPatch } from '@shared/types'
import { api } from './api'

const useSettingsStore = create<{ settings: AppSettings | null }>(() => ({ settings: null }))

let started = false
function start(): void {
  if (started) return
  started = true
  void api.getSettings().then((s) => {
    // eine schnellere eigene Änderung (updateSettings) nicht durch den Ladestand ersetzen
    if (!useSettingsStore.getState().settings) useSettingsStore.setState({ settings: s })
  })
  api.onSettingsChanged((s) => useSettingsStore.setState({ settings: s }))
}

/** Einen Teil der Einstellungen lesen; null, solange sie noch laden. */
export function useSettings<T>(select: (s: AppSettings) => T): T | null {
  start()
  return useSettingsStore((st) => (st.settings ? select(st.settings) : null))
}

/** Teiländerung speichern: sofort im Fenster sichtbar, main führt sie ebenso zusammen. */
export function updateSettings(patch: SettingsPatch): void {
  start()
  const cur = useSettingsStore.getState().settings
  if (cur) useSettingsStore.setState({ settings: mergeSettings(cur, patch) })
  // Antwort = maßgeblicher Stand (falls lokal noch nichts geladen war)
  void api.setSettings(patch).then((s) => useSettingsStore.setState({ settings: s }))
}
