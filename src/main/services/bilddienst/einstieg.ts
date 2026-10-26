// Einstieg des Bilddienstes: eigener Prozess (utilityProcess), gestartet von client.ts.
// Eine präparierte Datei, ein abstürzender Dekoder oder ein hängendes Netzlaufwerk trifft so nur
// diesen Prozess – main und Fenster laufen weiter (docs/PLAN.md, „Bildarbeit im eigenen Prozess“).
// Hier laufen der Scan, ExifTool (Pool im -stay_open-Betrieb) und die Vorschaubilder (sharp,
// BMP über ffmpeg). Für den Dienst gelten dieselben Lint-Regeln wie für den main (kein Netz).

import { cpus } from 'node:os'
import sharp from 'sharp'
import { GRUNDFELD_TAGS } from '@shared/grundfelder'
import { ExifToolPool, leseTags } from '../exiftool/exiftool'
import {
  ARG_EXIFTOOL,
  STAPEL,
  vorschauParallel,
  type AnDienst,
  type MetaDatei,
  type VomDienst,
  type VorschauDatei
} from './protokoll'
import { scanne } from './scan'
import { vorschauFuer, type Einrichtung } from './vorschau'

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

async function scan(auftrag: number, wurzel: string): Promise<void> {
  try {
    const r = await scanne(wurzel, (dateien) => senden({ typ: 'stapel', auftrag, dateien }), {
      stapelGroesse: STAPEL,
      abgebrochen: () => abgebrochen.has(auftrag)
    })
    senden({ typ: 'fertig', auftrag, gefunden: r.gefunden, unlesbar: r.unlesbar })
  } catch (err) {
    fehler(auftrag, err)
  } finally {
    abgebrochen.delete(auftrag)
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
    const ergebnisse = await nebenlaeufig(dateien, PARALLEL, (d) => vorschauFuer(d, e))
    if (abgebrochen.has(auftrag)) return
    senden({ typ: 'vorschau-ergebnis', auftrag, ergebnisse })
  } catch (err) {
    fehler(auftrag, err)
  } finally {
    abgebrochen.delete(auftrag)
  }
}

async function meta(auftrag: number, dateien: MetaDatei[]): Promise<void> {
  try {
    if (!exiftoolBin) throw Object.assign(new Error('ExifTool fehlt'), { code: 'KEIN_EXIFTOOL' })
    pool ??= new ExifToolPool(exiftoolBin, poolGroesse())
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
  } else if (n.typ === 'scan') void scan(n.auftrag, n.wurzel)
  else if (n.typ === 'meta') void meta(n.auftrag, n.dateien)
  else if (n.typ === 'vorschau') void vorschau(n.auftrag, n.dateien)
  else if (n.typ === 'abbrechen') abgebrochen.add(n.auftrag)
  else if (n.typ === 'beenden') {
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
