// Bibliothek im main: Ordner hinzufügen, entfernen, Modus, Einlesen – und der Zustand für die
// Oberfläche. Der Index (repo.ts) wird nur hier geschrieben; Dateizugriffe macht der Bilddienst.
// Ordner werden nacheinander eingelesen (Warteschlange); beim Start einmal alle (Abgleich).

import { app, BrowserWindow, dialog } from 'electron'
import { basename, isAbsolute } from 'node:path'
import { Channels } from '@shared/ipc-contracts'
import { konfliktText, ordnerKonflikt } from '@shared/ordnerPruefen'
import type {
  AddFolderResult,
  FolderMode,
  FolderStatus,
  LibraryFolder,
  LibraryState
} from '@shared/types'
import { bilddienst, type ScanAuftrag } from '../bilddienst/client'
import { broadcast } from '../broadcast'
import { getDb, schliesseDb, type DB } from '../db'
import { showOpenDialog } from '../fileDialogs'
import { lokalerOrdner, lokalerUnterordner } from '../lokaleDaten'
import { logLine } from '../log'
import { isDirReachable } from '../reachableDir'
import * as repo from './repo'

const WINDOWS = process.platform === 'win32'
/** Höchstens so oft während eines Scans den Zustand melden */
const MELDEN_MS = 250

interface Laufzeit {
  status: FolderStatus
  found: number
  auftrag?: ScanAuftrag
}

const laufzeit = new Map<number, Laufzeit>()
const warteschlange: number[] = []
let aktiv: number | null = null

function db(): DB {
  return getDb(lokalerUnterordner('index'))
}

/** Anzeigename: letzter Pfadteil, bei einer Wurzel („D:\“) der Pfad selbst. */
function anzeigeName(pfad: string): string {
  return basename(pfad) || pfad
}

export function zustand(): LibraryState {
  const zahlen = repo.zaehlen(db())
  const folders: LibraryFolder[] = repo.ordnerListe(db()).map((o) => {
    const z = zahlen.get(o.id) ?? { count: 0, missing: 0 }
    const lz = laufzeit.get(o.id)
    return {
      id: o.id,
      path: o.path,
      name: anzeigeName(o.path),
      mode: o.mode,
      status: lz?.status ?? 'bereit',
      count: z.count,
      missing: z.missing,
      found: lz?.found ?? 0,
      lastScan: o.last_scan,
      unreadable: o.unreadable
    }
  })
  return { folders, total: folders.reduce((s, f) => s + f.count, 0) }
}

let meldeTimer: NodeJS.Timeout | null = null

/** Zustand an alle Fenster; während eines Scans gedrosselt. */
function melden(sofort = true): void {
  if (!sofort) {
    meldeTimer ??= setTimeout(() => {
      meldeTimer = null
      broadcast(Channels.libraryChanged, zustand())
    }, MELDEN_MS)
    return
  }
  if (meldeTimer) clearTimeout(meldeTimer)
  meldeTimer = null
  broadcast(Channels.libraryChanged, zustand())
}

function setzeStatus(id: number, status: FolderStatus, found = 0): Laufzeit {
  const lz = { ...laufzeit.get(id), status, found }
  laufzeit.set(id, lz)
  return lz
}

async function einlesen(id: number): Promise<void> {
  const ordner = repo.ordnerHolen(db(), id)
  if (!ordner) return
  if (!(await isDirReachable(ordner.path))) {
    setzeStatus(id, 'nicht-erreichbar')
    melden()
    return
  }
  const seq = repo.scanBeginnen(db(), id)
  const lz = setzeStatus(id, 'liest')
  melden()
  const t0 = Date.now()
  lz.auftrag = bilddienst.scan(ordner.path, (dateien) => {
    // Ordner inzwischen entfernt? Dann nichts mehr schreiben.
    if (laufzeit.get(id) !== lz) return
    repo.stapelSchreiben(db(), id, seq, dateien, WINDOWS)
    lz.found += dateien.length
    melden(false)
  })
  try {
    const r = await lz.auftrag.fertig
    if (laufzeit.get(id) !== lz) return
    const fehlend = repo.scanAbschliessen(db(), id, seq, r.unlesbar, WINDOWS, Date.now())
    logLine(
      `[bibliothek] Ordner ${id} eingelesen: ${r.gefunden} Dateien, ${fehlend} fehlen neu,`,
      `${r.unlesbar.length} unlesbar, ${Date.now() - t0} ms`
    )
    setzeStatus(id, 'bereit')
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code ?? ''
    if (code === 'ABGEBROCHEN') return
    // Wurzel weg (Stick abgezogen) oder hängt: nicht erreichbar – der Index bleibt, wie er war
    const weg = ['ENOENT', 'ENOTDIR', 'EACCES', 'EPERM', 'ZEITLIMIT'].includes(code)
    logLine(`[bibliothek] Einlesen von Ordner ${id} gescheitert (${code}):`, String(err))
    if (laufzeit.get(id) === lz) setzeStatus(id, weg ? 'nicht-erreichbar' : 'bereit')
  } finally {
    melden()
  }
}

async function abarbeiten(): Promise<void> {
  if (aktiv !== null) return
  while (warteschlange.length) {
    aktiv = warteschlange.shift() as number
    try {
      await einlesen(aktiv)
    } catch (err) {
      logLine('[bibliothek] Fehler beim Einlesen:', String(err))
    }
    aktiv = null
  }
}

function einreihen(id: number): void {
  if (aktiv === id || warteschlange.includes(id)) return
  warteschlange.push(id)
  void abarbeiten()
}

/** Beim Start: Index öffnen und alle Ordner im Hintergrund abgleichen. */
export function bibliothekStarten(): void {
  for (const o of repo.ordnerListe(db())) einreihen(o.id)
}

export function bibliothekBeenden(): void {
  for (const lz of laufzeit.values()) lz.auftrag?.abbrechen()
  bilddienst.beenden()
  schliesseDb()
}

export async function ordnerHinzufuegen(win: BrowserWindow | null): Promise<AddFolderResult> {
  const res = await showOpenDialog(win, {
    title: 'Ordner zur Galerie hinzufügen',
    buttonLabel: 'Hinzufügen',
    properties: ['openDirectory']
  })
  const pfad = res.canceled ? undefined : res.filePaths[0]
  if (!pfad) return { status: 'abgebrochen' }
  if (!isAbsolute(pfad)) return { status: 'abgelehnt', grund: 'Ungültiger Ordner.' }
  const konflikt = ordnerKonflikt(
    pfad,
    repo.ordnerListe(db()).map((o) => o.path),
    [lokalerOrdner(), app.getPath('userData')],
    WINDOWS
  )
  if (konflikt) return { status: 'abgelehnt', grund: konfliktText(konflikt, anzeigeName) }
  if (!(await isDirReachable(pfad))) {
    return { status: 'abgelehnt', grund: 'Der Ordner ist gerade nicht erreichbar.' }
  }
  const id = repo.ordnerAnlegen(db(), pfad, WINDOWS, Date.now())
  logLine('[bibliothek] Ordner hinzugefügt:', id)
  einreihen(id)
  const folder = zustand().folders.find((f) => f.id === id) as LibraryFolder
  melden()
  return { status: 'hinzugefuegt', folder }
}

export async function ordnerEntfernen(win: BrowserWindow | null, id: number): Promise<boolean> {
  const ordner = repo.ordnerHolen(db(), id)
  if (!ordner) return false
  const opts = {
    type: 'question' as const,
    title: 'Ordner entfernen',
    message: `„${anzeigeName(ordner.path)}“ aus der Galerie entfernen?`,
    detail:
      'Die Dateien im Ordner bleiben unberührt. Entfernt wird nur, was die Galerie zu diesem ' +
      'Ordner gespeichert hat (Index, später auch Vorschaubilder).',
    buttons: ['Entfernen', 'Abbrechen'],
    defaultId: 1,
    cancelId: 1,
    noLink: true
  }
  const { response } = win
    ? await dialog.showMessageBox(win, opts)
    : await dialog.showMessageBox(opts)
  if (response !== 0) return false
  laufzeit.get(id)?.auftrag?.abbrechen()
  laufzeit.delete(id)
  const i = warteschlange.indexOf(id)
  if (i >= 0) warteschlange.splice(i, 1)
  const ok = repo.ordnerEntfernen(db(), id)
  logLine('[bibliothek] Ordner entfernt:', id)
  melden()
  return ok
}

export function modusSetzen(id: number, mode: FolderMode): void {
  if (!repo.modusSetzen(db(), id, mode)) throw new Error('Ordner gibt es nicht')
  melden()
}

export function neuEinlesen(id: number): void {
  if (!repo.ordnerHolen(db(), id)) throw new Error('Ordner gibt es nicht')
  einreihen(id)
}

/** Fenster, aus dem eine Anfrage kam (für modale Dialoge). */
export function fensterVon(sender: Electron.WebContents): BrowserWindow | null {
  return BrowserWindow.fromWebContents(sender)
}
