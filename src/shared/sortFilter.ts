// Sortieren → SQL-Bausteine – rein, getestet in sortFilter.test.ts (Skill bibliothek-index,
// „Abfragen“). Die Beschreibung kommt aus dem Renderer und wird hier geprüft; ins SQL gelangen nur
// Spaltennamen aus der festen Liste unten, nie Text aus der Anfrage.
//
// Jede Sortierung endet mit der Kennung, damit die Reihenfolge bei Gleichstand fest ist (sonst
// springt das Raster). Absteigend kehrt die GANZE Reihenfolge um – „ab“ ist genau „auf“ rückwärts,
// und SQLite liest denselben Index von hinten. Alle Felder dieser Stufe sind nie leer (`taken_at`
// hat mindestens die Dateizeit); kommen Felder mit fehlenden Werten hinzu (Ort, Kamera), stehen
// diese immer am Ende – dafür eine eigene Spalte vorn in den Index (wie `place_missing`).
//
// Später kommen Filter und Gruppen hinzu (docs/PLAN.md, Phase 2).

export type SortFeld = 'aufnahme' | 'name' | 'geaendert' | 'groesse' | 'typ'
export type Richtung = 'auf' | 'ab'

export interface Sortierung {
  feld: SortFeld
  richtung: Richtung
}

/** Spalten je Feld (ohne die Kennung am Schluss); zu jeder gehört ein Index in db.ts. */
const SPALTEN: ReadonlyMap<SortFeld, readonly string[]> = new Map([
  ['aufnahme', ['taken_at']],
  ['name', ['name_sort']],
  ['geaendert', ['mtime']],
  ['groesse', ['size']],
  // nach Endung, darin nach Name (Index images_typ)
  ['typ', ['ext', 'name_sort']]
])

export const SORT_FELDER: readonly SortFeld[] = [...SPALTEN.keys()]
export const RICHTUNGEN: readonly Richtung[] = ['auf', 'ab']

/** Standard: nach Aufnahmedatum, älteste zuerst. */
export const STANDARD_SORTIERUNG: Sortierung = { feld: 'aufnahme', richtung: 'auf' }

/** Beschreibung aus dem Renderer prüfen; liefert eine saubere Kopie oder null. */
export function pruefeSortierung(v: unknown): Sortierung | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  const { feld, richtung } = v as Record<string, unknown>
  if (typeof feld !== 'string' || !SPALTEN.has(feld as SortFeld)) return null
  if (richtung !== 'auf' && richtung !== 'ab') return null
  return { feld: feld as SortFeld, richtung }
}

/** ORDER-BY-Ausdruck (ohne das Schlüsselwort) für eine GEPRÜFTE Sortierung. */
export function orderBy(s: Sortierung): string {
  const spalten = SPALTEN.get(s.feld)
  if (!spalten) throw new Error('Unbekanntes Sortierfeld')
  const r = s.richtung === 'ab' ? ' DESC' : ''
  return [...spalten, 'id'].map((sp) => sp + r).join(', ')
}
