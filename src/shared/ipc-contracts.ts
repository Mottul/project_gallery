// IPC-Kanalnamen + die typisierte API, die der Preload per contextBridge als window.api
// bereitstellt. Einzige Quelle für main (Handler) und renderer (Aufruf); neue Fläche nach Skill
// ipc-kanal (Channel + GalerieApi-Methode + Preload + Handler). Muster aus der Mottulbox.

import type { AddFolderResult, AppSettings, FolderMode, LibraryState, SettingsPatch } from './types'

export const Channels = {
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  settingsChanged: 'settings:changed', // Event: AppSettings (von einem anderen Fenster geändert)
  appLog: 'app:log', // Renderer -> Debug-Log des main (Feld-Diagnose), Einweg

  libraryState: 'library:state',
  libraryAddFolder: 'library:addFolder',
  libraryRemoveFolder: 'library:removeFolder',
  librarySetFolderMode: 'library:setFolderMode',
  libraryRescan: 'library:rescan',
  libraryChanged: 'library:changed' // Event: LibraryState (Ordner, Anzahl, Einlesen)
} as const

export interface GalerieApi {
  /** Einstellungen (settings.json) lesen */
  getSettings(): Promise<AppSettings>
  /** Teiländerung speichern; Antwort ist der maßgebliche Stand. Ungültiges wird abgelehnt. */
  setSettings(patch: SettingsPatch): Promise<AppSettings>
  /** Änderungen aus anderen Fenstern; Rückgabe = Abmelden */
  onSettingsChanged(cb: (settings: AppSettings) => void): () => void
  /** Fehler des Renderers ins Debug-Log schreiben (ohne Bild-Metadaten, Skill bildschutz) */
  log(message: string): void

  library: {
    /** Ordner mit Anzahl und Zustand */
    state(): Promise<LibraryState>
    /** Ordner-Dialog im main; der Renderer schickt nie selbst einen Pfad (Schicht C) */
    addFolder(): Promise<AddFolderResult>
    /** Rückfrage im main; true = entfernt. Die Dateien bleiben unberührt. */
    removeFolder(id: number): Promise<boolean>
    setFolderMode(id: number, mode: FolderMode): Promise<void>
    /** Ordner neu einlesen (Abgleich) */
    rescan(id: number): Promise<void>
    /** Änderungen (auch Fortschritt beim Einlesen); Rückgabe = Abmelden */
    onChanged(cb: (state: LibraryState) => void): () => void
  }
}
