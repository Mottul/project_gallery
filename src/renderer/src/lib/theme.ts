// Design anwenden ohne React/IPC, damit der Einstieg (main.tsx) das gespeicherte Design SYNCHRON
// vor dem ersten Rendern setzen kann (kein Hell/Dunkel-Flackern). Mechanik aus der Mottulbox
// (project_mega/src/renderer/src/lib/theme.ts): Dunkel ohne Klasse, Hell = Klasse .light am <html>.
// Anders als dort ist „System“ der Standard (docs/PLAN.md, „Erscheinungsbild“).

import { THEME_MODES, type ThemeMode } from '@shared/types'

const STORAGE_KEY = 'galeria-theme'

/** Konkretes Design aus dem Modus ('system' -> Windows-Einstellung). */
export function resolveTheme(mode: ThemeMode): 'light' | 'dark' {
  if (mode === 'system') {
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
  }
  return mode
}

/** Design am <html> setzen (light -> Klasse .light, dark -> ohne Klasse). */
export function applyTheme(mode: ThemeMode): void {
  document.documentElement.classList.toggle('light', resolveTheme(mode) === 'light')
}

/** Schneller Boot-Spiegel des Modus (localStorage) – Quelle der Wahrheit bleibt settings.json. */
export function persistThemeMode(mode: ThemeMode): void {
  try {
    localStorage.setItem(STORAGE_KEY, mode)
  } catch {
    // localStorage nicht verfügbar -> nur für diese Sitzung
  }
}

export function storedThemeMode(): ThemeMode {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    if ((THEME_MODES as readonly (string | null)[]).includes(v)) return v as ThemeMode
  } catch {
    // ignorieren
  }
  return 'system'
}
