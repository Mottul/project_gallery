// IPC-Kanalnamen + die typisierte API, die der Preload per contextBridge als window.api
// bereitstellt. Einzige Quelle für main (Handler) und renderer (Aufruf); neue Fläche nach Skill
// ipc-kanal (Channel + GalerieApi-Methode + Preload + Handler). Muster aus der Mottulbox.

import type { BildFilter, Facetten } from './bildFilter'
import type {
  AnsichtSpeichernErgebnis,
  AnsichtStand,
  GespeicherteAnsicht
} from './gespeicherteAnsicht'
import type { Gruppe, Gruppierung } from './gruppen'
import type { OrdnerFilter, Sortierung } from './sortFilter'
import type {
  AddFolderResult,
  AppSettings,
  FolderMode,
  ImageInfo,
  LibraryDirs,
  LibraryState,
  MetaFeld,
  SettingsPatch,
  TrashResult
} from './types'

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
  libraryQuery: 'library:query',
  libraryQueryGroups: 'library:queryGroups',
  libraryFacets: 'library:facets',
  libraryDetails: 'library:details',
  libraryDirs: 'library:dirs',
  librarySize: 'library:size',
  libraryVisible: 'library:visible', // Renderer -> main, Einweg: sichtbare Kennungen
  libraryAddDropped: 'library:addDropped',
  libraryTrash: 'library:trash',
  libraryAllFields: 'library:allFields',
  libraryRemoveMissing: 'library:removeMissing',
  libraryViews: 'library:views',
  librarySaveView: 'library:saveView',
  libraryDeleteView: 'library:deleteView',
  libraryChanged: 'library:changed', // Event: LibraryState (Ordner, Anzahl, Einlesen)
  libraryViewsChanged: 'library:viewsChanged' // Event: GespeicherteAnsicht[]
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
    /** Kennungen aller vorhandenen Dateien, geordnet (einmal je Sortierung); wahlweise nur ein
     *  Bibliotheksordner bzw. ein Unterordner samt allem darunter */
    query(sortierung: Sortierung, filter?: OrdnerFilter): Promise<number[]>
    /**
     * Wie query, dazu die Gruppen-Überschriften (folgen der Sortierung; „aus“ = keine), mit
     * `seiten` je Kennung das Seitenverhältnis für den Blocksatz (0 = unbekannt) und mit
     * `bildFilter` nur die passenden Bilder (`gesamt` = Bilder im Knoten ohne Filter)
     */
    queryGroups(
      sortierung: Sortierung,
      filter: OrdnerFilter | undefined,
      gruppierung: Gruppierung,
      seiten?: boolean,
      bildFilter?: BildFilter
    ): Promise<{ ids: number[]; gruppen: Gruppe[]; seiten?: number[]; gesamt?: number }>
    /** Werte für die Auswahllisten der Filterleiste (Kameras, Orte, Stichwörter …) im Knoten */
    facets(filter?: OrdnerFilter): Promise<Facetten>
    /** Details zu höchstens 1000 Kennungen (sichtbarer Ausschnitt), ohne Pfade */
    details(ids: number[]): Promise<ImageInfo[]>
    /** Unterordner je Bibliotheksordner mit Anzahl (Ordnerbaum) */
    dirs(): Promise<LibraryDirs[]>
    /** Summe der Dateigrößen einer Auswahl (Statusleiste) */
    size(ids: number[]): Promise<number>
    /** Was gerade sichtbar ist (gedrosselt, höchstens 1000): dort entstehen Vorschaubilder zuerst */
    visible(ids: number[]): void
    /**
     * Gezogene Ordner aufnehmen (Drag & Drop). Übergeben werden die Datei-Objekte des Drops; den
     * Pfad liest erst der Preload daraus – die Seite selbst kann keinen Pfad vorgeben (Schicht C).
     */
    addDropped(files: File[]): Promise<AddFolderResult[]>
    /** Bilder in den Papierkorb – Rückfrage im main, nie in Ordnern „nur lesen“ */
    trash(ids: number[]): Promise<TrashResult>
    /** „Alle Felder“ eines Bildes, frisch aus der Datei gelesen (Info-Panel); null = nicht lesbar */
    allFields(id: number): Promise<MetaFeld[] | null>
    /** Fehlende Dateien eines Ordners aus der Galerie nehmen – Rückfrage im main; Anzahl */
    removeMissing(folderId: number): Promise<number>
    /** Gespeicherte Ansichten nach Name */
    views(): Promise<GespeicherteAnsicht[]>
    /** Unter einem Namen merken; ein vergebener Name nur mit `ersetzen` */
    saveView(
      name: string,
      stand: AnsichtStand,
      ersetzen: boolean
    ): Promise<AnsichtSpeichernErgebnis>
    /** Rückfrage im main; true = gelöscht */
    deleteView(id: number): Promise<boolean>
    /** Änderungen (auch Fortschritt beim Einlesen); Rückgabe = Abmelden */
    onChanged(cb: (state: LibraryState) => void): () => void
    /** Ansichten geändert – auch, wenn ein entfernter Ordner seine mitnahm */
    onViewsChanged(cb: (views: GespeicherteAnsicht[]) => void): () => void
  }
}
