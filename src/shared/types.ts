// Domain-Typen, die main, preload und renderer teilen. Rein, ohne Electron.

import type { DatumQuelle } from './dates'

/** Design: folgt Windows (Standard) oder fest hell/dunkel. */
export type ThemeMode = 'system' | 'light' | 'dark'

export const THEME_MODES: readonly ThemeMode[] = ['system', 'light', 'dark']

/** Arten von Datei-Dialogen, die sich ihren Ordner je für sich merken (services/fileDialogs.ts). */
export type DialogDirKind = 'ordner' | 'dateien' | 'speichern'

export const DIALOG_DIR_KINDS: readonly DialogDirKind[] = ['ordner', 'dateien', 'speichern']

/**
 * Einstellungen in settings.json (userData). Nur, was main braucht oder was in allen Fenstern
 * gleich sein muss; Bedien-Kleinigkeiten gehören nicht hierher. Bibliotheksordner stehen nicht
 * hier, sondern im Index (services/db.ts).
 */
export interface AppSettings {
  theme: ThemeMode
  /** Zuletzt benutzter Ordner je Dialog-Art (Electron startet sonst in „Downloads“) */
  dialogDirs: Partial<Record<DialogDirKind, string>>
}

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'system',
  dialogDirs: {}
}

/** Teiländerung: nur die genannten Felder (main führt feldweise zusammen, settingsMerge.ts). */
export type SettingsPatch = Partial<AppSettings>

// ── Bibliothek ────────────────────────────────────────────────────────────────────────────────

/**
 * Ordner-Modus (docs/PLAN.md, „Bibliothek und Ordner“): normal; nur lesen (die App schreibt dort
 * nie, auch nicht im Stapel); privat (keine Vorschaubilder auf der Platte, nur im Speicher).
 */
export type FolderMode = 'normal' | 'nur-lesen' | 'privat'

export const FOLDER_MODES: readonly FolderMode[] = ['normal', 'nur-lesen', 'privat']

/** Zustand eines Bibliotheksordners: bereit, wird gerade eingelesen, gerade nicht erreichbar. */
export type FolderStatus = 'bereit' | 'liest' | 'nicht-erreichbar'

export interface LibraryFolder {
  id: number
  /** Absoluter Pfad – nur zur Anzeige im Renderer, nie zum Lesen (Schicht C) */
  path: string
  /** Letzter Pfadteil (Anzeige) */
  name: string
  mode: FolderMode
  status: FolderStatus
  /** Dateien im Index, die beim letzten Einlesen da waren */
  count: number
  /** Dateien im Index, die beim letzten Einlesen fehlten (Ordner war erreichbar) */
  missing: number
  /** Während des Einlesens: bisher gefundene Dateien */
  found: number
  /** Letztes vollständiges Einlesen (ms seit 1970) oder null */
  lastScan: number | null
  /** Ordner, die beim letzten Einlesen nicht lesbar waren (Rechte), zur Anzeige */
  unreadable: number
}

export interface LibraryState {
  folders: LibraryFolder[]
  /** Summe der vorhandenen Dateien aller Ordner */
  total: number
  /** Dateien, deren Grundfelder noch gelesen werden (0 = fertig) */
  metaPending: number
  /** Dateien, deren Vorschaubild noch entsteht (ohne Ordner „privat“; 0 = fertig) */
  thumbPending: number
}

/** Eine Datei für Raster und Liste – ohne Pfad (der Renderer liest keine Dateien, Schicht C). */
export interface ImageInfo {
  id: number
  folderId: number
  name: string
  /** Endung klein, ohne Punkt */
  ext: string
  /** Format nach Inhalt (jpeg, png …), null bis gelesen */
  format: string | null
  /** Bytes */
  size: number
  /** Änderungszeit (ms) */
  mtime: number
  /** Aufgerichtete Maße (Ausrichtung schon berücksichtigt) */
  width: number | null
  height: number | null
  /** EXIF-Ausrichtung 1–8 */
  orientation: number | null
  /** Aufnahme, lokale Zeit „YYYY-MM-DDTHH:MM:SS[.fff]“ */
  takenAt: string
  /** Zeitzone „+02:00“, wenn bekannt */
  takenOffset: string | null
  /** Herkunft des Datums (Rangfolge in dates.ts) */
  takenSource: DatumQuelle
  cameraMake: string | null
  cameraModel: string | null
  status: 'ok' | 'defekt'
  /** Metadaten gelesen (sonst: Datum vorläufig aus der Datei) */
  metaRead: boolean
  /** Durchschnittsfarbe „#rrggbb“ für den Platzhalter, sobald das Vorschaubild entstand */
  color: string | null
}

export type AddFolderResult =
  | { status: 'hinzugefuegt'; folder: LibraryFolder }
  | { status: 'abgebrochen' }
  | { status: 'abgelehnt'; grund: string }
