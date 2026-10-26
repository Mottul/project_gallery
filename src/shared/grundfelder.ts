// Grundfelder einer Datei aus der ExifTool-Ausgabe (-json -n -G0) – rein, getestet in
// grundfelder.test.ts. Die Werte stammen aus fremden Dateien: Typ und Grenzen prüfen, nichts
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
