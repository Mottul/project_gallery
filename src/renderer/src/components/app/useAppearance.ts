// Darstellung der App (Design): Quelle der Wahrheit ist settings.json; localStorage spiegelt die
// Wahl nur für ein flackerfreies Booten (lib/theme). Muster aus der Mottulbox
// (project_mega/src/renderer/src/components/app/useAppearance.ts), bisher nur das Design.
// - useAppearanceSync hängt an der App-Wurzel jedes Fensters: So folgt es auch Änderungen aus
//   einem anderen Fenster, und „System“ folgt Windows.
// - useAppearance ist die Bedienung (lesen + ändern).
import { useEffect } from 'react'
import { updateSettings, useSettings } from '@renderer/lib/settings'
import { applyTheme, persistThemeMode, storedThemeMode } from '@renderer/lib/theme'
import type { ThemeMode } from '@shared/types'

/** Gespeicherte Darstellung anwenden und ihr folgen (auch Änderungen aus anderen Fenstern). */
export function useAppearanceSync(): void {
  const theme = useSettings((s) => s.theme)

  useEffect(() => {
    if (theme == null) return
    applyTheme(theme)
    persistThemeMode(theme)
    if (theme !== 'system') return
    // „System“: der Windows-Einstellung folgen, auch wenn sie sich ändert
    const mq = window.matchMedia('(prefers-color-scheme: light)')
    const onChange = (): void => applyTheme('system')
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [theme])
}

/** Bedienung: Design lesen und ändern (angewendet wird über useAppearanceSync). */
export function useAppearance(): { theme: ThemeMode; setTheme: (m: ThemeMode) => void } {
  // bis settings.json geladen ist, der Boot-Spiegel – so springt die Auswahl nicht
  const theme = useSettings((s) => s.theme) ?? storedThemeMode()
  return { theme, setTheme: (m) => updateSettings({ theme: m }) }
}
