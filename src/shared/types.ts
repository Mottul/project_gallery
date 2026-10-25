// Domain-Typen, die main, preload und renderer teilen. Rein, ohne Electron.

/** Design: folgt Windows (Standard) oder fest hell/dunkel. */
export type ThemeMode = 'system' | 'light' | 'dark'

export const THEME_MODES: readonly ThemeMode[] = ['system', 'light', 'dark']

/**
 * Einstellungen in settings.json (userData). Nur, was main braucht oder was in allen Fenstern
 * gleich sein muss; Bedien-Kleinigkeiten gehören nicht hierher.
 */
export interface AppSettings {
  theme: ThemeMode
}

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'system'
}

/** Teiländerung: nur die genannten Felder (main führt feldweise zusammen, settingsMerge.ts). */
export type SettingsPatch = Partial<AppSettings>
