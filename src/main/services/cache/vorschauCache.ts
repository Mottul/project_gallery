// Vorschaubilder im main: Cache-Ordner und Schlüssel (für den Bilddienst), Lesen mit Prüfung
// (Schicht D: manipuliert oder veraltet = löschen und neu erzeugen, nie anzeigen), Löschen und
// der Arbeitsspeicher für Ordner im Modus „privat“ (dort nie etwas auf der Platte).

import { readFile, unlink } from 'node:fs/promises'
import type { Stufe } from '@shared/vorschau'
import type { Einrichtung } from '../bilddienst/vorschau'
import { ffmpegPfad } from '../ffmpeg/ffmpegPath'
import { lokalerUnterordner } from '../lokaleDaten'
import { logLine } from '../log'
import { vorschauLoeschen, vorschauPfad } from './ablage'
import { vorschauSchluessel } from './schluessel'
import { entschluesseln, zusatzdaten } from './verschluesselung'

let schluessel: Buffer | null = null
/** Beim Laden entstand ein neuer Schlüssel (Cache geleert) */
let schluesselNeu = false

export function cacheOrdner(): string {
  return lokalerUnterordner('vorschau')
}

/** Was der Bilddienst zum Erzeugen braucht (Schlüssel einmal je Start geladen). */
export function vorschauEinrichtung(): Einrichtung {
  if (!schluessel) ({ schluessel, neu: schluesselNeu } = vorschauSchluessel(cacheOrdner()))
  return { schluessel, cacheOrdner: cacheOrdner(), ffmpeg: ffmpegPfad() }
}

/**
 * Beim Start: Schlüssel laden. true, wenn er neu ist – dann ist der Cache leer, und alles, was
 * der Index als fertig führt, muss neu entstehen.
 */
export function vorschauSchluesselLaden(): boolean {
  vorschauEinrichtung()
  return schluesselNeu
}

/** Inhaltstyp nach den ersten Bytes (die Vorschau ist WebP, wenn das Bild Transparenz hat). */
export function inhaltstyp(b: Uint8Array): 'image/webp' | 'image/jpeg' {
  return Buffer.from(b.buffer, b.byteOffset, 12).toString('latin1', 8, 12) === 'WEBP'
    ? 'image/webp'
    : 'image/jpeg'
}

/**
 * Vorschau von der Platte, geprüft gegen Bild, Stufe, Größe und Änderungszeit. Fehlt sie: null.
 * Besteht sie die Prüfung nicht (veraltet, manipuliert, anderer Schlüssel): löschen, null.
 */
export async function vorschauLesen(
  id: number,
  stufe: Stufe,
  size: number,
  mtime: number
): Promise<Buffer | null> {
  const pfad = vorschauPfad(cacheOrdner(), id, stufe)
  let daten: Buffer
  try {
    daten = await readFile(pfad)
  } catch {
    return null
  }
  const klar = entschluesseln(
    vorschauEinrichtung().schluessel,
    daten,
    zusatzdaten(id, stufe, size, mtime)
  )
  if (klar) return klar
  await unlink(pfad).catch(() => undefined)
  return null
}

/** Cache-Dateien dieser Bilder löschen (Ordner entfernt, Modus „privat“). */
export async function vorschauDateienLoeschen(ids: readonly number[]): Promise<void> {
  if (!ids.length) return
  try {
    const n = await vorschauLoeschen(cacheOrdner(), ids)
    logLine(`[vorschau] ${n} Cache-Dateien gelöscht (${ids.length} Bilder)`)
  } catch (err) {
    logLine('[vorschau] Löschen im Cache gescheitert:', (err as NodeJS.ErrnoException).code ?? '')
  }
}

// ── Arbeitsspeicher für „privat“ ──────────────────────────────────────────────────────────────

/** Höchstens so viel Vorschau im Arbeitsspeicher; die ältesten fallen zuerst heraus */
const SPEICHER_MAX = 256 * 1024 * 1024

interface Eintrag {
  gross: Uint8Array
  klein: Uint8Array
}
/** Reihenfolge der Map = zuletzt benutzt am Ende */
const speicher = new Map<string, Eintrag>()
let speicherBytes = 0
const speicherSchluessel = (id: number, size: number, mtime: number): string =>
  `${id}:${size}:${mtime}`

export function speicherLesen(
  id: number,
  stufe: Stufe,
  size: number,
  mtime: number
): Uint8Array | null {
  const k = speicherSchluessel(id, size, mtime)
  const e = speicher.get(k)
  if (!e) return null
  speicher.delete(k)
  speicher.set(k, e)
  return stufe === 768 ? e.gross : e.klein
}

export function speicherAblegen(id: number, size: number, mtime: number, e: Eintrag): void {
  speicherVerwerfen([id])
  speicher.set(speicherSchluessel(id, size, mtime), e)
  speicherBytes += e.gross.byteLength + e.klein.byteLength
  for (const [k, alt] of speicher) {
    if (speicherBytes <= SPEICHER_MAX) break
    speicher.delete(k)
    speicherBytes -= alt.gross.byteLength + alt.klein.byteLength
  }
}

/** Alle Einträge dieser Bilder (jede Fassung) aus dem Arbeitsspeicher. */
export function speicherVerwerfen(ids: readonly number[]): void {
  const weg = new Set(ids.map(String))
  for (const [k, e] of speicher) {
    if (!weg.has(k.slice(0, k.indexOf(':')))) continue
    speicher.delete(k)
    speicherBytes -= e.gross.byteLength + e.klein.byteLength
  }
}
