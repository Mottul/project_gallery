// Ordner der Ortsdaten (Phase 2.2) – die einzige Stelle, die ihn kennt. Gepackt: resources/geo
// (extraResources); beim Entwickeln: resources/geo im Projekt (scripts/orte-bauen.mjs, die Daten
// liegen im Repository).

import { app } from 'electron'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export function geoOrdner(): string | null {
  const ordner = app.isPackaged
    ? join(process.resourcesPath, 'geo')
    : join(app.getAppPath(), 'resources', 'geo')
  return existsSync(join(ordner, 'orte.tsv.gz')) ? ordner : null
}

/** Stand der Ortsdaten (orte.json) – ändert er sich, werden die Orte neu bestimmt. */
export function orteStand(): string | null {
  const ordner = geoOrdner()
  if (!ordner) return null
  try {
    const info = JSON.parse(readFileSync(join(ordner, 'orte.json'), 'utf8')) as {
      stand?: unknown
      sha256?: unknown
    }
    return typeof info.sha256 === 'string'
      ? `${String(info.stand)}:${info.sha256.slice(0, 12)}`
      : null
  } catch {
    return null
  }
}
