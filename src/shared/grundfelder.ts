// Grundfelder einer Datei aus der ExifTool-Ausgabe (-json -n -G0) – rein, getestet in
// grundfelder.test.ts. Seit 2.1 auch Objektiv, Belichtung, GPS, Bewertung, Farblabel, Titel,
// Beschreibung und Stichwörter (XMP vor IPTC vor EXIF, Stichwörter aus allen zusammengeführt). Die Werte stammen aus fremden Dateien: Typ und Grenzen prüfen, nichts
// ungeprüft übernehmen (Review-Checkliste, „Fremde Eingaben“).
//
// Breite/Höhe im Index sind die AUFGERICHTETEN Maße (Review-Checkliste, „Ausrichtung“):
// ExifTool meldet die gespeicherten; bei EXIF-Ausrichtung 5–8 sind sie vertauscht.

import { aufnahmeDatum, type Aufnahme } from './dates'

/** Tags, die der Bilddienst liest (Gruppen wie mit -G0 ausgegeben). */
export const GRUNDFELD_TAGS: readonly string[] = [
  '-EXIF:DateTimeOriginal',
  '-EXIF:SubSecTimeOriginal',
  '-EXIF:OffsetTimeOriginal',
  '-EXIF:CreateDate',
  '-EXIF:SubSecTimeDigitized',
  '-EXIF:OffsetTimeDigitized',
  '-XMP:DateCreated',
  '-EXIF:Orientation',
  '-Composite:ImageSize',
  '-File:FileType',
  // Ausweich-Kennung, wenn FileType mehrere Wörter hat („Extended WEBP“ bei animiertem WebP)
  '-File:FileTypeExtension',
  '-EXIF:Make',
  '-EXIF:Model',
  // seit 2.1
  '-EXIF:LensModel',
  '-XMP:Lens',
  '-XMP:LensModel',
  '-EXIF:FNumber',
  '-EXIF:ExposureTime',
  '-EXIF:ISO',
  '-EXIF:FocalLength',
  '-Composite:GPSLatitude',
  '-Composite:GPSLongitude',
  '-Composite:GPSAltitude',
  '-XMP:GPSLatitude',
  '-XMP:GPSLongitude',
  '-XMP:Rating',
  '-EXIF:Rating',
  '-XMP:Label',
  '-XMP:Title',
  '-IPTC:ObjectName',
  '-EXIF:XPTitle',
  '-XMP:Description',
  '-IPTC:Caption-Abstract',
  '-EXIF:ImageDescription',
  '-XMP:Subject',
  '-IPTC:Keywords',
  '-EXIF:XPKeywords',
  // seit 2.2: Ort-Feld (MWG City/Country) – hat Vorrang vor dem nächsten Ort aus GPS
  '-XMP:City',
  '-IPTC:City',
  '-XMP:Country',
  '-IPTC:Country-PrimaryLocationName',
  '-XMP:CountryCode',
  '-IPTC:Country-PrimaryLocationCode',
  // ohne diese beiden erscheinen Lesefehler bei einer Tag-Auswahl gar nicht (Labor 1.2)
  '-ExifTool:Error',
  '-ExifTool:Warning'
]

export interface Grundfelder {
  breite: number | null
  hoehe: number | null
  /** EXIF-Ausrichtung 1–8 */
  ausrichtung: number | null
  /** Format nach Inhalt (ExifTool FileType, klein): jpeg, png, … – kann von der Endung abweichen */
  format: string | null
  kameraHersteller: string | null
  kameraModell: string | null
  objektiv: string | null
  /** Blendenzahl (f/…) */
  blende: number | null
  /** Belichtungszeit in Sekunden */
  belichtung: number | null
  iso: number | null
  /** Brennweite in mm */
  brennweite: number | null
  /** Standort in Dezimalgrad (Süd/West negativ); null = keiner (auch 0/0 ohne Höhe) */
  gps: { breite: number; laenge: number; hoehe: number | null } | null
  /** 0–5 */
  bewertung: number | null
  farblabel: string | null
  titel: string | null
  beschreibung: string | null
  stichwoerter: string[]
  /** Ort aus den Metadaten (City, Land als Text oder ISO-Code); null = keiner eingetragen */
  ortMeta: { name: string; land: string | null; landCode: string | null } | null
  aufnahme: Aufnahme
  /** Lesefehler von ExifTool (Datei leer, nicht lesbar …) */
  fehler: string | null
}

/** Höchste plausible Kantenlänge in Pixeln (größer = kaputte Angabe) */
const MAX_KANTE = 1_000_000

function text(v: unknown, max = 64): string | null {
  if (typeof v !== 'string' && typeof v !== 'number') return null
  // Steuerzeichen (auch NUL am Ende von EXIF-Texten) weg, Leerraum zusammenfassen
  const t = String(v)
    .replace(/[\p{Cc}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return t ? t.slice(0, max) : null
}

/** Zahl in [min, max], sonst null (fremde Werte: „inf“, Text, Unsinn) */
function zahl(v: unknown, min: number, max: number): number | null {
  if (typeof v !== 'number' && typeof v !== 'string') return null
  const n = Number(v)
  return Number.isFinite(n) && n >= min && n <= max ? n : null
}

/** Erster brauchbarer Text aus mehreren Quellen (Rangfolge) */
function ersterText(werte: unknown[], max: number): string | null {
  for (const v of werte) {
    const t = text(v, max)
    if (t) return t
  }
  return null
}

/** Höchstens so viele Stichwörter je Datei, je höchstens so lang */
const STICHWORT_MAX = 200
const STICHWORT_LAENGE = 100

/** Stichwörter aus XMP, IPTC und Windows (XPKeywords, „;“-getrennt) – zusammengeführt, ohne Doppelte. */
function stichwoerterAus(r: Record<string, unknown>): string[] {
  const roh = [r['XMP:Subject'], r['IPTC:Keywords']].flatMap((v) => (Array.isArray(v) ? v : [v]))
  const xp = r['EXIF:XPKeywords']
  if (typeof xp === 'string') roh.push(...xp.split(';'))
  const out: string[] = []
  const gesehen = new Set<string>()
  for (const v of roh) {
    const t = text(v, STICHWORT_LAENGE)
    if (!t || gesehen.has(t.toLowerCase())) continue
    gesehen.add(t.toLowerCase())
    out.push(t)
    if (out.length >= STICHWORT_MAX) break
  }
  return out
}

/** Standort: Composite (EXIF mit Ref, vorzeichenrichtig) vor XMP; 0/0 gilt als keiner. */
function gpsAus(r: Record<string, unknown>): Grundfelder['gps'] {
  const breite = zahl(r['Composite:GPSLatitude'], -90, 90) ?? zahl(r['XMP:GPSLatitude'], -90, 90)
  const laenge =
    zahl(r['Composite:GPSLongitude'], -180, 180) ?? zahl(r['XMP:GPSLongitude'], -180, 180)
  if (breite === null || laenge === null) return null
  const hoehe = zahl(r['Composite:GPSAltitude'], -1000, 100_000)
  if (breite === 0 && laenge === 0 && hoehe === null) return null
  return { breite, laenge, hoehe }
}

function kante(v: string | undefined): number | null {
  const n = Number(v)
  return Number.isInteger(n) && n > 0 && n <= MAX_KANTE ? n : null
}

/** Grundfelder aus einem ExifTool-Ergebnis; `roh` null = Datei nicht gelesen. */
export function grundfelderAus(
  roh: Record<string, unknown> | null,
  datei: { btime: number | null; mtime: number },
  jetzt = Date.now()
): Grundfelder {
  const r = roh ?? {}
  const o = Number(r['EXIF:Orientation'])
  const ausrichtung = Number.isInteger(o) && o >= 1 && o <= 8 ? o : null
  // „6000 4000“ (mit -n) oder „6000x4000“
  const groesse = /^\s*(\d+)\s*[x ]\s*(\d+)\s*$/i.exec(String(r['Composite:ImageSize'] ?? ''))
  let breite = kante(groesse?.[1])
  let hoehe = kante(groesse?.[2])
  if (breite && hoehe && ausrichtung && ausrichtung >= 5) [breite, hoehe] = [hoehe, breite]
  const typ = [text(r['File:FileType'], 16), text(r['File:FileTypeExtension'], 16)].find(
    (t) => t && /^[a-z0-9]+$/i.test(t)
  )
  return {
    breite: breite && hoehe ? breite : null,
    hoehe: breite && hoehe ? hoehe : null,
    ausrichtung,
    format: typ ? typ.toLowerCase() : null,
    kameraHersteller: text(r['EXIF:Make']),
    kameraModell: text(r['EXIF:Model']),
    objektiv: ersterText([r['EXIF:LensModel'], r['XMP:Lens'], r['XMP:LensModel']], 100),
    blende: zahl(r['EXIF:FNumber'], 0.5, 128),
    belichtung: zahl(r['EXIF:ExposureTime'], 1e-6, 86_400),
    iso: (() => {
      const n = zahl(r['EXIF:ISO'], 1, 10_000_000)
      return n === null ? null : Math.round(n)
    })(),
    brennweite: zahl(r['EXIF:FocalLength'], 0.1, 10_000),
    gps: gpsAus(r),
    bewertung: (() => {
      const n = zahl(r['XMP:Rating'] ?? r['EXIF:Rating'], 0, 5)
      return n === null ? null : Math.round(n)
    })(),
    farblabel: text(r['XMP:Label'], 30),
    titel: ersterText([r['XMP:Title'], r['IPTC:ObjectName'], r['EXIF:XPTitle']], 500),
    beschreibung: ersterText(
      [r['XMP:Description'], r['IPTC:Caption-Abstract'], r['EXIF:ImageDescription']],
      2000
    ),
    stichwoerter: stichwoerterAus(r),
    ortMeta: (() => {
      const name = ersterText([r['XMP:City'], r['IPTC:City']], 100)
      if (!name) return null
      const code = ersterText([r['XMP:CountryCode'], r['IPTC:Country-PrimaryLocationCode']], 3)
      return {
        name,
        land: ersterText([r['XMP:Country'], r['IPTC:Country-PrimaryLocationName']], 100),
        landCode: code && /^[A-Za-z]{2}$/.test(code) ? code.toUpperCase() : null
      }
    })(),
    aufnahme: aufnahmeDatum(
      {
        dateTimeOriginal: r['EXIF:DateTimeOriginal'],
        subSecTimeOriginal: r['EXIF:SubSecTimeOriginal'],
        offsetTimeOriginal: r['EXIF:OffsetTimeOriginal'],
        createDate: r['EXIF:CreateDate'],
        subSecTimeDigitized: r['EXIF:SubSecTimeDigitized'],
        offsetTimeDigitized: r['EXIF:OffsetTimeDigitized'],
        xmpDateCreated: r['XMP:DateCreated']
      },
      datei,
      jetzt
    ),
    fehler: roh === null ? 'nicht gelesen' : text(r['ExifTool:Error'], 200)
  }
}
