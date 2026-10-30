// Brücke zwischen Renderer und main: genau die GalerieApi aus @shared/ipc-contracts, nichts
// sonst (kein ipcRenderer, keine Node-Module im Renderer). Muster aus der Mottulbox.
import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron'
import { Channels, type GalerieApi } from '@shared/ipc-contracts'

/** Event-Abo mit Abmelden – verhindert liegengebliebene Listener. */
function subscribe(channel: string, cb: (...args: unknown[]) => void): () => void {
  const listener = (_e: IpcRendererEvent, ...args: unknown[]): void => cb(...args)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api: GalerieApi = {
  getSettings: () => ipcRenderer.invoke(Channels.settingsGet),
  setSettings: (patch) => ipcRenderer.invoke(Channels.settingsSet, patch),
  onSettingsChanged: (cb) => subscribe(Channels.settingsChanged, (s) => cb(s as never)),
  log: (message) => ipcRenderer.send(Channels.appLog, message),

  library: {
    state: () => ipcRenderer.invoke(Channels.libraryState),
    addFolder: () => ipcRenderer.invoke(Channels.libraryAddFolder),
    removeFolder: (id) => ipcRenderer.invoke(Channels.libraryRemoveFolder, id),
    setFolderMode: (id, mode) => ipcRenderer.invoke(Channels.librarySetFolderMode, id, mode),
    rescan: (id) => ipcRenderer.invoke(Channels.libraryRescan, id),
    query: (sortierung, filter) => ipcRenderer.invoke(Channels.libraryQuery, sortierung, filter),
    queryGroups: (sortierung, filter, gruppierung, seiten, bildFilter) =>
      ipcRenderer.invoke(
        Channels.libraryQueryGroups,
        sortierung,
        filter,
        gruppierung,
        seiten,
        bildFilter
      ),
    facets: (filter) => ipcRenderer.invoke(Channels.libraryFacets, filter),
    details: (ids) => ipcRenderer.invoke(Channels.libraryDetails, ids),
    dirs: () => ipcRenderer.invoke(Channels.libraryDirs),
    trash: (ids) => ipcRenderer.invoke(Channels.libraryTrash, ids),
    allFields: (id) => ipcRenderer.invoke(Channels.libraryAllFields, id),
    removeMissing: (folderId) => ipcRenderer.invoke(Channels.libraryRemoveMissing, folderId),
    views: () => ipcRenderer.invoke(Channels.libraryViews),
    saveView: (name, stand, ersetzen) =>
      ipcRenderer.invoke(Channels.librarySaveView, name, stand, ersetzen),
    deleteView: (id) => ipcRenderer.invoke(Channels.libraryDeleteView, id),
    size: (ids) => ipcRenderer.invoke(Channels.librarySize, ids),
    visible: (ids) => ipcRenderer.send(Channels.libraryVisible, ids),
    // Den Pfad kennt nur ein echtes Datei-Objekt aus einem Drop (oder Datei-Dialog); ein in der
    // Seite erzeugtes File hat keinen – getPathForFile liefert dann „“, und es fällt weg.
    addDropped: (files) =>
      ipcRenderer.invoke(
        Channels.libraryAddDropped,
        Array.from(files, (f) => webUtils.getPathForFile(f)).filter((p) => p !== '')
      ),
    onChanged: (cb) => subscribe(Channels.libraryChanged, (s) => cb(s as never)),
    onViewsChanged: (cb) => subscribe(Channels.libraryViewsChanged, (v) => cb(v as never))
  },
  meta: {
    write: (ids, aenderung) => ipcRenderer.invoke(Channels.metaWrite, ids, aenderung),
    undo: (journal) => ipcRenderer.invoke(Channels.metaUndo, journal)
  }
}

// contextIsolation ist immer an (secureWebPreferences) – ohne sie gibt es keine Brücke: Ein
// Rückfall auf globalThis gäbe der Seite die API ungeschützt.
if (process.contextIsolated) contextBridge.exposeInMainWorld('api', api)
