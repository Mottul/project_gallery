// Bearbeitbare Metadaten (Phase 3) – rein, getestet in metaFields.test.ts. Der Renderer schickt Feld
// und Wert, nie einen Tag-Namen: Welche Tags in die Datei kommen, steht nur hier. Zuordnung und was
// je Format geht, sind gemessen (scripts/labor/exiftool-schreiben.mjs, docs/PLAN.md „Metadaten
// bearbeiten“). Bewusst einzelne Tags statt der MWG-Gruppe: So kennt das Journal je Tag den alten
// Wert, und die Nachprüfung vergleicht genau, was geschrieben wurde.

import { leseDatum, zoneNormal } from './dates'
import { gpsAus, stichwoerterAus, STICHWORT_LAENGE, STICHWORT_MAX } from './grundfelder'

export const FARBLABELS = ['Red', 'Yellow', 'Green', 'Blue', 'Purple'] as const
export type Farblabel = (typeof FARBLABELS)[number]

/** So viel liest auch der Index (grundfelder.ts) – mehr ginge beim Nachlesen verloren */
export const TITEL_MAX = 500
export const BESCHREIBUNG_MAX = 2000
export const ORT_MAX = 100
export const URHEBER_MAX = 200
export const COPYRIGHT_MAX = 500

export interface Aufnahmezeit {
  /** lokale Zeit „YYYY-MM-DDTHH:MM:SS“ wie in der Kamera */
  lokal: string
  /** Zone „+02:00“, wenn bekannt */
  offset: string | null
}

export interface Standort {
  /** Dezimalgrad, Süd und West negativ */
  breite: number
  laenge: number
}

/** Was geändert wird; ein Feld, das fehlt, bleibt unberührt. null entfernt den Wert. */
export interface MetaAenderung {
  /** 1–5, 0 = keine Bewertung */
  bewertung?: number
  farblabel?: Farblabel | null
  titel?: string | null
  /** Zeilenumbrüche sind erlaubt */
  beschreibung?: string | null
  /** ersetzt die ganze Liste; [] entfernt alle */
  stichwoerter?: string[]
  aufnahme?: Aufnahmezeit | null
  /** null entfernt alle GPS-Tags, nicht nur die Koordinaten */
  standort?: Standort | null
  ort?: string | null
  region?: string | null
  land?: string | null
  ortsteil?: string | null
  urheber?: string | null
  copyright?: string | null
}

/** Was in der Datei steht, frisch gelesen fürs Bearbeiten */
export interface MetaWerte {
  bewertung: number
  /** auch fremde Texte anderer Programme */
  farblabel: string | null
  titel: string | null
  beschreibung: string | null
  stichwoerter: string[]
  aufnahme: Aufnahmezeit | null
  standort: Standort | null
  ort: string | null
  region: string | null
  land: string | null
  ortsteil: string | null
  urheber: string | null
  copyright: string | null
}

/** Ein Tag mit neuem Wert; null = Tag entfernen, Liste = Tag mit mehreren Werten */
export interface TagWert {
  tag: string
  wert: string | number | string[] | null
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
const IPTC_MAX = {
  titel: 64,
  beschreibung: 2000,
  stichwort: 64,
  ort: 32,
  region: 32,
  land: 64,
  ortsteil: 32,
  urheber: 32,
  copyright: 128
}
const bytes = (s: string): number => new TextEncoder().encode(s).length
const iptc = (w: string | null, max: number): string | null =>
  w !== null && bytes(w) <= max ? w : null

/** Die XP-Felder von Windows speichern UCS-2 ohne Emoji (gemessen: ExifTool lässt sie weg) */
const xp = (w: string | null): string | null =>
  w === null ? null : w.replace(/[\u{10000}-\u{10FFFF}]/gu, '').trim() || null

/** Alle Tags des GPS-Blocks: „Standort entfernen“ lässt auch Zeit, Richtung und Tempo nicht stehen */
const GPS_EXIF = [
  'GPSVersionID',
  'GPSLatitudeRef',
  'GPSLatitude',
  'GPSLongitudeRef',
  'GPSLongitude',
  'GPSAltitudeRef',
  'GPSAltitude',
  'GPSTimeStamp',
  'GPSSatellites',
  'GPSStatus',
  'GPSMeasureMode',
  'GPSDOP',
  'GPSSpeedRef',
  'GPSSpeed',
  'GPSTrackRef',
  'GPSTrack',
  'GPSImgDirectionRef',
  'GPSImgDirection',
  'GPSMapDatum',
  'GPSDestLatitudeRef',
  'GPSDestLatitude',
  'GPSDestLongitudeRef',
  'GPSDestLongitude',
  'GPSDestBearingRef',
  'GPSDestBearing',
  'GPSDestDistanceRef',
  'GPSDestDistance',
  'GPSProcessingMethod',
  'GPSAreaInformation',
  'GPSDateStamp',
  'GPSDifferential',
  'GPSHPositioningError'
]
const GPS_XMP = ['GPSLatitude', 'GPSLongitude', 'GPSAltitude', 'GPSAltitudeRef']

/** „2021-06-05T14:03:02“ → „2021:06:05 14:03:02“ */
const exifDatum = (lokal: string): string => lokal.slice(0, 19).replace('T', ' ').replace(/-/g, ':')

/** Die Tags einer Änderung für dieses Format; leer, wenn es nicht beschreibbar ist. */
export function tagsFuer(a: MetaAenderung, format: string): TagWert[] {
  const k = FAEHIGKEITEN.get(format)
  if (!k) return []
  const out: TagWert[] = []
  const setze = (kann: boolean, tag: string, wert: TagWert['wert']): void => {
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
    setze(k.iptc, 'IPTC:ObjectName', iptc(a.titel, IPTC_MAX.titel))
    setze(k.exif, 'EXIF:XPTitle', xp(a.titel))
  }
  if (a.beschreibung !== undefined) {
    setze(k.xmp, 'XMP-dc:Description', a.beschreibung)
    setze(k.iptc, 'IPTC:Caption-Abstract', iptc(a.beschreibung, IPTC_MAX.beschreibung))
    setze(k.exif, 'EXIF:ImageDescription', a.beschreibung)
    // „Kommentare“ im Explorer (gemessen: er zeigt ImageDescription dort nicht)
    setze(k.exif, 'EXIF:XPComment', xp(a.beschreibung))
  }
  if (a.stichwoerter !== undefined) {
    const l = a.stichwoerter
    setze(k.xmp, 'XMP-dc:Subject', l.length ? l : null)
    const kurz = l.filter((w) => iptc(w, IPTC_MAX.stichwort) !== null)
    setze(k.iptc, 'IPTC:Keywords', kurz.length ? kurz : null)
    // ein Wort mit Emoji fehlt dort ganz: gekürzt käme es beim Lesen als zweites Stichwort zurück
    setze(k.exif, 'EXIF:XPKeywords', l.filter((w) => xp(w) === w).join(';') || null)
  }
  if (a.aufnahme !== undefined) {
    const wert = a.aufnahme && exifDatum(a.aufnahme.lokal)
    const zone = a.aufnahme?.offset ?? null
    setze(k.exif, 'EXIF:DateTimeOriginal', wert)
    setze(k.exif, 'EXIF:CreateDate', wert)
    setze(k.exif, 'EXIF:OffsetTimeOriginal', zone)
    setze(k.exif, 'EXIF:OffsetTimeDigitized', zone)
    setze(k.exif, 'EXIF:SubSecTimeOriginal', null)
    setze(k.exif, 'EXIF:SubSecTimeDigitized', null)
    setze(k.xmp, 'XMP-photoshop:DateCreated', wert && wert + (zone ?? ''))
  }
  if (a.standort === null) {
    for (const t of GPS_EXIF) setze(k.exif, `EXIF:${t}`, null)
    for (const t of GPS_XMP) setze(k.xmp, `XMP-exif:${t}`, null)
  } else if (a.standort !== undefined) {
    const { breite, laenge } = a.standort
    setze(k.exif, 'EXIF:GPSLatitude', Math.abs(breite))
    setze(k.exif, 'EXIF:GPSLatitudeRef', breite < 0 ? 'S' : 'N')
    setze(k.exif, 'EXIF:GPSLongitude', Math.abs(laenge))
    setze(k.exif, 'EXIF:GPSLongitudeRef', laenge < 0 ? 'W' : 'E')
    // die alte Höhe gehört nicht zum neuen Ort
    setze(k.exif, 'EXIF:GPSAltitude', null)
    setze(k.exif, 'EXIF:GPSAltitudeRef', null)
    setze(k.xmp, 'XMP-exif:GPSLatitude', breite)
    setze(k.xmp, 'XMP-exif:GPSLongitude', laenge)
    setze(k.xmp, 'XMP-exif:GPSAltitude', null)
    setze(k.xmp, 'XMP-exif:GPSAltitudeRef', null)
  }
  if (a.ort !== undefined) {
    setze(k.xmp, 'XMP-photoshop:City', a.ort)
    setze(k.iptc, 'IPTC:City', iptc(a.ort, IPTC_MAX.ort))
  }
  if (a.region !== undefined) {
    setze(k.xmp, 'XMP-photoshop:State', a.region)
    setze(k.iptc, 'IPTC:Province-State', iptc(a.region, IPTC_MAX.region))
  }
  if (a.land !== undefined) {
    setze(k.xmp, 'XMP-photoshop:Country', a.land)
    setze(k.iptc, 'IPTC:Country-PrimaryLocationName', iptc(a.land, IPTC_MAX.land))
    // ein alter Ländercode widerspräche dem neuen Namen
    setze(k.xmp, 'XMP-iptcCore:CountryCode', null)
    setze(k.iptc, 'IPTC:Country-PrimaryLocationCode', null)
  }
  if (a.ortsteil !== undefined) {
    setze(k.xmp, 'XMP-iptcCore:Location', a.ortsteil)
    setze(k.iptc, 'IPTC:Sub-location', iptc(a.ortsteil, IPTC_MAX.ortsteil))
  }
  if (a.urheber !== undefined) {
    setze(k.xmp, 'XMP-dc:Creator', a.urheber)
    setze(k.iptc, 'IPTC:By-line', iptc(a.urheber, IPTC_MAX.urheber))
    setze(k.exif, 'EXIF:Artist', a.urheber)
  }
  if (a.copyright !== undefined) {
    setze(k.xmp, 'XMP-dc:Rights', a.copyright)
    setze(k.iptc, 'IPTC:CopyrightNotice', iptc(a.copyright, IPTC_MAX.copyright))
    setze(k.exif, 'EXIF:Copyright', a.copyright)
  }
  return out
}

/** Schlüssel eines Tags in der Ausgabe von `-json -G0` */
export const leseSchluessel = (tag: string): string => tag.replace(/^XMP-[^:]+:/, 'XMP:')

/** Alle Tags, aus denen `werteAus` liest (samt den berechneten GPS-Werten) */
export const WERTE_TAGS: readonly TagWert[] = [
  ...tagsFuer(
    {
      bewertung: 1,
      farblabel: 'Red',
      titel: 'x',
      beschreibung: 'x',
      stichwoerter: ['x'],
      aufnahme: { lokal: '2000-01-01T00:00:00', offset: null },
      standort: null,
      ort: 'x',
      region: 'x',
      land: 'x',
      ortsteil: 'x',
      urheber: 'x',
      copyright: 'x'
    },
    'jpeg'
  ).map(({ tag }) => ({ tag, wert: null })),
  { tag: 'Composite:GPSLatitude', wert: null },
  { tag: 'Composite:GPSLongitude', wert: null },
  { tag: 'Composite:GPSAltitude', wert: null }
]

/** Erster Text; anders als im Index bleiben Zeilenumbrüche – es wird ja bearbeitet. */
function ersterText(...werte: unknown[]): string | null {
  for (const w of werte) {
    const v = Array.isArray(w) ? w.join('; ') : w
    const t = typeof v === 'number' ? String(v) : typeof v === 'string' ? v.trim() : ''
    if (t) return t
  }
  return null
}

/** Die bearbeitbaren Felder aus der ExifTool-Ausgabe (Rangfolge wie im Index: XMP, IPTC, EXIF). */
export function werteAus(r: Record<string, unknown>, jetzt = Date.now()): MetaWerte {
  const bewertung = Number(r['XMP:Rating'] ?? r['EXIF:Rating'] ?? 0)
  const original = leseDatum(r['EXIF:DateTimeOriginal'], {
    zone: r['EXIF:OffsetTimeOriginal'],
    jetzt
  })
  const digital = leseDatum(r['EXIF:CreateDate'], { zone: r['EXIF:OffsetTimeDigitized'], jetzt })
  const datum = original ?? digital ?? leseDatum(r['XMP:DateCreated'], { jetzt })
  const gps = gpsAus(r)
  return {
    bewertung: Number.isInteger(bewertung) && bewertung >= 0 && bewertung <= 5 ? bewertung : 0,
    farblabel: ersterText(r['XMP:Label']),
    titel: ersterText(r['XMP:Title'], r['IPTC:ObjectName'], r['EXIF:XPTitle']),
    beschreibung: ersterText(
      r['XMP:Description'],
      r['IPTC:Caption-Abstract'],
      r['EXIF:ImageDescription'],
      r['EXIF:XPComment']
    ),
    stichwoerter: stichwoerterAus(r),
    aufnahme: datum && { lokal: datum.lokal.slice(0, 19), offset: datum.offset },
    standort: gps && { breite: gps.breite, laenge: gps.laenge },
    ort: ersterText(r['XMP:City'], r['IPTC:City']),
    region: ersterText(r['XMP:State'], r['IPTC:Province-State']),
    land: ersterText(r['XMP:Country'], r['IPTC:Country-PrimaryLocationName']),
    ortsteil: ersterText(r['XMP:Location'], r['IPTC:Sub-location']),
    urheber: ersterText(r['XMP:Creator'], r['IPTC:By-line'], r['EXIF:Artist']),
    copyright: ersterText(r['XMP:Rights'], r['IPTC:CopyrightNotice'], r['EXIF:Copyright'])
  }
}

const liste = (v: unknown): string[] =>
  v === undefined || v === null || v === '' ? [] : (Array.isArray(v) ? v : [v]).map(String)

function gleich(soll: TagWert['wert'], ist: unknown): boolean {
  if (soll === null) return ist === undefined || ist === null || ist === ''
  if (Array.isArray(soll)) return JSON.stringify(soll) === JSON.stringify(liste(ist))
  if (String(soll) === String(ist)) return true
  // ExifTool gibt zahlenartigen Text als Zahl aus („1.50“ kommt als 1.5), GPS hat Rundungsfehler
  return typeof ist === 'number' && Math.abs(Number(soll) - ist) < 1e-6
}

/** Die Tags, deren Wert nicht wie gewollt in der Datei steht (leer = alles richtig). */
export function abweichend(soll: readonly TagWert[], ist: Record<string, unknown>): string[] {
  return soll.filter((t) => !gleich(t.wert, ist[leseSchluessel(t.tag)])).map((t) => t.tag)
}

/** Die vorhandenen Werte dieser Tags als Liste – was das Journal für Rückgängig braucht. */
export function alteWerte(tags: readonly TagWert[], ist: Record<string, unknown>): TagWert[] {
  return tags.map(({ tag }) => {
    const w = ist[leseSchluessel(tag)]
    if (Array.isArray(w)) return { tag, wert: w.map(String) }
    return { tag, wert: typeof w === 'string' || typeof w === 'number' ? w : null }
  })
}

function text(v: unknown, max: number, zeilen = false): string | null | undefined {
  if (v === null) return null
  if (typeof v !== 'string' || v.length > max) return undefined
  // Steuerzeichen nie; Zeilenumbruch und Tabulator nur, wo das Feld sie erlaubt
  if (/\p{Cc}/u.test(zeilen ? v.replace(/[\n\r\t]/g, '') : v)) return undefined
  return v.trim() || null
}

/** Stichwörter: ohne Doppelte; „;“ trennt sie in den XP-Feldern und kann nicht vorkommen. */
function stichwoerter(v: unknown): string[] | undefined {
  if (!Array.isArray(v) || v.length > STICHWORT_MAX) return undefined
  const out: string[] = []
  const gesehen = new Set<string>()
  for (const w of v) {
    const t = text(w, STICHWORT_LAENGE)
    if (typeof t !== 'string' || t.includes(';')) return undefined
    if (gesehen.has(t.toLowerCase())) continue
    gesehen.add(t.toLowerCase())
    out.push(t)
  }
  return out
}

/** Aufnahmezeit: gültig nach denselben Regeln wie beim Lesen, sonst käme sie nicht wieder heraus. */
function aufnahme(v: unknown): Aufnahmezeit | null | undefined {
  if (v === null) return null
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined
  const { lokal, offset } = v as Record<string, unknown>
  if (typeof lokal !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(lokal)) {
    return undefined
  }
  const zone = offset === null ? null : zoneNormal(offset)
  if (offset !== null && !zone) return undefined
  if (!leseDatum(exifDatum(lokal))) return undefined
  return { lokal, offset: zone }
}

function standort(v: unknown): Standort | null | undefined {
  if (v === null) return null
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined
  const { breite, laenge } = v as Record<string, unknown>
  if (typeof breite !== 'number' || typeof laenge !== 'number') return undefined
  if (!(Math.abs(breite) <= 90 && Math.abs(laenge) <= 180)) return undefined
  // 0/0 gilt beim Lesen als „kein Standort“
  if (breite === 0 && laenge === 0) return undefined
  return { breite, laenge }
}

/** Änderung aus dem Renderer prüfen; null = ungültig (unbekanntes Feld, Grenzen, leer). */
export function pruefeMetaAenderung(v: unknown): MetaAenderung | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  const e = v as Record<string, unknown>
  const out: MetaAenderung = {}
  const textFelder: Record<string, [keyof MetaAenderung, number, boolean?]> = {
    titel: ['titel', TITEL_MAX],
    beschreibung: ['beschreibung', BESCHREIBUNG_MAX, true],
    ort: ['ort', ORT_MAX],
    region: ['region', ORT_MAX],
    land: ['land', ORT_MAX],
    ortsteil: ['ortsteil', ORT_MAX],
    urheber: ['urheber', URHEBER_MAX],
    copyright: ['copyright', COPYRIGHT_MAX]
  }
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
    } else if (k === 'stichwoerter') {
      const l = stichwoerter(e[k])
      if (!l) return null
      out.stichwoerter = l
    } else if (k === 'aufnahme') {
      const a = aufnahme(e[k])
      if (a === undefined) return null
      out.aufnahme = a
    } else if (k === 'standort') {
      const s = standort(e[k])
      if (s === undefined) return null
      out.standort = s
    } else if (Object.hasOwn(textFelder, k)) {
      const [feld, max, zeilen] = textFelder[k]
      const t = text(e[k], max, zeilen)
      if (t === undefined) return null
      ;(out as Record<string, unknown>)[feld] = t
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
