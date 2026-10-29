// Ortsdaten im Bilddienst (Phase 2.2): resources/geo/orte.tsv.gz laden, gegen die Prüfsumme aus
// orte.json prüfen (Schicht F – eine untergeschobene Datei wird nicht benutzt) und als Raster-
// Index bereithalten. Geladen wird beim ersten Bedarf, einmal je Prozess (rund 0,2 s, 160.000
// Orte). Fehlt die Datei oder stimmt die Prüfsumme nicht, gibt es keine Ortsnamen – Koordinaten
// bleiben, die Sortierung nach Ort stellt die Bilder dann zu „ohne Standort“.

import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { landName, OrtsIndex, orteParsen } from '@shared/geo'

export interface OrtsAntwort {
  id: number
  /** null = kein Ort im Umkreis */
  name: string | null
  /** Ländername auf Deutsch */
  land: string | null
}

let geladen: Promise<OrtsIndex | null> | null = null

/** Ortsdaten aus `ordner` laden und prüfen; null = nicht vorhanden oder Prüfsumme falsch. */
export async function orteLaden(ordner: string): Promise<OrtsIndex | null> {
  const info = JSON.parse(await readFile(join(ordner, 'orte.json'), 'utf8')) as { sha256?: unknown }
  const daten = await readFile(join(ordner, 'orte.tsv.gz'))
  const ist = createHash('sha256').update(daten).digest('hex')
  if (typeof info.sha256 !== 'string' || ist !== info.sha256) {
    throw Object.assign(new Error('Prüfsumme der Ortsdaten stimmt nicht'), {
      code: 'ORTE_PRUEFSUMME'
    })
  }
  return new OrtsIndex(orteParsen(gunzipSync(daten).toString('utf8')))
}

/** Nächster Ort je Punkt; ohne Ortsdaten alles null. Lädt beim ersten Aufruf. */
export async function orteSuchen(
  ordner: string | null,
  punkte: readonly { id: number; lat: number; lon: number }[]
): Promise<OrtsAntwort[]> {
  geladen ??= ordner ? orteLaden(ordner).catch(() => null) : Promise.resolve(null)
  const index = await geladen
  return punkte.map((p) => {
    const o = index?.naechster(p.lat, p.lon) ?? null
    return { id: p.id, name: o?.name ?? null, land: o ? landName(o.land) : null }
  })
}
