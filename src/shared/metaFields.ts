// Bearbeitbare Metadaten (Phase 3) – rein, getestet in metaFields.test.ts. Der Renderer schickt Feld
// und Wert, nie einen Tag-Namen: Welche Tags in die Datei kommen, steht nur hier. Zuordnung und was
// je Format geht, sind gemessen (scripts/labor/exiftool-schreiben.mjs, docs/PLAN.md „Metadaten
// bearbeiten“). Bewusst einzelne Tags statt der MWG-Gruppe: So kennt das Journal je Tag den alten
// Wert, und die Nachprüfung vergleicht genau, was geschrieben wurde.

export const FARBLABELS = ['Red', 'Yellow', 'Green', 'Blue', 'Purple'] as const
export type Farblabel = (typeof FARBLABELS)[number]

/** So viel liest auch der Index (grundfelder.ts) – mehr ginge beim Nachlesen verloren */
export const TITEL_MAX = 500
export const BESCHREIBUNG_MAX = 2000

/** Was geändert wird; ein Feld, das fehlt, bleibt unberührt */
export interface MetaAenderung {
  /** 1–5, 0 = keine Bewertung */
  bewertung?: number
  /** null = kein Farblabel */
  farblabel?: Farblabel | null
  /** null = kein Titel */
  titel?: string | null
  /** null = keine Beschreibung; Zeilenumbrüche sind erlaubt */
  beschreibung?: string | null
}

/** Ein Tag mit neuem Wert; null = Tag entfernen */
export interface TagWert {
  tag: string
  wert: string | number | null
}

interface Faehigkeit {
  exif: boolean
  iptc: boolean
  xmp: boolean
}

// gemessen: IPTC nur in JPEG und TIFF sauber (PNG warnt „non-standard“), GIF kann nur XMP, BMP nichts
const FAEHIGKEITEN = new Map<string, Faehigkeit>([
  ['jpeg', { exif: true, iptc: true, xmp: true }],
  ['tiff', { exif: true, iptc: true, xmp: true }],
  ['png', { exif: true, iptc: false, xmp: true }],
  ['webp', { exif: true, iptc: false, xmp: true }],
  ['avif', { exif: true, iptc: false, xmp: true }],
  ['gif', { exif: false, iptc: false, xmp: true }]
])

/** Kann die App in dieses Format (nach Inhalt) schreiben? */
export const schreibbar = (format: string | null): boolean =>
  format !== null && FAEHIGKEITEN.has(format)

/** Windows zeigt Sterne aus RatingPercent: 1, 25, 50, 75, 99 */
const PROZENT = [0, 1, 25, 50, 75, 99]

/** IPTC begrenzt die Länge in Bytes; was nicht passt, schnitte ExifTool ab – dann lieber leer */
const IPTC_TITEL = 64
const IPTC_BESCHREIBUNG = 2000
const bytes = (s: string): number => new TextEncoder().encode(s).length
const iptc = (w: string | null, max: number): string | null =>
  w !== null && bytes(w) <= max ? w : null

/** Die XP-Felder von Windows speichern UCS-2 ohne Emoji (gemessen: ExifTool lässt sie weg) */
const xp = (w: string | null): string | null =>
  w === null ? null : w.replace(/[\u{10000}-\u{10FFFF}]/gu, '').trim() || null

/** Die Tags einer Änderung für dieses Format; leer, wenn es nicht beschreibbar ist. */
export function tagsFuer(a: MetaAenderung, format: string): TagWert[] {
  const k = FAEHIGKEITEN.get(format)
  if (!k) return []
  const out: TagWert[] = []
  const setze = (kann: boolean, tag: string, wert: string | number | null): void => {
    if (kann) out.push({ tag, wert })
  }
  if (a.bewertung !== undefined) {
    const n = a.bewertung || null
    setze(k.xmp, 'XMP-xmp:Rating', n)
    setze(k.exif, 'EXIF:Rating', n)
    setze(k.exif, 'EXIF:RatingPercent', n && PROZENT[n])
  }
  if (a.farblabel !== undefined) setze(k.xmp, 'XMP-xmp:Label', a.farblabel)
  if (a.titel !== undefined) {
    setze(k.xmp, 'XMP-dc:Title', a.titel)
    setze(k.iptc, 'IPTC:ObjectName', iptc(a.titel, IPTC_TITEL))
    setze(k.exif, 'EXIF:XPTitle', xp(a.titel))
  }
  if (a.beschreibung !== undefined) {
    setze(k.xmp, 'XMP-dc:Description', a.beschreibung)
    setze(k.iptc, 'IPTC:Caption-Abstract', iptc(a.beschreibung, IPTC_BESCHREIBUNG))
    setze(k.exif, 'EXIF:ImageDescription', a.beschreibung)
    // „Kommentare“ im Explorer (gemessen: er zeigt ImageDescription dort nicht)
    setze(k.exif, 'EXIF:XPComment', xp(a.beschreibung))
  }
  return out
}

/** Schlüssel eines Tags in der Ausgabe von `-json -G0` */
export const leseSchluessel = (tag: string): string => tag.replace(/^XMP-[^:]+:/, 'XMP:')

function gleich(soll: string | number | null, ist: unknown): boolean {
  if (soll === null) return ist === undefined || ist === null || ist === ''
  if (String(soll) === String(ist)) return true
  // ExifTool gibt zahlenartigen Text als Zahl aus: „1.50“ kommt als 1.5
  return typeof ist === 'number' && Number(soll) === ist
}

/** Die Tags, deren Wert nicht wie gewollt in der Datei steht (leer = alles richtig). */
export function abweichend(soll: readonly TagWert[], ist: Record<string, unknown>): string[] {
  return soll.filter((t) => !gleich(t.wert, ist[leseSchluessel(t.tag)])).map((t) => t.tag)
}

/** Die vorhandenen Werte dieser Tags als Liste – was das Journal für Rückgängig braucht. */
export function alteWerte(tags: readonly TagWert[], ist: Record<string, unknown>): TagWert[] {
  return tags.map(({ tag }) => {
    const w = ist[leseSchluessel(tag)]
    return { tag, wert: typeof w === 'string' || typeof w === 'number' ? w : null }
  })
}

function text(v: unknown, max: number, zeilen: boolean): string | null | undefined {
  if (v === null) return null
  if (typeof v !== 'string' || v.length > max) return undefined
  // Steuerzeichen nie; Zeilenumbruch und Tabulator nur, wo das Feld sie erlaubt
  if (/\p{Cc}/u.test(zeilen ? v.replace(/[\n\r\t]/g, '') : v)) return undefined
  return v.trim() || null
}

/** Änderung aus dem Renderer prüfen; null = ungültig (unbekanntes Feld, Grenzen, leer). */
export function pruefeMetaAenderung(v: unknown): MetaAenderung | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  const e = v as Record<string, unknown>
  const out: MetaAenderung = {}
  for (const k of Object.keys(e)) {
    if (e[k] === undefined) continue
    if (k === 'bewertung') {
      const n = e[k]
      if (typeof n !== 'number' || !Number.isInteger(n) || n < 0 || n > 5) return null
      out.bewertung = n
    } else if (k === 'farblabel') {
      const l = e[k]
      if (l !== null && !FARBLABELS.includes(l as Farblabel)) return null
      out.farblabel = l as Farblabel | null
    } else if (k === 'titel') {
      const t = text(e[k], TITEL_MAX, false)
      if (t === undefined) return null
      out.titel = t
    } else if (k === 'beschreibung') {
      const t = text(e[k], BESCHREIBUNG_MAX, true)
      if (t === undefined) return null
      out.beschreibung = t
    } else return null
  }
  return Object.keys(out).length ? out : null
}

/** Ergebnis eines Schreibauftrags */
export interface SchreibBericht<I = unknown> {
  /** Details der geschriebenen Bilder, gleich aus dem Index */
  geschrieben: I[]
  /** Was nicht ging, mit Grund für den Nutzer – die Dateien sind dann unverändert */
  fehler: { id: number; name: string; grund: string }[]
  /** Journal-Zeilen für „Rückgängig“ */
  journal: number[]
}
