// Bibliothek im main: Ordner hinzufügen, entfernen, Modus, Einlesen – und der Zustand für die
// Oberfläche. Der Index (repo.ts) wird nur hier geschrieben; Dateizugriffe macht der Bilddienst.
// Ordner werden nacheinander eingelesen (Warteschlange); beim Start einmal alle (Abgleich).
// Danach – und schon während des Einlesens – liest der Bilddienst die Grundfelder (ExifTool) aller
// Dateien, deren Metadaten fehlen (zweite Warteschlange, Stapel für Stapel). Seit 1.6 überwacht er
// die Ordner (ueberwachen.ts); gemeldete Änderungen gleicht dieselbe Warteschlange als Teil-Abgleich
// ab – nur die genannten Pfade, nach den ganzen Abgleichen.

import { app, BrowserWindow, dialog, shell } from 'electron'
import { basename, isAbsolute, join } from 'node:path'
import { landName } from '@shared/geo'
import { gruppenArt, type Gruppe, type Gruppierung } from '@shared/gruppen'
import { grundfelderAus, type Grundfelder } from '@shared/grundfelder'
import { Channels } from '@shared/ipc-contracts'
import { konfliktText, ordnerKonflikt } from '@shared/ordnerPruefen'
import type { OrdnerFilter, Sortierung } from '@shared/sortFilter'
import type {
  AddFolderResult,
  FolderMode,
  FolderStatus,
  ImageInfo,
  LibraryDirs,
  LibraryFolder,
  LibraryState,
  MetaFeld,
  TrashResult
} from '@shared/types'
import { bilddienst, type ScanAuftrag } from '../bilddienst/client'
import { broadcast } from '../broadcast'
import { getDb, schliesseDb, type DB } from '../db'
import { showOpenDialog } from '../fileDialogs'
import { orteStand } from '../geo/geoPfad'
import { lokalerOrdner, lokalerUnterordner } from '../lokaleDaten'
import { logLine } from '../log'
import { isDirReachable } from '../reachableDir'
import { vorschauSchluesselLaden } from '../cache/vorschauCache'
import { mitZeitlimit, pruefeDatei } from '../dateien/pruefeDatei'
import { anzeigeVerwerfen, bildHolen, type BildAntwort } from './anzeige'
import * as repo from './repo'
import {
  nichtMehrUeberwachen,
  sicherstellen,
  ueberwachenBeenden,
  ueberwachenEinrichten,
  ueberwachungsArt
} from './ueberwachen'
import {
  ordnerNichtMehrPrivat,
  ordnerWirdPrivat,
  vorschauenAnstossen,
  vorschauenBeenden,
  vorschauAusschnitt,
  vorschauenEinrichten,
  vorschauVerwerfen
} from './vorschauen'

const WINDOWS = process.platform === 'win32'
/** Höchstens so oft während eines Scans den Zustand melden */
const MELDEN_MS = 250
/** Dateien je Metadaten-Auftrag (ExifTool liest sie in Teilen zu 50 auf mehreren Prozessen) */
const META_STAPEL = 200
/** Mehr offene Pfade für den Teil-Abgleich eines Ordners: ihn lieber ganz abgleichen */
const TEIL_HOECHSTENS = 2000

interface Laufzeit {
  status: FolderStatus
  found: number
  auftrag?: ScanAuftrag
}

const laufzeit = new Map<number, Laufzeit>()
/** Ordner, die ganz abgeglichen werden sollen */
const warteschlange: number[] = []
/** Gemeldete Pfade je Ordner für den Teil-Abgleich (nach den ganzen): samt allem darunter bzw.
 *  nur die Datei (geändert) */
const teile = new Map<number, { pfade: Set<string>; dateien: Set<string> }>()
let aktiv: number | null = null
/** App wird beendet: nichts mehr anstoßen oder schreiben */
let beendet = false
/** Zählt Abgleiche, die den Index verändert haben (LibraryState.revision) */
let revision = 0

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
      unreadable: o.unreadable,
      watch: lz?.status === 'nicht-erreichbar' ? null : ueberwachungsArt(o.id)
    }
  })
  return {
    folders,
    total: folders.reduce((s, f) => s + f.count, 0),
    metaPending: ohneExiftool ? 0 : repo.metaOffenAnzahl(db(), nichtErreichbar()),
    thumbPending: repo.vorschauOffenAnzahl(db(), nichtErreichbar()),
    revision
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
  // erst überwachen, dann einlesen: Änderungen während des Einlesens gehen so nicht verloren
  await sicherstellen(id, ordner.path)
  if (beendet || !repo.ordnerHolen(db(), id)) return
  // was der Wächter bis hierher meldete, deckt dieser Abgleich ab
  teile.delete(id)
  const neuAb = repo.hoechsteKennung(db())
  const seq = repo.scanBeginnen(db(), id)
  const lz = setzeStatus(id, 'liest')
  melden()
  const t0 = Date.now()
  let geschrieben = 0
  lz.auftrag = bilddienst.scan(ordner.path, (dateien) => {
    // Ordner inzwischen entfernt? Dann nichts mehr schreiben.
    if (laufzeit.get(id) !== lz) return
    geschrieben += repo.stapelSchreiben(db(), id, seq, dateien, WINDOWS)
    lz.found += dateien.length
    melden(false)
    metadatenAnstossen()
    vorschauenAnstossen()
  })
  try {
    const r = await lz.auftrag.fertig
    if (laufzeit.get(id) !== lz) return
    const a = repo.scanAbschliessen(db(), id, seq, r.unlesbar, WINDOWS, Date.now(), neuAb)
    logLine(
      `[bibliothek] Ordner ${id} eingelesen: ${r.gefunden} Dateien, ${a.fehlend} fehlen neu,`,
      `${a.verschoben} verschoben, ${r.unlesbar.length} unlesbar, ${Date.now() - t0} ms`
    )
    if (geschrieben || a.fehlend || a.verschoben) revision++
    await verworfeneWeg(a.verworfen)
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

/** Neue Zeilen, die in einer verschobenen aufgingen: ihre Vorschaubilder und Umrechnungen weg. */
async function verworfeneWeg(ids: readonly number[]): Promise<void> {
  if (!ids.length) return
  anzeigeVerwerfen(ids)
  await vorschauVerwerfen(ids)
}

/**
 * Teil-Abgleich nach dem Überwachen: nur die gemeldeten Pfade einlesen und abschließen. Der
 * Status bleibt (meist „bereit“) – das geht schnell und soll in der Oberfläche nicht flackern.
 */
async function teilEinlesen(id: number, pfade: string[], dateien: string[]): Promise<void> {
  const ordner = repo.ordnerHolen(db(), id)
  if (!ordner || beendet) return
  const lz = laufzeit.get(id) ?? setzeStatus(id, 'bereit')
  if (lz.status !== 'bereit') return einreihen(id)
  const neuAb = repo.hoechsteKennung(db())
  const seq = repo.scanBeginnen(db(), id)
  const t0 = Date.now()
  let geschrieben = 0
  const auftrag = bilddienst.scan(
    ordner.path,
    (dateien) => {
      if (laufzeit.get(id) !== lz) return
      geschrieben += repo.stapelSchreiben(db(), id, seq, dateien, WINDOWS)
      melden(false)
      metadatenAnstossen()
      vorschauenAnstossen()
    },
    { pfade, dateien }
  )
  lz.auftrag = auftrag
  try {
    const r = await auftrag.fertig
    if (laufzeit.get(id) !== lz) return
    const a = repo.teilAbschliessen(db(), id, seq, pfade, dateien, r.unlesbar, WINDOWS, neuAb)
    if (geschrieben || a.fehlend || a.verschoben) revision++
    logLine(
      `[bibliothek] Ordner ${id} abgeglichen (${pfade.length + dateien.length} Pfade):`,
      `${r.gefunden} Dateien,`,
      `${a.fehlend} fehlen neu, ${a.verschoben} verschoben, ${Date.now() - t0} ms`
    )
    await verworfeneWeg(a.verworfen)
    metadatenAnstossen()
    vorschauenAnstossen()
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code ?? ''
    if (code === 'ABGEBROCHEN') return
    // Wurzel weg oder Dienst gestorben: der ganze Abgleich klärt es (auch „nicht erreichbar“)
    logLine(`[bibliothek] Teil-Abgleich von Ordner ${id} gescheitert (${code})`)
    if (laufzeit.get(id) === lz) einreihen(id)
  } finally {
    if (lz.auftrag === auftrag) lz.auftrag = undefined
    melden()
  }
}

async function abarbeiten(): Promise<void> {
  if (aktiv !== null) return
  for (;;) {
    let arbeit: () => Promise<void>
    if (warteschlange.length) {
      const id = warteschlange.shift() as number
      aktiv = id
      arbeit = () => einlesen(id)
    } else if (teile.size) {
      const [id, t] = teile.entries().next().value as [
        number,
        { pfade: Set<string>; dateien: Set<string> }
      ]
      teile.delete(id)
      aktiv = id
      arbeit = () => teilEinlesen(id, [...t.pfade], [...t.dateien])
    } else break
    try {
      await arbeit()
    } catch (err) {
      logLine('[bibliothek] Fehler beim Einlesen:', String(err))
    }
    aktiv = null
  }
}

function einreihen(id: number): void {
  if (warteschlange.includes(id)) return
  // läuft er gerade, danach noch einmal: was während des Einlesens geschah, käme sonst nicht an
  warteschlange.push(id)
  void abarbeiten()
}

/** Vom Wächter gemeldete Pfade zum Teil-Abgleich vormerken. */
function teilEinreihen(id: number, pfade: readonly string[], dateien: readonly string[]): void {
  if (warteschlange.includes(id)) return // ein ganzer Abgleich steht ohnehin an
  const t = teile.get(id) ?? { pfade: new Set<string>(), dateien: new Set<string>() }
  for (const p of pfade) t.pfade.add(p)
  for (const d of dateien) t.dateien.add(d)
  if (t.pfade.size + t.dateien.size > TEIL_HOECHSTENS) {
    teile.delete(id)
    return einreihen(id)
  }
  teile.set(id, t)
  void abarbeiten()
}

// Überwachen (ueberwachen.ts) reiht über dieselbe Warteschlange ein
ueberwachenEinrichten({
  ordner: () => repo.ordnerListe(db()),
  status: (id) => laufzeit.get(id)?.status ?? 'bereit',
  einlesen: (id) => einreihen(id),
  teil: (id, pfade, dateien) => teilEinreihen(id, pfade, dateien),
  erreichbar: (pfad) => isDirReachable(pfad),
  melden: () => melden(),
  beendet: () => beendet
})

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

/**
 * Ort je Datei (2.2): das Ort-Feld der Metadaten hat Vorrang; sonst der nächste Ort zu den
 * Koordinaten (Ortsdaten im Bilddienst). Ohne Ortsdaten bleibt es bei den Koordinaten.
 */
async function orteFuer(
  zeilen: readonly { id: number; felder: Grundfelder }[]
): Promise<Map<number, repo.OrtWert>> {
  const m = new Map<number, repo.OrtWert>()
  const punkte: { id: number; lat: number; lon: number }[] = []
  for (const z of zeilen) {
    const om = z.felder.ortMeta
    if (om) {
      const land = om.land ?? (om.landCode ? landName(om.landCode) : null)
      m.set(z.id, { name: om.name, land, quelle: 'metadaten' })
    } else if (z.felder.gps) {
      punkte.push({ id: z.id, lat: z.felder.gps.breite, lon: z.felder.gps.laenge })
    }
  }
  if (!punkte.length) return m
  try {
    for (const o of await bilddienst.orte(punkte)) {
      if (o.name) m.set(o.id, { name: o.name, land: o.land, quelle: 'gps' })
    }
  } catch (err) {
    logLine('[bibliothek] Orte nicht bestimmt:', (err as NodeJS.ErrnoException).code ?? 'UNBEKANNT')
  }
  return m
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
    const r = await bilddienst.meta(
      dateien.map((o) => ({ id: o.id, pfad: dateiPfad(o), size: o.size, mtime: o.mtime }))
    )
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
    const zeilen = offen
      .filter((o) => !aussen.has(o.folder_id))
      .map((o) => ({ ...o, felder: grundfelderAus(roh.get(o.id) ?? null, o, jetzt) }))
    const orte = await orteFuer(zeilen)
    if (beendet) return
    geschrieben += repo.metaSchreiben(
      db(),
      zeilen.map((z) => ({ ...z, ort: orte.get(z.id) ?? null })),
      jetzt
    )
    melden(false)
  }
  if (geschrieben) {
    logLine(`[bibliothek] Metadaten gelesen: ${geschrieben} Dateien, ${Date.now() - t0} ms`)
  }
}

// ── Abfragen ──────────────────────────────────────────────────────────────────────────────────

/** Kennungen aller vorhandenen Dateien in der gewünschten Reihenfolge, wahlweise nur eines Ordners. */
export function abfrage(sortierung: Sortierung, filter?: OrdnerFilter): number[] {
  return repo.kennungen(db(), sortierung, filter, WINDOWS)
}

/**
 * Kennungen mit Gruppen-Überschriften (2.3): Die Gruppen folgen der Sortierung; ohne Gruppen
 * (Gruppierung „aus“ oder eine Sortierung ohne Gruppen) eine leere Liste.
 */
export function abfrageMitGruppen(
  sortierung: Sortierung,
  filter: OrdnerFilter | undefined,
  gruppierung: Gruppierung
): { ids: number[]; gruppen: Gruppe[] } {
  const art = gruppenArt(sortierung.feld)
  if (!art || gruppierung === 'aus') {
    return { ids: repo.kennungen(db(), sortierung, filter, WINDOWS), gruppen: [] }
  }
  return repo.kennungenMitGruppen(db(), sortierung, filter, art, gruppierung, WINDOWS)
}

/** Unterordner je Bibliotheksordner mit der Zahl ihrer direkten Dateien (Ordnerbaum). */
export function verzeichnisBaum(): LibraryDirs[] {
  const je = new Map<number, LibraryDirs>()
  for (const v of repo.verzeichnisse(db())) {
    const eintrag = je.get(v.folder_id) ?? { folderId: v.folder_id, dirs: [] }
    eintrag.dirs.push({ path: v.pfad, count: v.anzahl })
    je.set(v.folder_id, eintrag)
  }
  return [...je.values()]
}

/** Summe der Dateigrößen einer Auswahl (Statusleiste). */
export function auswahlGroesse(ids: readonly number[]): number {
  return repo.groesseSumme(db(), ids)
}

/** Die Seite meldet, was sichtbar ist: dort entstehen fehlende Vorschaubilder zuerst. */
export function sichtbar(ids: readonly number[]): void {
  vorschauAusschnitt(ids)
}

/** Details zu Kennungen (sichtbarer Ausschnitt), ohne Pfade. */
export function bildDetails(ids: readonly number[]): ImageInfo[] {
  return repo.details(db(), ids)
}

/** Bild für den Betrachter (bild://): Original oder Umrechnung, vorher geprüft. */
export function bildFuerBetrachter(id: number): Promise<BildAntwort> {
  return bildHolen(db(), id)
}

/** „Alle Felder“ einer Datei, frisch aus der Datei gelesen (Info-Panel); null = nicht lesbar. */
export async function alleFelder(id: number): Promise<MetaFeld[] | null> {
  const [z] = repo.vorschauZeilen(db(), [id])
  if (!z || z.status === 'fehlt') return null
  return bilddienst.alleFelder({
    pfad: join(z.ordner, ...z.rel_path.split('/')),
    ordner: z.ordner,
    size: z.size,
    mtime: z.mtime
  })
}

/** Nach so langer Zeit fallen fehlende Dateien samt Vorschaubildern weg (entschieden 29.10.2026) */
const FEHLEND_TAGE = 30
const FEHLEND_PRUEFEN_MS = 6 * 3600_000
let fehlendTakt: NodeJS.Timeout | null = null

/** Index-Zeilen fehlender Dateien samt Vorschaubildern und Umrechnungen entfernen. */
async function fehlendeWeg(ids: readonly number[]): Promise<void> {
  if (!ids.length) return
  repo.bilderEntfernen(db(), ids)
  anzeigeVerwerfen(ids)
  await vorschauVerwerfen(ids)
  revision++
  melden()
}

/** Was seit mindestens 30 Tagen fehlt, kommt weg (beim Start und alle paar Stunden). */
async function fehlendeAufraeumen(): Promise<void> {
  if (beendet) return
  const ids = repo.fehlende(db(), { vor: Date.now() - FEHLEND_TAGE * 86_400_000 })
  if (!ids.length) return
  await fehlendeWeg(ids)
  logLine(`[bibliothek] ${ids.length} seit ${FEHLEND_TAGE} Tagen fehlende Dateien entfernt`)
}

/**
 * Menü „Fehlende entfernen“: nach Rückfrage die fehlenden Dateien eines Ordners aus der Galerie
 * nehmen (die Dateien selbst gibt es nicht mehr). Liefert die Zahl; 0 bei „Abbrechen“.
 */
export async function fehlendeEntfernen(
  win: BrowserWindow | null,
  folderId: number
): Promise<number> {
  const n = repo.fehlende(db(), { ordner: folderId }).length
  if (!n) return 0
  const opts = {
    type: 'question' as const,
    title: 'Fehlende entfernen',
    message:
      n === 1
        ? '1 fehlende Datei aus der Galerie entfernen?'
        : `${n} fehlende Dateien aus der Galerie entfernen?`,
    detail:
      'Die Dateien gibt es im Ordner nicht mehr. Entfernt wird nur, was die Galerie zu ihnen ' +
      'gespeichert hat (Eintrag und Vorschaubild). Ohne dieses Entfernen geschieht das nach ' +
      `${FEHLEND_TAGE} Tagen von selbst.`,
    buttons: ['Entfernen', 'Abbrechen'],
    defaultId: 1,
    cancelId: 1,
    noLink: true
  }
  const { response } = win
    ? await dialog.showMessageBox(win, opts)
    : await dialog.showMessageBox(opts)
  if (response !== 0) return 0
  // nach der Rückfrage frisch: inzwischen wieder aufgetauchte bleiben (Review-Checkliste)
  const ids = repo.fehlende(db(), { ordner: folderId })
  await fehlendeWeg(ids)
  logLine(`[bibliothek] Ordner ${folderId}: ${ids.length} fehlende Dateien entfernt`)
  return ids.length
}

/** So lange darf die Prüfung einer Datei dauern (hängendes Netzlaufwerk) */
const PRUEF_MS = 5000
/** Höchstens so viele Namen nennt die Rückfrage vor dem Papierkorb */
const NAMEN_IN_RUECKFRAGE = 5

/**
 * Bilder in den Papierkorb (Schicht B): nur nach Rückfrage, die die Dateien nennt; nie in einem
 * Ordner „nur lesen“; nur, wenn die Datei noch zum Index passt; nur über den Papierkorb des
 * Systems – klappt das nicht (Netzlaufwerk, Wechseldatenträger), wird nichts endgültig gelöscht.
 * Danach sind Index-Zeilen, Vorschaubilder und Umrechnungen weg.
 */
export async function inPapierkorb(
  win: BrowserWindow | null,
  ids: readonly number[]
): Promise<TrashResult> {
  const zeilen = repo.vorschauZeilen(db(), ids)
  const nurLesen = zeilen.filter((z) => z.mode === 'nur-lesen')
  const ziel = zeilen.filter((z) => z.mode !== 'nur-lesen')
  const hinweisNurLesen = nurLesen.length
    ? `${nurLesen.length === 1 ? '1 Bild liegt' : `${nurLesen.length} Bilder liegen`} in einem Ordner „nur lesen“ – dort löscht die Galerie nichts.`
    : null
  if (!ziel.length) return { moved: 0, failed: 0, cancelled: false, refused: hinweisNurLesen }
  const namen = ziel.slice(0, NAMEN_IN_RUECKFRAGE).map((z) => z.name)
  const opts = {
    type: 'warning' as const,
    title: 'In den Papierkorb',
    message:
      ziel.length === 1
        ? `„${ziel[0].name}“ in den Papierkorb verschieben?`
        : `${ziel.length} Bilder in den Papierkorb verschieben?`,
    detail: [
      ...(ziel.length > 1 ? [namen.join(', ') + (ziel.length > namen.length ? ', …' : '')] : []),
      'Aus dem Papierkorb von Windows lassen sie sich wiederherstellen.',
      ...(hinweisNurLesen ? [hinweisNurLesen] : [])
    ].join('\n\n'),
    buttons: ['In den Papierkorb', 'Abbrechen'],
    defaultId: 1,
    cancelId: 1,
    noLink: true
  }
  const { response } = win
    ? await dialog.showMessageBox(win, opts)
    : await dialog.showMessageBox(opts)
  if (response !== 0) return { moved: 0, failed: 0, cancelled: true, refused: hinweisNurLesen }
  const verschoben: number[] = []
  let gescheitert = 0
  // nach der Rückfrage frisch lesen: inzwischen „nur lesen“, Ordner entfernt oder Datei neu
  // eingelesen? Dann zählt der neue Stand (Review-Checkliste, „Zustand nach await“)
  const jetzt = repo
    .vorschauZeilen(
      db(),
      ziel.map((z) => z.id)
    )
    .filter((z) => z.mode !== 'nur-lesen')
  gescheitert += ziel.length - jetzt.length
  for (const z of jetzt) {
    const pfad = join(z.ordner, ...z.rel_path.split('/'))
    try {
      // inzwischen geändert oder verschoben? Dann nicht anfassen (Zeitlimit: Netzlaufwerk)
      await mitZeitlimit(pruefeDatei(pfad, z.ordner, z.size, z.mtime), PRUEF_MS)
      await shell.trashItem(pfad)
      verschoben.push(z.id)
    } catch (err) {
      gescheitert++
      logLine(
        '[bibliothek] Papierkorb gescheitert:',
        z.id,
        (err as NodeJS.ErrnoException).code ?? ''
      )
    }
  }
  if (verschoben.length) {
    repo.bilderEntfernen(db(), verschoben)
    anzeigeVerwerfen(verschoben)
    await vorschauVerwerfen(verschoben)
    logLine(`[bibliothek] ${verschoben.length} Bilder in den Papierkorb`)
    melden()
  }
  return {
    moved: verschoben.length,
    failed: gescheitert,
    cancelled: false,
    refused: hinweisNurLesen
  }
}

export { beiFokus } from './ueberwachen'

// ── Start und Ende ────────────────────────────────────────────────────────────────────────────

/** Beim Start: Index öffnen, alle Ordner im Hintergrund abgleichen, offene Metadaten lesen. */
export function bibliothekStarten(): void {
  // neuer Schlüssel (kein sicherer Speicher, Konto gewechselt): Cache leer – neu erzeugen lassen
  if (vorschauSchluesselLaden()) {
    const n = repo.vorschauAlleOffen(db())
    if (n) logLine(`[vorschau] neuer Schlüssel – ${n} Vorschaubilder entstehen neu`)
  }
  // neue Ortsdaten (anderer Stand): Orte aus GPS neu bestimmen – beim Nachlesen
  const stand = orteStand()
  if (stand && repo.kvLesen(db(), 'orte_stand') !== stand) {
    const n = repo.orteNeuBestimmen(db())
    repo.kvSchreiben(db(), 'orte_stand', stand)
    if (n) logLine(`[bibliothek] Ortsdaten ${stand} – ${n} Orte werden neu bestimmt`)
  }
  for (const o of repo.ordnerListe(db())) einreihen(o.id)
  metadatenAnstossen()
  vorschauenAnstossen()
  void fehlendeAufraeumen()
  fehlendTakt = setInterval(() => void fehlendeAufraeumen(), FEHLEND_PRUEFEN_MS)
  fehlendTakt.unref()
}

export function bibliothekBeenden(): void {
  beendet = true
  if (fehlendTakt) clearInterval(fehlendTakt)
  ueberwachenBeenden()
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
  return ordnerAufnehmen(pfad, 'Der Ordner ist gerade nicht erreichbar.')
}

/**
 * Ordner per Drag & Drop: Die Pfade hat der Preload aus den gezogenen Datei-Objekten gelesen
 * (webUtils.getPathForFile) – die Seite selbst kann keinen Pfad vorgeben. Geprüft wird wie beim
 * Dialog; eine gezogene Datei statt eines Ordners wird mit Hinweis abgelehnt. Nacheinander, damit
 * zwei gezogene Ordner, die ineinander liegen, als Überlappung erkannt werden.
 */
export async function ordnerHinzufuegenGezogen(
  pfade: readonly string[]
): Promise<AddFolderResult[]> {
  const out: AddFolderResult[] = []
  for (const pfad of pfade) {
    out.push(
      await ordnerAufnehmen(
        pfad,
        `„${anzeigeName(pfad)}“ ist kein Ordner oder gerade nicht erreichbar – nur Ordner lassen sich hinzufügen.`
      )
    )
  }
  return out
}

/** Gewählten oder gezogenen Ordner prüfen und aufnehmen. */
async function ordnerAufnehmen(pfad: string, nichtErreichbar: string): Promise<AddFolderResult> {
  if (!isAbsolute(pfad)) return { status: 'abgelehnt', grund: 'Ungültiger Ordner.' }
  // erreichbar UND ein Ordner (isDirReachable prüft beides, mit Zeitlimit) – zuerst, damit eine
  // gezogene Datei „kein Ordner“ heißt, nicht „liegt schon in …“
  if (!(await isDirReachable(pfad))) return { status: 'abgelehnt', grund: nichtErreichbar }
  // Überlappung erst nach dem await und direkt vor dem Eintragen: dazwischen kann ein anderer
  // Ordner dazugekommen sein (Review-Checkliste, „Zustand nach await“)
  const konflikt = ordnerKonflikt(
    pfad,
    repo.ordnerListe(db()).map((o) => o.path),
    [lokalerOrdner(), app.getPath('userData')],
    WINDOWS
  )
  if (konflikt) return { status: 'abgelehnt', grund: konfliktText(konflikt, anzeigeName) }
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
  nichtMehrUeberwachen(id)
  teile.delete(id)
  const i = warteschlange.indexOf(id)
  if (i >= 0) warteschlange.splice(i, 1)
  // Kennungen vorher merken – nach dem Löschen der Zeilen fände sie niemand mehr
  const ids = repo.ordnerKennungen(db(), id)
  const ok = repo.ordnerEntfernen(db(), id)
  logLine('[bibliothek] Ordner entfernt:', id)
  // Vorschaubilder gleich mit (Schicht D: keine Reste)
  anzeigeVerwerfen(ids)
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
