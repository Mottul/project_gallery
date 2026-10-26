// Vorschaubilder erzeugen – läuft im Bilddienst (eigener Prozess), getestet mit echten
// Werkzeugen in vorschau.lab.test.ts. Verfahren aus dem Labor (docs/PLAN.md, Phase 0):
// 768 px mit fastShrinkOnLoad, daraus 256 px, Qualität 80; EXIF-Ausrichtung angewandt
// (.rotate()), Farben nach sRGB (sharp rechnet eingebettete Profile um – Labortest mit P3);
// Bilder mit Transparenz als WebP, sonst JPEG. „Defekt“ entscheidet sharp (failOn: 'truncated').
// BMP kann sharp nicht lesen: ffmpeg wandelt es zuerst in PNG (nur lokale Datei, Schicht A).

import { spawn } from 'node:child_process'
import { lstat, readFile, realpath } from 'node:fs/promises'
import sharp, { type Sharp } from 'sharp'
import { liegtIn, pfadSchluessel } from '@shared/ordnerPruefen'
import { QUALITAET } from '@shared/vorschau'
import { schreibeAtomar, vorschauPfad } from '../cache/ablage'
import { verschluesseln, zusatzdaten } from '../cache/verschluesselung'
import type { VorschauDatei, VorschauErgebnis } from './protokoll'

/** Obergrenze der Bildgröße (sharp-Vorgabe 16383², bewusst gesetzt – Skill bild-labor) */
export const MAX_PIXEL = 0x3fff * 0x3fff
/** Dateien bis zu dieser Größe liest der Dienst selbst (klare Fehlercodes, keine offene Datei) */
const MAX_LESEN = 256 * 1024 * 1024
/** Höchstens so viel PNG nimmt der Dienst von ffmpeg an */
const MAX_PNG = 512 * 1024 * 1024

export interface Vorschau {
  /** 768 px (längste Kante), JPEG oder WebP */
  gross: Buffer
  /** 256 px */
  klein: Buffer
  /** Durchschnittsfarbe „#rrggbb“ für den Platzhalter */
  farbe: string
}

export function fehler(code: string, meldung = code): Error {
  return Object.assign(new Error(meldung), { code })
}

/**
 * Passt die Datei noch zum Index und liegt sie wirklich im Bibliotheksordner? Keine Verknüpfung,
 * gleiche Größe und Änderungszeit, der echte Pfad (Junctions, Symlinks aufgelöst) im Ordner
 * (Schicht C, Skill bildschutz). Wirft mit `code`.
 */
export async function pruefeDatei(
  pfad: string,
  ordner: string,
  size: number,
  mtime: number,
  windows = process.platform === 'win32'
): Promise<void> {
  const st = await lstat(pfad)
  if (!st.isFile()) throw fehler('KEINE_DATEI')
  if (st.size !== size || Math.trunc(st.mtimeMs) !== mtime) throw fehler('GEAENDERT')
  const [echt, wurzel] = await Promise.all([realpath(pfad), realpath(ordner)])
  if (!liegtIn(pfadSchluessel(echt, windows), pfadSchluessel(wurzel, windows))) {
    throw fehler('AUSSERHALB')
  }
}

/** Inhalt zum Dekodieren: kleine Dateien als Buffer (prüft die Länge), sehr große als Pfad. */
export async function eingabeLesen(pfad: string, size: number): Promise<Buffer | string> {
  if (size > MAX_LESEN) return pfad
  const b = await readFile(pfad)
  if (b.length !== size) throw fehler('GEAENDERT')
  return b
}

/** BMP per ffmpeg in PNG umwandeln (nur `file:`, kein Netz, kein anderes Protokoll). */
export function bmpAlsPng(ffmpeg: string, pfad: string, zeitlimitMs = 30_000): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const p = spawn(
      ffmpeg,
      [
        '-hide_banner',
        '-nostdin',
        '-loglevel',
        'error',
        '-protocol_whitelist',
        'file',
        '-i',
        'file:' + pfad,
        '-frames:v',
        '1',
        '-f',
        'image2pipe',
        '-c:v',
        'png',
        'pipe:1'
      ],
      { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }
    )
    const teile: Buffer[] = []
    let laenge = 0
    let fertig = false
    const ende = (err: Error | null): void => {
      if (fertig) return
      fertig = true
      clearTimeout(uhr)
      if (err) {
        p.kill()
        reject(err)
      } else resolve(Buffer.concat(teile))
    }
    const uhr = setTimeout(() => ende(fehler('ZEITLIMIT')), zeitlimitMs)
    p.stdout.on('data', (d: Buffer) => {
      laenge += d.length
      if (laenge > MAX_PNG) ende(fehler('ZU_GROSS'))
      else teile.push(d)
    })
    // stderr nennt den Pfad – nicht weitergeben (Log ohne Inhalte)
    p.stderr.resume()
    p.on('error', (err) => ende(fehler('KEIN_FFMPEG', String(err))))
    p.on('close', (code) => ende(code === 0 && laenge > 0 ? null : fehler('DEFEKT')))
  })
}

const hex = (n: number): string => n.toString(16).padStart(2, '0')

/** Beide Stufen und die Durchschnittsfarbe; wirft bei kaputten Bildern (sharp-Fehler). */
export async function erzeugeVorschau(eingabe: Buffer | string): Promise<Vorschau> {
  const bild = sharp(eingabe, { failOn: 'truncated', limitInputPixels: MAX_PIXEL })
  const { hasAlpha } = await bild.metadata()
  const kodieren = (s: Sharp): Sharp =>
    hasAlpha
      ? s.webp({ quality: QUALITAET, alphaQuality: QUALITAET })
      : s.jpeg({ quality: QUALITAET })
  const gross = await kodieren(
    bild
      .rotate()
      .resize(768, 768, { fit: 'inside', withoutEnlargement: true, fastShrinkOnLoad: true })
  ).toBuffer()
  const klein = await kodieren(
    sharp(gross).resize(256, 256, { fit: 'inside', withoutEnlargement: true })
  ).toBuffer()
  const { data } = await sharp(klein)
    .flatten({ background: '#808080' })
    .toColourspace('srgb')
    .resize(1, 1, { fit: 'fill' })
    .raw()
    .toBuffer({ resolveWithObject: true })
  return { gross, klein, farbe: `#${hex(data[0])}${hex(data[1])}${hex(data[2])}` }
}

// ── Ein Auftrag je Datei (Bilddienst) ─────────────────────────────────────────────────────────

export interface Einrichtung {
  schluessel: Uint8Array
  cacheOrdner: string
  ffmpeg: string | null
}

/** Zeitlimit je Datei (Dekodieren); der Auftrag bleibt so unter dem Wächter des Clients (60 s) */
const ZEITLIMIT_MS = 30_000

function mitZeitlimit<T>(p: Promise<T>, ms: number): Promise<T> {
  let uhr: NodeJS.Timeout | undefined
  const ablauf = new Promise<never>((_, reject) => {
    uhr = setTimeout(() => reject(fehler('ZEITLIMIT')), ms)
  })
  return Promise.race([p, ablauf]).finally(() => clearTimeout(uhr))
}

const codeVon = (err: unknown, sonst: string): string =>
  (err as NodeJS.ErrnoException)?.code ?? sonst

/**
 * Vorschaubilder einer Datei: prüfen, lesen, erzeugen, verschlüsselt ablegen (bzw. zurückgeben).
 * Wirft nie – jeder Fehler wird zu einem Code (Fehlercodes unterscheiden: „DEFEKT“ nur, wenn
 * sharp das Bild ablehnt; Sperren, Rechte, Zeitlimit sind vorübergehend).
 */
export async function vorschauFuer(d: VorschauDatei, e: Einrichtung): Promise<VorschauErgebnis> {
  const nein = (code: string): VorschauErgebnis => ({ id: d.id, ok: false, code })
  try {
    await pruefeDatei(d.pfad, d.ordner, d.size, d.mtime)
  } catch (err) {
    return nein(codeVon(err, 'UNBEKANNT'))
  }
  let eingabe: Buffer | string
  try {
    if (d.format === 'bmp') {
      if (!e.ffmpeg) return nein('KEIN_FFMPEG')
      eingabe = await bmpAlsPng(e.ffmpeg, d.pfad, ZEITLIMIT_MS)
    } else {
      eingabe = await eingabeLesen(d.pfad, d.size)
    }
  } catch (err) {
    return nein(codeVon(err, 'UNBEKANNT'))
  }
  let v: Vorschau
  try {
    v = await mitZeitlimit(erzeugeVorschau(eingabe), ZEITLIMIT_MS)
  } catch (err) {
    if (codeVon(err, '') === 'ZEITLIMIT') return nein('ZEITLIMIT')
    return nein(/pixel limit/i.test(String((err as Error)?.message)) ? 'ZU_GROSS' : 'DEFEKT')
  }
  if (d.ziel === 'speicher')
    return { id: d.id, ok: true, farbe: v.farbe, gross: v.gross, klein: v.klein }
  try {
    for (const [stufe, daten] of [
      [768, v.gross],
      [256, v.klein]
    ] as const) {
      const aad = zusatzdaten(d.id, stufe, d.size, d.mtime)
      await schreibeAtomar(
        vorschauPfad(e.cacheOrdner, d.id, stufe),
        verschluesseln(e.schluessel, daten, aad)
      )
    }
  } catch (err) {
    return nein('CACHE_' + codeVon(err, 'FEHLER'))
  }
  return { id: d.id, ok: true, farbe: v.farbe }
}
