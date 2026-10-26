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
// Filter (1.4): ein Bibliotheksordner, wahlweise ab einem Unterordner samt allem darunter. Der
// Pfad wird geprüft und nur als Parameter (Vergleichsschlüssel) verwendet. Weitere Filter und
// Gruppen kommen in Phase 2 (docs/PLAN.md).

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

/** Ordner-Filter: Bibliotheksordner `ordner`, ab Unterordner `pfad` („“ = ganzer Ordner) */
export interface OrdnerFilter {
  ordner: number
  /** relativ zum Ordner, „/“ als Trenner, ohne Schluss-Trenner */
  pfad: string
}

/** Höchstlänge eines Unterordner-Pfads (Windows: lange Pfade bis 32.767 Zeichen; hier großzügig) */
const PFAD_MAX = 4096

/** Filter aus dem Renderer prüfen; liefert eine saubere Kopie oder null. */
export function pruefeOrdnerFilter(v: unknown): OrdnerFilter | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  const { ordner, pfad } = v as Record<string, unknown>
  if (typeof ordner !== 'number' || !Number.isSafeInteger(ordner) || ordner < 1) return null
  if (typeof pfad !== 'string' || pfad.length > PFAD_MAX) return null
  if (pfad === '') return { ordner, pfad }
  // nur echte Unterordner: keine leeren Teile, kein „.“/„..“, kein „\“, keine Steuerzeichen
  if (/\\|\p{Cc}/u.test(pfad)) return null
  if (pfad.split('/').some((t) => t === '' || t === '.' || t === '..')) return null
  return { ordner, pfad }
}

/**
 * Bereich der Vergleichsschlüssel unter einem Unterordner: `schluessel/` ≤ rel_key < `schluessel0`
 * („0“ folgt auf „/“) – so nutzt die Abfrage den Index (folder_id, rel_key) statt LIKE.
 */
export function unterordnerBereich(schluessel: string): [string, string] {
  return [schluessel + '/', schluessel + '0']
}
