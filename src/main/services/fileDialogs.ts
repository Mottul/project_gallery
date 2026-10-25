// Datei-Dialoge mit gemerktem Ordner – alle Öffnen-/Speichern-Dialoge der App laufen hierüber.
// Aus der Mottulbox übernommen (project_mega/src/main/services/fileDialogs.ts, Stand 0cc14cb),
// ohne deren Projektordner.
//
// Seit Electron 43 öffnet ein Dialog ohne absoluten Startpfad im Downloads-Ordner, und das
// Betriebssystem merkt sich den zuletzt benutzten Ordner nicht mehr. Deshalb merkt sich die App
// den Ordner selbst: je Art (Ordner, Dateien, Speichern) und über Neustarts hinweg in
// settings.json. Pfade aus einem Dialog des main gelten als vom Nutzer gewählt (Skill ipc-kanal).

import {
  dialog,
  type BrowserWindow,
  type OpenDialogOptions,
  type OpenDialogReturnValue,
  type SaveDialogOptions,
  type SaveDialogReturnValue
} from 'electron'
import { dirname, isAbsolute } from 'node:path'
import type { DialogDirKind } from '@shared/types'
import { dialogStartPath } from './dialogStartPath'
import { isDirReachable } from './reachableDir'
import { getSettings, setSettings } from './store'

/** Absoluter, erreichbarer Ordner? (asynchron – ein getrenntes Netzlaufwerk hält sonst den main an) */
async function reachable(dir: unknown): Promise<boolean> {
  return typeof dir === 'string' && isAbsolute(dir) && (await isDirReachable(dir))
}

async function withStartPath<T extends { defaultPath?: string }>(
  kind: DialogDirKind,
  opts: T
): Promise<T> {
  const dir = getSettings().dialogDirs[kind]
  const ok = await reachable(dir)
  const defaultPath = dialogStartPath(dir, opts.defaultPath, () => ok)
  return defaultPath ? { ...opts, defaultPath } : opts
}

function remember(kind: DialogDirKind, dir: string): void {
  if (getSettings().dialogDirs[kind] === dir) return
  setSettings({ dialogDirs: { ...getSettings().dialogDirs, [kind]: dir } })
}

/** Öffnen-Dialog (mit `parent` modal zum Fenster). Gemerkt wird bei einer Ordner-Wahl der
 *  Ordner selbst, sonst der Ordner der ersten Datei. */
export async function showOpenDialog(
  parent: BrowserWindow | null,
  opts: OpenDialogOptions
): Promise<OpenDialogReturnValue> {
  const kind: DialogDirKind = opts.properties?.includes('openDirectory') ? 'ordner' : 'dateien'
  const o = await withStartPath(kind, opts)
  const res = parent ? await dialog.showOpenDialog(parent, o) : await dialog.showOpenDialog(o)
  const first = res.canceled ? undefined : res.filePaths[0]
  if (first) remember(kind, kind === 'ordner' ? first : dirname(first))
  return res
}

/** Speichern-Dialog; ein bloßer Dateiname als `defaultPath` landet im gemerkten Ordner. */
export async function showSaveDialog(
  parent: BrowserWindow | null,
  opts: SaveDialogOptions
): Promise<SaveDialogReturnValue> {
  const o = await withStartPath('speichern', opts)
  const res = parent ? await dialog.showSaveDialog(parent, o) : await dialog.showSaveDialog(o)
  if (!res.canceled && res.filePath) remember('speichern', dirname(res.filePath))
  return res
}
