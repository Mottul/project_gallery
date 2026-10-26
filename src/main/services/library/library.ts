// Bibliothek im main: Ordner hinzufügen, entfernen, Modus, Einlesen – und der Zustand für die
// Oberfläche. Der Index (repo.ts) wird nur hier geschrieben; Dateizugriffe macht der Bilddienst.
// Ordner werden nacheinander eingelesen (Warteschlange); beim Start einmal alle (Abgleich).
// Danach – und schon während des Einlesens – liest der Bilddienst die Grundfelder (ExifTool) aller
// Dateien, deren Metadaten fehlen (zweite Warteschlange, Stapel für Stapel).

import { app, BrowserWindow, dialog } from 'electron'
import { basename, isAbsolute, join } from 'node:path'
import { grundfelderAus } from '@shared/grundfelder'
import { Channels } from '@shared/ipc-contracts'
import { konfliktText, ordnerKonflikt } from '@shared/ordnerPruefen'
import type { Sortierung } from '@shared/sortFilter'
import type {
  AddFolderResult,
  FolderMode,
  FolderStatus,
  ImageInfo,
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
import { vorschauSchluesselLaden } from '../cache/vorschauCache'
import * as repo from './repo'
import {
  ordnerNichtMehrPrivat,
  ordnerWirdPrivat,
  vorschauenAnstossen,
  vorschauenBeenden,
  vorschauenEinrichten,
  vorschauVerwerfen
} from './vorschauen'

const WINDOWS = process.platform === 'win32'
/** Höchstens so oft während eines Scans den Zustand melden */
const MELDEN_MS = 250
/** Dateien je Metadaten-Auftrag (ExifTool liest sie in Teilen zu 50 auf mehreren Prozessen) */
const META_STAPEL = 200

interface Laufzeit {
  status: FolderStatus
  found: number
  auftrag?: ScanAuftrag
}

const laufzeit = new Map<number, Laufzeit>()
const warteschlange: number[] = []
let aktiv: number | null = null
/** App wird beendet: nichts mehr anstoßen oder schreiben */
let beendet = false

function db(): DB {
  return getDb(lokalerUnterordner('index'))
}

// Vorschaubilder (vorschauen.ts) arbeiten auf demselben Index und melden über denselben Weg
vorschauenEinrichten({
  db: () => db(),
  melden: (sofort) => melden(sofort),
  nichtErreichbar: () => nichtErreichbar(),
  beendet: () => beendet
})

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
  return {
    folders,
    total: folders.reduce((s, f) => s + f.count, 0),
    metaPending: ohneExiftool ? 0 : repo.metaOffenAnzahl(db(), nichtErreichbar()),
    thumbPending: repo.vorschauOffenAnzahl(db(), nichtErreichbar())
  }
}

/** Ordner, die gerade nicht erreichbar sind (ihre Dateien warten mit den Metadaten). */
function nichtErreichbar(): number[] {
  return [...laufzeit].filter(([, lz]) => lz.status === 'nicht-erreichbar').map(([id]) => id)
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
    metadatenAnstossen()
    vorschauenAnstossen()
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
    metadatenAnstossen()
    vorschauenAnstossen()
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

// ── Metadaten (Grundfelder) ───────────────────────────────────────────────────────────────────

let metaLaeuft = false
/** Während einer Runde angestoßen: danach noch eine (neue Dateien, Ordner wieder erreichbar) */
let metaNochmal = false
/** ExifTool fehlt (nur beim Entwickeln ohne `npm run exiftool:fetch`): nicht weiter versuchen */
let ohneExiftool = false

function metadatenAnstossen(): void {
  if (beendet || ohneExiftool) return
  if (metaLaeuft) {
    metaNochmal = true
    return
  }
  void metadatenLesen()
}

async function metadatenLesen(): Promise<void> {
  metaLaeuft = true
  try {
    do {
      metaNochmal = false
      await metaRunde()
    } while (metaNochmal && !beendet && !ohneExiftool)
  } catch (err) {
    logLine('[bibliothek] Fehler beim Lesen der Metadaten:', String(err))
  } finally {
    metaLaeuft = false
    if (!beendet) melden()
  }
}

/** Absoluter Pfad einer Datei im Index (nur main und Bilddienst kennen Pfade). */
function dateiPfad(o: repo.MetaOffen): string {
  return join(o.ordner, ...o.rel_path.split('/'))
}

type Roh = Record<string, unknown> | null

/**
 * Ein Auftrag an den Bilddienst. null = aufhören (App wird beendet, ExifTool fehlt). Scheitert er
 * sonst (Dienst abgestürzt, Zeitlimit), gilt jede Datei als nicht gelesen. Ins Log nur der Code –
 * die Meldung könnte einen Pfad enthalten (Schicht D).
 */
async function lesen(dateien: readonly repo.MetaOffen[]): Promise<Map<number, Roh> | null> {
  try {
    const r = await bilddienst.meta(dateien.map((o) => ({ id: o.id, pfad: dateiPfad(o) })))
    return new Map(r.map((e) => [e.id, e.roh]))
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code ?? 'UNBEKANNT'
    if (code === 'ABGEBROCHEN' || beendet) return null
    if (code === 'KEIN_EXIFTOOL') {
      ohneExiftool = true
      logLine('[bibliothek] ExifTool fehlt – Metadaten werden nicht gelesen')
      return null
    }
    logLine(`[bibliothek] Metadaten-Auftrag gescheitert (${code}, ${dateien.length} Dateien)`)
    return new Map()
  }
}

/**
 * Stapel für Stapel lesen, bis nichts mehr offen ist. Fehlt im Ergebnis eine Datei (Absturz,
 * Zeitlimit), wird sie einzeln nachgelesen – so trifft ein Fehler nur die Datei, die ihn auslöst.
 * Scheitert sie auch allein, oder meldet ExifTool einen Fehler (leer, kaputt, präpariert), gilt
 * sie als gelesen – mit dem Datum aus der Datei –, sonst käme sie immer wieder; geändert wird sie
 * neu gelesen. Fehlt dagegen ein ganzer Ordner (Stick abgezogen), ist er nur nicht erreichbar:
 * Seine Dateien bleiben offen und werden nach dem nächsten Einlesen gelesen.
 */
async function metaRunde(): Promise<void> {
  const t0 = Date.now()
  let geschrieben = 0
  /** in dieser Runde nicht erreichbare Ordner (auch solche, die gerade eingelesen werden) */
  const aussen = new Set<number>()
  for (;;) {
    const offen = repo.metaOffen(db(), META_STAPEL, [...nichtErreichbar(), ...aussen])
    if (!offen.length || beendet) break
    const roh = await lesen(offen)
    if (!roh || beendet) return
    // Ordner mit Lücken: erreichbar? Sonst bleiben seine Dateien offen.
    const ordnerMitLuecken = new Map<number, string>()
    for (const o of offen) if (!roh.get(o.id)) ordnerMitLuecken.set(o.folder_id, o.ordner)
    for (const [id, pfad] of ordnerMitLuecken) {
      if (await isDirReachable(pfad)) continue
      aussen.add(id)
      // ein laufendes Einlesen meldet das selbst
      if (laufzeit.get(id)?.status !== 'liest') setzeStatus(id, 'nicht-erreichbar')
      logLine(`[bibliothek] Ordner ${id} beim Lesen der Metadaten nicht erreichbar`)
    }
    if (beendet) return
    for (const o of offen) {
      if (roh.get(o.id) || aussen.has(o.folder_id)) continue
      const einzeln = await lesen([o])
      if (!einzeln || beendet) return
      roh.set(o.id, einzeln.get(o.id) ?? null)
    }
    const jetzt = Date.now()
    geschrieben += repo.metaSchreiben(
      db(),
      offen
        .filter((o) => !aussen.has(o.folder_id))
        .map((o) => ({ ...o, felder: grundfelderAus(roh.get(o.id) ?? null, o, jetzt) })),
      jetzt
    )
    melden(false)
  }
  if (geschrieben) {
    logLine(`[bibliothek] Metadaten gelesen: ${geschrieben} Dateien, ${Date.now() - t0} ms`)
  }
}

// ── Abfragen ──────────────────────────────────────────────────────────────────────────────────

/** Kennungen aller vorhandenen Dateien in der gewünschten Reihenfolge. */
export function abfrage(sortierung: Sortierung): number[] {
  return repo.kennungen(db(), sortierung)
}

/** Details zu Kennungen (sichtbarer Ausschnitt), ohne Pfade. */
export function bildDetails(ids: readonly number[]): ImageInfo[] {
  return repo.details(db(), ids)
}

// ── Start und Ende ────────────────────────────────────────────────────────────────────────────

/** Beim Start: Index öffnen, alle Ordner im Hintergrund abgleichen, offene Metadaten lesen. */
export function bibliothekStarten(): void {
  // neuer Schlüssel (kein sicherer Speicher, Konto gewechselt): Cache leer – neu erzeugen lassen
  if (vorschauSchluesselLaden()) {
    const n = repo.vorschauAlleOffen(db())
    if (n) logLine(`[vorschau] neuer Schlüssel – ${n} Vorschaubilder entstehen neu`)
  }
  for (const o of repo.ordnerListe(db())) einreihen(o.id)
  metadatenAnstossen()
  vorschauenAnstossen()
}

export function bibliothekBeenden(): void {
  beendet = true
  vorschauenBeenden()
  // eine gedrosselte Meldung öffnete den Index sonst nach schliesseDb() wieder
  if (meldeTimer) clearTimeout(meldeTimer)
  meldeTimer = null
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
  // Kennungen vorher merken – nach dem Löschen der Zeilen fände sie niemand mehr
  const ids = repo.ordnerKennungen(db(), id)
  const ok = repo.ordnerEntfernen(db(), id)
  logLine('[bibliothek] Ordner entfernt:', id)
  // Vorschaubilder gleich mit (Schicht D: keine Reste)
  await vorschauVerwerfen(ids)
  melden()
  return ok
}

export async function modusSetzen(id: number, mode: FolderMode): Promise<void> {
  const vorher = repo.ordnerHolen(db(), id)?.mode
  if (!repo.modusSetzen(db(), id, mode)) throw new Error('Ordner gibt es nicht')
  // „privat“: keine Vorschaubilder auf der Platte – vorhandene sofort löschen (Schicht D)
  if (mode === 'privat' && vorher !== 'privat') await ordnerWirdPrivat(db(), id)
  else if (mode !== 'privat' && vorher === 'privat') ordnerNichtMehrPrivat(db(), id)
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
