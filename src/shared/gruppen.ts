// Gruppen-Überschriften (Phase 2.3) – rein, getestet in gruppen.test.ts. Die Gruppen folgen der
// Sortierung (entschieden 29.10.2026): nach Aufnahme- oder Änderungsdatum je Tag, Monat oder Jahr,
// nach Ort je Ort, nach Kamera je Kamera usw.; Name, Größe und die Aufnahmewerte (ISO …) haben
// keine. Der main fragt die geordneten Kennungen zusammen mit dem Gruppen-Schlüssel ab (fester
// SQL-Ausdruck von hier, nie Text aus der Anfrage) und bildet daraus die Grenzen.

import { VERZEICHNIS, type SortFeld } from './sortFilter'

export type ZeitStufe = 'tag' | 'monat' | 'jahr'
/** „aus“ = ohne Gruppen; bei Sortierungen ohne Zeit zählt jede Stufe als „an“ */
export type Gruppierung = 'aus' | ZeitStufe
export const GRUPPIERUNGEN: readonly Gruppierung[] = ['aus', 'tag', 'monat', 'jahr']

export type GruppenArt =
  'aufnahme' | 'geaendert' | 'ort' | 'kamera' | 'objektiv' | 'bewertung' | 'ordner' | 'typ'

/** Eine Gruppe: Titel und ihr Bereich in der geordneten Liste der Kennungen */
export interface Gruppe {
  titel: string
  von: number
  anzahl: number
}

const ART: Partial<Record<SortFeld, GruppenArt>> = {
  aufnahme: 'aufnahme',
  geaendert: 'geaendert',
  ort: 'ort',
  kamera: 'kamera',
  objektiv: 'objektiv',
  bewertung: 'bewertung',
  ordner: 'ordner',
  typ: 'typ'
}

/** Gruppen einer Sortierung; null = keine (Name, Größe, ISO …). */
export function gruppenArt(feld: SortFeld): GruppenArt | null {
  return Object.hasOwn(ART, feld) ? (ART[feld] ?? null) : null
}

/** Hat die Gruppierung Stufen (Tag/Monat/Jahr)? */
export const hatStufen = (art: GruppenArt): boolean => art === 'aufnahme' || art === 'geaendert'

export function pruefeGruppierung(v: unknown): Gruppierung | null {
  return typeof v === 'string' && (GRUPPIERUNGEN as readonly string[]).includes(v)
    ? (v as Gruppierung)
    : null
}

const LAENGE: Record<ZeitStufe, number> = { tag: 10, monat: 7, jahr: 4 }
const FORMAT: Record<ZeitStufe, string> = { tag: '%Y-%m-%d', monat: '%Y-%m', jahr: '%Y' }

/** SQL-Ausdruck des Gruppen-Schlüssels (NULL = „ohne …“); nur feste Texte von hier. */
export function gruppenAusdruck(art: GruppenArt, stufe: ZeitStufe): string {
  switch (art) {
    case 'aufnahme':
      return `substr(taken_at, 1, ${LAENGE[stufe]})`
    case 'geaendert':
      return `strftime('${FORMAT[stufe]}', mtime / 1000, 'unixepoch', 'localtime')`
    case 'ort':
      return `CASE WHEN place_missing THEN NULL ELSE place_name || char(1) || coalesce(place_country, '') END`
    case 'kamera':
      return `CASE WHEN camera_model IS NULL THEN NULL ELSE trim(coalesce(camera_make, '') || ' ' || camera_model) END`
    case 'objektiv':
      return 'lens'
    case 'bewertung':
      return 'rating'
    case 'ordner':
      // Bibliotheksordner und Verzeichnis der Datei
      return `(SELECT path FROM folders WHERE folders.id = images.folder_id) || char(1) || ${VERZEICHNIS}`
    case 'typ':
      return 'upper(ext)'
  }
}

const MONATE = [
  'Januar',
  'Februar',
  'März',
  'April',
  'Mai',
  'Juni',
  'Juli',
  'August',
  'September',
  'Oktober',
  'November',
  'Dezember'
]

/** Titel einer Gruppe aus ihrem Schlüssel. */
export function gruppenTitel(art: GruppenArt, schluessel: unknown): string {
  if (schluessel === null || schluessel === undefined || schluessel === '') {
    return {
      aufnahme: 'Ohne Datum',
      geaendert: 'Ohne Datum',
      ort: 'Ohne Standort',
      kamera: 'Ohne Kamera',
      objektiv: 'Ohne Objektiv',
      bewertung: 'Ohne Bewertung',
      ordner: 'Ohne Ordner',
      typ: 'Ohne Endung'
    }[art]
  }
  const k = String(schluessel)
  switch (art) {
    case 'aufnahme':
    case 'geaendert': {
      const m = /^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?$/.exec(k)
      if (!m) return k
      const monat = m[2] ? MONATE[Number(m[2]) - 1] : null
      if (m[3] && monat) return `${Number(m[3])}. ${monat} ${m[1]}`
      return monat ? `${monat} ${m[1]}` : m[1]
    }
    case 'ort':
      return k.split('\u0001').filter(Boolean).join(' · ')
    case 'bewertung': {
      const n = Number(k)
      return n === 1 ? '1 Stern' : `${n} Sterne`
    }
    case 'ordner': {
      const [ordner, verzeichnis = ''] = k.split('\u0001')
      const name = ordner.split(/[\\/]/).filter(Boolean).pop() ?? ordner
      return [name, ...verzeichnis.split('/').filter(Boolean)].join(' › ')
    }
    default:
      return k
  }
}

/** Grenzen aus den Schlüsseln in Reihenfolge der Kennungen: je Wechsel eine neue Gruppe. */
export function gruppenAus(art: GruppenArt, schluessel: readonly unknown[]): Gruppe[] {
  const out: Gruppe[] = []
  let vorher: unknown = Symbol('anfang')
  for (let i = 0; i < schluessel.length; i++) {
    const k = schluessel[i] ?? null
    if (k !== vorher) {
      out.push({ titel: gruppenTitel(art, k), von: i, anzahl: 0 })
      vorher = k
    }
    out[out.length - 1].anzahl++
  }
  return out
}
