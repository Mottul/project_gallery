// Bild für den Betrachter (bild://): Kennung im Index nachschlagen, Datei prüfen (passt zum Index,
// echter Pfad im Bibliotheksordner – Schicht C), dann das Original – oder, wenn Chromium es nicht
// zeigen kann (TIFF), eine bildschirmgroße Umrechnung aus dem Bilddienst, kurz im Arbeitsspeicher
// gehalten (nie auf der Platte). Gelesen wird nur; keine Datei des Nutzers wird verändert.

import { join } from 'node:path'
import { direktTyp } from '@shared/bild'
import { bilddienst } from '../bilddienst/client'
import { mitZeitlimit, pruefeDatei } from '../dateien/pruefeDatei'
import type { DB } from '../db'
import { logLine } from '../log'
import * as repo from './repo'

/** So lange darf die Prüfung dauern (hängendes Netzlaufwerk) */
const PRUEF_MS = 5000
/** Höchstens so viele Umrechnungen im Arbeitsspeicher; die ältesten fallen zuerst heraus */
const SPEICHER_MAX = 64 * 1024 * 1024

export type BildAntwort =
  | { art: 'datei'; pfad: string; typ: string; size: number }
  | { art: 'daten'; daten: Uint8Array }
  | { art: 'status'; status: number }

/** Fehlercodes der Prüfung → HTTP-Status für die Seite */
const STATUS = new Map<string, number>([
  ['GEAENDERT', 409],
  ['ENOENT', 404],
  ['ENOTDIR', 404],
  ['AUSSERHALB', 403],
  ['KEINE_DATEI', 403],
  ['ZEITLIMIT', 504],
  ['EACCES', 503],
  ['EPERM', 503],
  ['EBUSY', 503]
])

const speicher = new Map<string, Uint8Array>()
let speicherBytes = 0

function ablegen(key: string, daten: Uint8Array): void {
  speicher.set(key, daten)
  speicherBytes += daten.byteLength
  for (const [k, d] of speicher) {
    if (speicherBytes <= SPEICHER_MAX) break
    speicher.delete(k)
    speicherBytes -= d.byteLength
  }
}

export async function bildHolen(db: DB, id: number): Promise<BildAntwort> {
  const [z] = repo.vorschauZeilen(db, [id])
  if (!z) return { art: 'status', status: 404 }
  const pfad = join(z.ordner, ...z.rel_path.split('/'))
  try {
    await mitZeitlimit(pruefeDatei(pfad, z.ordner, z.size, z.mtime), PRUEF_MS)
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code ?? ''
    // nur Kennung und Code ins Log (Schicht D)
    if (code !== 'GEAENDERT') logLine('[bild://]', id, code || 'Fehler')
    return { art: 'status', status: STATUS.get(code) ?? 500 }
  }
  const typ = direktTyp(z.format, z.ext)
  if (typ) return { art: 'datei', pfad, typ, size: z.size }
  const key = `${z.id}:${z.size}:${z.mtime}`
  const da = speicher.get(key)
  if (da) {
    speicher.delete(key)
    speicher.set(key, da)
    return { art: 'daten', daten: da }
  }
  try {
    const r = await bilddienst.anzeige({ pfad, ordner: z.ordner, size: z.size, mtime: z.mtime })
    if (!r.daten) {
      logLine('[bild://]', id, 'nicht umrechenbar:', r.code ?? '')
      // bekannt, aber nicht darstellbar (defekt, zu groß): kein Inhalt, kein Konsolenfehler
      return { art: 'status', status: r.code === 'GEAENDERT' ? 409 : 204 }
    }
    ablegen(key, r.daten)
    return { art: 'daten', daten: r.daten }
  } catch (err) {
    logLine('[bild://]', id, 'Bilddienst:', (err as NodeJS.ErrnoException).code ?? '')
    return { art: 'status', status: 503 }
  }
}

/** Umrechnungen dieser Bilder vergessen (Papierkorb, Ordner entfernt). */
export function anzeigeVerwerfen(ids: readonly number[]): void {
  const weg = new Set(ids.map(String))
  for (const [k, d] of speicher) {
    if (!weg.has(k.slice(0, k.indexOf(':')))) continue
    speicher.delete(k)
    speicherBytes -= d.byteLength
  }
}
