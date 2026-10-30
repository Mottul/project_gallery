// Filter und Suche der Galerie (Phase 2.4) – rein, getestet in bildFilter.test.ts. Der Renderer
// schickt eine Beschreibung (`BildFilter`), der main prüft sie (`pruefeBildFilter`) und baut daraus
// eine SQL-Bedingung mit Platzhaltern (`filterBedingung`): Spalten und Ausdrücke nur von hier,
// Werte nur als Parameter. Innerhalb eines Kriteriums „oder“ (Kamera A oder B), zwischen den
// Kriterien „und“ (wie die Filterleiste von Lightroom). Die Suche geht über FTS5 (`images_fts`,
// Migration 6) – Name, Titel, Beschreibung, Stichwörter, Ort; jedes Wort als Präfix.

import { gruppenAusdruck } from './gruppen'

export type Ausrichtung = 'hoch' | 'quer' | 'quadrat'
export type Standort = 'mit' | 'ohne'

export interface BildFilter {
  /** Aufnahme ab diesem Tag (einschließlich), „JJJJ-MM-TT“ */
  von?: string
  /** Aufnahme bis zu diesem Tag (einschließlich) */
  bis?: string
  /** Bewertung mindestens (1–5) */
  bewertung?: number
  /** Farblabel, wie im Index (z. B. „Red“) */
  farben?: string[]
  /** Kamera „Hersteller Modell“ (wie die Gruppen-Überschrift) */
  kameras?: string[]
  /** Ort-Schlüssel „Ort\u0001Land“ (wie die Gruppen) */
  orte?: string[]
  stichwoerter?: string[]
  /** Format nach Inhalt (z. B. „jpeg“) */
  formate?: string[]
  ausrichtung?: Ausrichtung
  /** mit oder ohne GPS-Koordinaten */
  standort?: Standort
  /** Volltext (Name, Titel, Beschreibung, Stichwörter, Ort) */
  suche?: string
}

export const LISTEN = ['farben', 'kameras', 'orte', 'stichwoerter', 'formate'] as const
export type ListenFeld = (typeof LISTEN)[number]

/** Grenzen: Einträge je Liste, Länge eines Eintrags, Länge der Suche, Wörter der Suche */
export const LISTE_MAX = 100
export const WERT_MAX = 200
export const SUCHE_MAX = 200
const WOERTER_MAX = 10

const TAG = /^(\d{4})-(\d{2})-(\d{2})$/

/** Ein echter Kalendertag „JJJJ-MM-TT“ (kein 31. Februar). */
function gueltigerTag(v: unknown): v is string {
  if (typeof v !== 'string') return false
  const m = TAG.exec(v)
  if (!m) return false
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
  return d.toISOString().slice(0, 10) === v
}

/** Der Tag danach (für „bis einschließlich“ als `taken_at < Folgetag`). */
export function folgetag(tag: string): string {
  const [j, m, t] = tag.split('-').map(Number)
  return new Date(Date.UTC(j, m - 1, t + 1)).toISOString().slice(0, 10)
}

function pruefeListe(v: unknown, mitTrenner: boolean): string[] | null {
  if (!Array.isArray(v) || v.length > LISTE_MAX) return null
  const out: string[] = []
  for (const w of v) {
    if (typeof w !== 'string' || w.length < 1 || w.length > WERT_MAX) return null
    // Steuerzeichen nie – außer dem Trenner zwischen Ort und Land im Ort-Schlüssel
    const ohne = mitTrenner ? w.replaceAll('\u0001', '') : w
    if (/\p{Cc}/u.test(ohne)) return null
    if (!out.includes(w)) out.push(w)
  }
  return out
}

/**
 * Filter aus dem Renderer prüfen; liefert eine saubere Kopie (nur bekannte, gesetzte Kriterien)
 * oder null. Leere Listen und leere Suche fallen weg.
 */
export function pruefeBildFilter(v: unknown): BildFilter | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  const e = v as Record<string, unknown>
  const own = (k: string): unknown => (Object.hasOwn(e, k) ? e[k] : undefined)
  const out: BildFilter = {}
  for (const k of ['von', 'bis'] as const) {
    const t = own(k)
    if (t === undefined) continue
    if (!gueltigerTag(t)) return null
    out[k] = t
  }
  if (out.von && out.bis && out.von > out.bis) return null
  const b = own('bewertung')
  if (b !== undefined) {
    if (typeof b !== 'number' || !Number.isInteger(b) || b < 1 || b > 5) return null
    out.bewertung = b
  }
  for (const k of LISTEN) {
    const l = own(k)
    if (l === undefined) continue
    const p = pruefeListe(l, k === 'orte')
    if (!p) return null
    if (p.length) out[k] = p
  }
  const a = own('ausrichtung')
  if (a !== undefined) {
    if (a !== 'hoch' && a !== 'quer' && a !== 'quadrat') return null
    out.ausrichtung = a
  }
  const s = own('standort')
  if (s !== undefined) {
    if (s !== 'mit' && s !== 'ohne') return null
    out.standort = s
  }
  const q = own('suche')
  if (q !== undefined) {
    if (typeof q !== 'string' || q.length > SUCHE_MAX || /\p{Cc}/u.test(q)) return null
    if (q.trim()) out.suche = q.trim()
  }
  return out
}

/** Hat der Filter mindestens ein Kriterium? */
export const filterAktiv = (f: BildFilter | undefined | null): boolean =>
  !!f && Object.keys(f).length > 0

/**
 * FTS5-Ausdruck aus der Eingabe: jedes Wort in Anführungszeichen (keine Operatoren wie OR, NEAR,
 * „-“ oder „:“ aus der Eingabe) und als Präfix („pari“ findet „Paris“); alle Wörter müssen
 * vorkommen. null = nichts Suchbares.
 */
export function suchAusdruck(text: string): string | null {
  const woerter = text
    .replaceAll('"', ' ')
    .split(/\s+/)
    .map((w) => w.replace(/\p{Cc}/gu, ''))
    // nur Wörter mit Buchstaben oder Ziffern – „-“ allein wäre eine leere Phrase (FTS5-Fehler)
    .filter((w) => /[\p{L}\p{N}]/u.test(w))
    .slice(0, WOERTER_MAX)
  return woerter.length ? woerter.map((w) => `"${w.slice(0, 64)}"*`).join(' ') : null
}

/** Ausdruck für den Ort-Schlüssel und die Kamera – derselbe wie bei den Gruppen-Überschriften */
const ORT = gruppenAusdruck('ort', 'monat')
const KAMERA = gruppenAusdruck('kamera', 'monat')

const platzhalter = (n: number): string => Array.from({ length: n }, () => '?').join(', ')

/**
 * SQL-Bedingung (ohne „WHERE“) für einen geprüften Filter, Werte als Parameter in Reihenfolge.
 * Leerer Filter: leere Bedingung.
 */
export function filterBedingung(f: BildFilter): { sql: string; werte: (string | number)[] } {
  const teile: string[] = []
  const werte: (string | number)[] = []
  if (f.von) {
    teile.push('taken_at >= ?')
    werte.push(f.von)
  }
  if (f.bis) {
    teile.push('taken_at < ?')
    werte.push(folgetag(f.bis))
  }
  if (f.bewertung !== undefined) {
    teile.push('rating >= ?')
    werte.push(f.bewertung)
  }
  const liste = (ausdruck: string, l: string[] | undefined): void => {
    if (!l?.length) return
    teile.push(`${ausdruck} IN (${platzhalter(l.length)})`)
    werte.push(...l)
  }
  liste('color_label', f.farben)
  liste(KAMERA, f.kameras)
  liste(ORT, f.orte)
  liste('coalesce(format, ext)', f.formate)
  if (f.stichwoerter?.length) {
    teile.push(
      `id IN (SELECT image_id FROM keywords WHERE keyword IN (${platzhalter(f.stichwoerter.length)}))`
    )
    werte.push(...f.stichwoerter)
  }
  if (f.ausrichtung === 'hoch') teile.push('height > width')
  if (f.ausrichtung === 'quer') teile.push('width > height')
  if (f.ausrichtung === 'quadrat') teile.push('width = height')
  if (f.standort === 'mit') teile.push('gps_lat IS NOT NULL')
  if (f.standort === 'ohne') teile.push('gps_lat IS NULL')
  const such = f.suche ? suchAusdruck(f.suche) : null
  if (such) {
    teile.push('id IN (SELECT rowid FROM images_fts WHERE images_fts MATCH ?)')
    werte.push(such)
  }
  return { sql: teile.map((t) => `(${t})`).join(' AND '), werte }
}

/** Farblabel, wie Lightroom & Co. sie schreiben (englisch) – auf Deutsch; Unbekanntes bleibt. */
const FARBLABEL: Record<string, string> = {
  red: 'Rot',
  yellow: 'Gelb',
  green: 'Grün',
  blue: 'Blau',
  purple: 'Lila'
}
export const farblabelText = (l: string): string =>
  Object.hasOwn(FARBLABEL, l.toLowerCase()) ? FARBLABEL[l.toLowerCase()] : l

/** Ein Wert für eine Auswahlliste der Filterleiste (aus dem Index, mit Anzahl). */
export interface FilterWert {
  wert: string
  titel: string
  anzahl: number
}

/** Was es im gewählten Knoten gibt – für die Auswahllisten der Filterleiste. */
export interface Facetten {
  kameras: FilterWert[]
  orte: FilterWert[]
  stichwoerter: FilterWert[]
  formate: FilterWert[]
  farben: FilterWert[]
  /** frühester und spätester Aufnahmetag */
  zeitraum: { von: string | null; bis: string | null }
}
