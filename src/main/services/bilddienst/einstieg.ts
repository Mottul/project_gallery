// Einstieg des Bilddienstes: eigener Prozess (utilityProcess), gestartet von client.ts.
// Eine präparierte Datei, ein abstürzender Dekoder oder ein hängendes Netzlaufwerk trifft so nur
// diesen Prozess – main und Fenster laufen weiter (docs/PLAN.md, „Bildarbeit im eigenen Prozess“).
// Hier laufen der Scan, das Überwachen der Ordner (fs.watch), ExifTool (Pool im -stay_open-
// Betrieb) und die Vorschaubilder (sharp, BMP über ffmpeg). Für den Dienst gelten dieselben
// Lint-Regeln wie für den main (kein Netz).

import { realpath } from 'node:fs/promises'
import { cpus } from 'node:os'
import sharp from 'sharp'
import { alleFelderAus } from '@shared/alleFelder'
import type { MetaFeld } from '@shared/types'
import { GRUNDFELD_TAGS } from '@shared/grundfelder'
import { mitZeitlimit, pruefeDatei } from '../dateien/pruefeDatei'
import { ExifToolPool, leseTags } from '../exiftool/exiftool'
import type { GefundeneDatei } from '../library/repo'
import {
  ARG_EXIFTOOL,
  STAPEL,
  vorschauParallel,
  type AnDienst,
  type MetaDatei,
  type AnzeigeDatei,
  type VomDienst,
  type VorschauDatei
} from './protokoll'
import { Beobachter, istNetzpfad } from './beobachter'
import { orteSuchen } from './orte'
import { scanne, scanneTeile } from './scan'
import { anzeigeFuer, vorschauFuer, type Einrichtung } from './vorschau'

// sharp wie im Labor: Datei-Cache aus (Windows sperrte sonst gelesene Bilder), je Bild ein
// libvips-Thread, mehrere Bilder parallel (UV_THREADPOOL_SIZE setzt der Client beim Start)
sharp.cache({ files: 0 })
sharp.concurrency(1)
const PARALLEL = vorschauParallel()
/** Schlüssel, Cache-Ordner, ffmpeg – kommt als erste Nachricht vom main */
let einrichtung: Einrichtung | null = null

const port = process.parentPort
const abgebrochen = new Set<number>()

const exiftoolBin =
  process.argv.find((a) => a.startsWith(ARG_EXIFTOOL))?.slice(ARG_EXIFTOOL.length) || null
let pool: ExifToolPool | null = null

/** Zahl der ExifTool-Prozesse: halbe Kernzahl, höchstens 4 (Labor: 4 lesen 567 Dateien/s). */
function poolGroesse(): number {
  return Math.min(4, Math.max(1, Math.floor(cpus().length / 2)))
}

function senden(n: VomDienst): void {
  port.postMessage(n)
}

function fehler(auftrag: number, err: unknown): void {
  const e = err as NodeJS.ErrnoException
  senden({
    typ: 'fehler',
    auftrag,
    code: e?.code ?? 'UNBEKANNT',
    meldung: String(e?.message ?? err)
  })
}

/** Ganzer Ordner (teil = null) oder Teil-Scan der gemeldeten Pfade */
async function scan(
  auftrag: number,
  wurzel: string,
  teil: { pfade: string[]; dateien: string[] } | null
): Promise<void> {
  try {
    const onStapel = (dateien: GefundeneDatei[]): void =>
      senden({ typ: 'stapel', auftrag, dateien })
    const opts = { stapelGroesse: STAPEL, abgebrochen: () => abgebrochen.has(auftrag) }
    const r = teil
      ? await scanneTeile(wurzel, teil.pfade, teil.dateien, onStapel, opts)
      : await scanne(wurzel, onStapel, opts)
    senden({ typ: 'fertig', auftrag, gefunden: r.gefunden, unlesbar: r.unlesbar })
  } catch (err) {
    fehler(auftrag, err)
  } finally {
    abgebrochen.delete(auftrag)
  }
}

/** Ordner der Ortsdaten (kommt mit „einrichten“) */
let geoOrdner: string | null = null

/** Nächster Ort zu Koordinaten (lädt die Ortsdaten beim ersten Mal) */
async function orte(
  auftrag: number,
  punkte: { id: number; lat: number; lon: number }[]
): Promise<void> {
  try {
    senden({ typ: 'orte-ergebnis', auftrag, orte: await orteSuchen(geoOrdner, punkte) })
  } catch (err) {
    fehler(auftrag, err)
  }
}

/** Überwachte Ordner (Kennung im Index → Wächter) */
const beobachter = new Map<number, Beobachter>()

/** Der Dienst liest gleich diese Dateien: den Wächtern sagen (Windows meldet Lesen als „change“). */
function gelesenMerken(dateien: readonly { pfad: string; size: number; mtime: number }[]): void {
  for (const b of beobachter.values())
    for (const d of dateien) b.gelesenMerken(d.pfad, d.size, d.mtime)
}

/**
 * Ordner überwachen. Ein Netzlaufwerk (UNC-Pfad, auch ein verbundenes Laufwerk – realpath liefert
 * dort \\server\freigabe) bleibt unbeobachtet: Änderungsmeldungen über SMB sind unzuverlässig und
 * reißen bei jeder Verbindungsstörung ab; der main gleicht es periodisch ab.
 */
async function beobachten(auftrag: number, ordner: number, wurzel: string): Promise<void> {
  try {
    beobachter.get(ordner)?.schliessen()
    beobachter.delete(ordner)
    const netz = istNetzpfad(wurzel) || istNetzpfad(await realpath(wurzel))
    if (!netz) {
      const b = new Beobachter(wurzel, (meldung) => {
        if (meldung.art === 'weg') beobachter.delete(ordner)
        senden({ typ: 'aenderung', ordner, meldung })
      })
      b.starten()
      beobachter.set(ordner, b)
    }
    senden({ typ: 'beobachtet', auftrag, netz })
  } catch (err) {
    fehler(auftrag, err)
  }
}

/** `liste` mit höchstens `n` gleichzeitig abarbeiten; Ergebnisse in Reihenfolge. */
async function nebenlaeufig<T, R>(
  liste: readonly T[],
  n: number,
  f: (x: T) => Promise<R>
): Promise<R[]> {
  const out: R[] = new Array(liste.length)
  let i = 0
  await Promise.all(
    Array.from({ length: Math.min(n, liste.length) }, async () => {
      while (i < liste.length) {
        const k = i++
        out[k] = await f(liste[k])
      }
    })
  )
  return out
}

async function vorschau(auftrag: number, dateien: VorschauDatei[]): Promise<void> {
  try {
    const e = einrichtung
    if (!e) throw Object.assign(new Error('nicht eingerichtet'), { code: 'NICHT_EINGERICHTET' })
    gelesenMerken(dateien)
    const ergebnisse = await nebenlaeufig(dateien, PARALLEL, (d) => vorschauFuer(d, e))
    if (abgebrochen.has(auftrag)) return
    senden({ typ: 'vorschau-ergebnis', auftrag, ergebnisse })
  } catch (err) {
    fehler(auftrag, err)
  } finally {
    abgebrochen.delete(auftrag)
  }
}

async function anzeige(auftrag: number, datei: AnzeigeDatei): Promise<void> {
  gelesenMerken([datei])
  const ergebnis = await anzeigeFuer(datei)
  if (abgebrochen.has(auftrag)) return
  abgebrochen.delete(auftrag)
  senden({ typ: 'anzeige-ergebnis', auftrag, ergebnis })
}

/**
 * „Alle Felder“ einer Datei (Info-Panel): erst dieselbe Prüfung wie vor jedem Lesen, dann
 * ExifTool mit lesbaren Werten (ohne -n), Gruppen der Familie 1, auch doppelte Tags.
 */
async function alleFelder(auftrag: number, datei: AnzeigeDatei): Promise<void> {
  let felder: MetaFeld[] | null = null
  try {
    if (!exiftoolBin) throw Object.assign(new Error('ExifTool fehlt'), { code: 'KEIN_EXIFTOOL' })
    await mitZeitlimit(pruefeDatei(datei.pfad, datei.ordner, datei.size, datei.mtime), 5000)
    pool ??= new ExifToolPool(exiftoolBin, poolGroesse())
    gelesenMerken([datei])
    const a = await pool.ausfuehren(['-json', '-G1', '-a', '-s', datei.pfad])
    const liste: unknown = JSON.parse(a.ausgabe || '[]')
    if (Array.isArray(liste)) felder = alleFelderAus(liste[0])
  } catch {
    // nicht lesbar (geändert, fehlt, ExifTool fehlt): felder bleibt null
  }
  if (abgebrochen.has(auftrag)) return
  abgebrochen.delete(auftrag)
  senden({ typ: 'alle-felder-ergebnis', auftrag, felder })
}

async function meta(auftrag: number, dateien: MetaDatei[]): Promise<void> {
  try {
    if (!exiftoolBin) throw Object.assign(new Error('ExifTool fehlt'), { code: 'KEIN_EXIFTOOL' })
    pool ??= new ExifToolPool(exiftoolBin, poolGroesse())
    gelesenMerken(dateien)
    const r = await leseTags(
      pool,
      dateien.map((d) => d.pfad),
      GRUNDFELD_TAGS
    )
    if (abgebrochen.has(auftrag)) return
    senden({
      typ: 'meta-ergebnis',
      auftrag,
      ergebnisse: dateien.map((d) => ({ id: d.id, roh: r.get(d.pfad) ?? null }))
    })
  } catch (err) {
    fehler(auftrag, err)
  } finally {
    abgebrochen.delete(auftrag)
  }
}

port.on('message', (e: { data: AnDienst }) => {
  const n = e.data
  if (n.typ === 'einrichten') {
    einrichtung = { schluessel: n.schluessel, cacheOrdner: n.cacheOrdner, ffmpeg: n.ffmpeg }
    geoOrdner = n.geo
  } else if (n.typ === 'scan') void scan(n.auftrag, n.wurzel, null)
  else if (n.typ === 'teilscan')
    void scan(n.auftrag, n.wurzel, { pfade: n.pfade, dateien: n.dateien })
  else if (n.typ === 'beobachten') void beobachten(n.auftrag, n.ordner, n.wurzel)
  else if (n.typ === 'nicht-beobachten') {
    beobachter.get(n.ordner)?.schliessen()
    beobachter.delete(n.ordner)
  } else if (n.typ === 'meta') void meta(n.auftrag, n.dateien)
  else if (n.typ === 'vorschau') void vorschau(n.auftrag, n.dateien)
  else if (n.typ === 'anzeige') void anzeige(n.auftrag, n.datei)
  else if (n.typ === 'alle-felder') void alleFelder(n.auftrag, n.datei)
  else if (n.typ === 'orte') void orte(n.auftrag, n.punkte)
  else if (n.typ === 'abbrechen') abgebrochen.add(n.auftrag)
  else if (n.typ === 'beenden') {
    for (const b of beobachter.values()) b.schliessen()
    // ExifTool-Prozesse sauber beenden (stay_open False). Stirbt der Dienst hart, enden sie von
    // selbst, sobald ihre Eingabe endet (geprüft mit hartem Kill) – sauber ist trotzdem besser.
    pool?.beenden()
    setTimeout(() => process.exit(0), 300)
  }
})

process.on('exit', () => pool?.beenden())

senden({
  typ: 'log',
  text:
    `Bilddienst bereit (pid ${process.pid}, ExifTool ${exiftoolBin ? 'vorhanden' : 'fehlt'}, ` +
    `libvips ${sharp.versions.vips}, Vorschaubilder ${PARALLEL} parallel)`
})
