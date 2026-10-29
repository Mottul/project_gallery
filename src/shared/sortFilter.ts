// Sortieren → SQL-Bausteine – rein, getestet in sortFilter.test.ts (Skill bibliothek-index,
// „Abfragen“). Die Beschreibung kommt aus dem Renderer und wird hier geprüft; ins SQL gelangen nur
// Spaltennamen aus der festen Liste unten, nie Text aus der Anfrage.
//
// Jede Sortierung endet mit der Kennung, damit die Reihenfolge bei Gleichstand fest ist (sonst
// springt das Raster). Absteigend kehrt die GANZE Reihenfolge um – „ab“ ist genau „auf“ rückwärts,
// und SQLite liest denselben Index von hinten. Ausnahme „Ort“ (2.2): Bilder ohne Ort bleiben auch
// absteigend am Ende (entschieden) – dafür ein eigener Index mit DESC-Spalten. Alle Felder dieser Stufe sind nie leer (`taken_at`
// hat mindestens die Dateizeit); kommen Felder mit fehlenden Werten hinzu (Ort, Kamera), stehen
// diese immer am Ende – dafür eine eigene Spalte vorn in den Index (wie `place_missing`).
//
// Filter (1.4): ein Bibliotheksordner, wahlweise ab einem Unterordner samt allem darunter. Der
// Pfad wird geprüft und nur als Parameter (Vergleichsschlüssel) verwendet. Weitere Filter und
// Gruppen kommen in Phase 2 (docs/PLAN.md).

export type SortFeld =
  | 'aufnahme'
  | 'name'
  | 'geaendert'
  | 'groesse'
  | 'typ'
  | 'ort'
  // seit 2.3
  | 'kamera'
  | 'objektiv'
  | 'bewertung'
  | 'iso'
  | 'blende'
  | 'belichtung'
  | 'brennweite'
  | 'aufloesung'
  | 'ordner'
export type Richtung = 'auf' | 'ab'

export interface Sortierung {
  feld: SortFeld
  richtung: Richtung
}

/**
 * Je Feld die Spalten (ohne die Kennung am Schluss) und – wo Werte fehlen können – ein Ausdruck,
 * der fehlende Werte in BEIDEN Richtungen ans Ende stellt (immer aufsteigend). Nur Spalten und
 * feste Ausdrücke von hier gelangen ins SQL.
 */
/** Verzeichnis einer Datei im Bibliotheksordner („Urlaub/2024/“, „“ = direkt darin) */
export const VERZEICHNIS = 'substr(rel_path, 1, length(rel_path) - length(name))'

const FELDER: ReadonlyMap<SortFeld, { spalten: readonly string[]; fehlend?: string }> = new Map([
  ['aufnahme', { spalten: ['taken_at'] }],
  ['name', { spalten: ['name_sort'] }],
  ['geaendert', { spalten: ['mtime'] }],
  ['groesse', { spalten: ['size'] }],
  // nach Endung, darin nach Name (Index images_typ)
  ['typ', { spalten: ['ext', 'name_sort'] }],
  // Orte A–Z, darin nach Aufnahme; ohne Ort am Ende (Indizes images_ort und images_ort_ab)
  ['ort', { spalten: ['place_sort', 'taken_at'], fehlend: 'place_missing' }],
  // seit 2.3 ohne eigenen Index: bei 50.000 Zeilen sortiert SQLite im Speicher schnell genug
  // (Labor Phase 0: 36 ms; Abnahme abnahme50k misst sie mit)
  [
    'kamera',
    { spalten: ['camera_make', 'camera_model', 'taken_at'], fehlend: '(camera_model IS NULL)' }
  ],
  ['objektiv', { spalten: ['lens', 'taken_at'], fehlend: '(lens IS NULL)' }],
  ['bewertung', { spalten: ['rating', 'taken_at'], fehlend: '(rating IS NULL)' }],
  ['iso', { spalten: ['iso', 'taken_at'], fehlend: '(iso IS NULL)' }],
  ['blende', { spalten: ['aperture', 'taken_at'], fehlend: '(aperture IS NULL)' }],
  ['belichtung', { spalten: ['exposure', 'taken_at'], fehlend: '(exposure IS NULL)' }],
  ['brennweite', { spalten: ['focal', 'taken_at'], fehlend: '(focal IS NULL)' }],
  [
    'aufloesung',
    { spalten: ['(width * height)', 'taken_at'], fehlend: '(width IS NULL OR height IS NULL)' }
  ],
  [
    'ordner',
    // nach Bibliotheksordner, Verzeichnis, Datei – so liegen die Dateien eines Verzeichnisses
    // beisammen (eine Gruppen-Überschrift je Verzeichnis, gruppen.ts). Verzeichnis = rel_path ohne
    // den Namen (gemessen bei 50.000 Zeilen samt Gruppen 95 statt 151 ms mit rtrim); „/“ zählt als
    // kleinstes Zeichen, so steht „Urlaub“ samt Unterordnern vor „Urlaub-x“ wie im Ordnerbaum
    {
      spalten: [
        '(SELECT path_key FROM folders WHERE folders.id = images.folder_id)',
        `replace(${VERZEICHNIS}, '/', char(1)) COLLATE NOCASE`,
        'rel_key'
      ]
    }
  ]
])

export const SORT_FELDER: readonly SortFeld[] = [...FELDER.keys()]
/** Felder mit eigenem Index (images_*): sortieren ohne Umsortieren im Speicher */
export const INDEX_FELDER: readonly SortFeld[] = [
  'aufnahme',
  'name',
  'geaendert',
  'groesse',
  'typ',
  'ort'
]
export const RICHTUNGEN: readonly Richtung[] = ['auf', 'ab']

/** Standard: nach Aufnahmedatum, älteste zuerst. */
export const STANDARD_SORTIERUNG: Sortierung = { feld: 'aufnahme', richtung: 'auf' }

/** Beschreibung aus dem Renderer prüfen; liefert eine saubere Kopie oder null. */
export function pruefeSortierung(v: unknown): Sortierung | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  const { feld, richtung } = v as Record<string, unknown>
  if (typeof feld !== 'string' || !FELDER.has(feld as SortFeld)) return null
  if (richtung !== 'auf' && richtung !== 'ab') return null
  return { feld: feld as SortFeld, richtung }
}

/** ORDER-BY-Ausdruck (ohne das Schlüsselwort) für eine GEPRÜFTE Sortierung. */
export function orderBy(s: Sortierung): string {
  const f = FELDER.get(s.feld)
  if (!f) throw new Error('Unbekanntes Sortierfeld')
  const r = s.richtung === 'ab' ? ' DESC' : ''
  return [...(f.fehlend ? [f.fehlend] : []), ...[...f.spalten, 'id'].map((sp) => sp + r)].join(', ')
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
