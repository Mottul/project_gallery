// Aufnahmedatum ermitteln – rein, getestet in dates.test.ts (Skill bibliothek-index, „Aufnahmedatum“).
//
// Gespeichert wird die LOKALE Zeit wie in der Kamera (`taken_at`, ISO ohne Zone) plus die Zone,
// falls bekannt, plus die Quelle. Sortiert wird nach der lokalen Zeit – sonst sprängen Urlaubsfotos
// um die Zeitverschiebung. Rangfolge: EXIF DateTimeOriginal (+ SubSec, Offset) → EXIF CreateDate
// (digitalisiert) → XMP DateCreated → Dateizeit. Ungültige Werte (0000:00:00, vor 1826, mehr als
// einen Tag in der Zukunft) gelten als nicht vorhanden.
//
// Dateizeit: die ÄLTERE von Erstell- und Änderungszeit. Beim Kopieren setzt Windows die
// Erstellzeit neu und behält die Änderungszeit – bei kopierten Fotos ist die Erstellzeit also das
// Kopierdatum. Beim Bearbeiten ist es umgekehrt. Die ältere liegt näher an der Aufnahme.

export type DatumQuelle =
  'exif' | 'exif-digitalisiert' | 'xmp' | 'datei-erstellt' | 'datei-geaendert'

export interface Aufnahme {
  /** lokale Zeit „YYYY-MM-DDTHH:MM:SS[.fff]“ – lexikografisch sortierbar */
  lokal: string
  /** Zone „+02:00“, wenn bekannt */
  offset: string | null
  quelle: DatumQuelle
}

/** Erstes Foto der Welt (Niépce) – alles davor ist ein Fehler im Datum. */
const FRUEHESTES_JAHR = 1826
/** Zukunft: ein Tag plus größter Zonenabstand (+14 h), damit „heute“ nie herausfällt */
const ZUKUNFT_MS = (24 + 14) * 3_600_000

const DATUM =
  /^(\d{4}):(\d{2}):(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?(?:\.(\d+))?)?\s*(Z|[+-]\d{2}:?\d{2})?$/

const zwei = (n: number): string => String(n).padStart(2, '0')

/** Zone vereinheitlichen: „Z“ → „+00:00“, „+0200“ → „+02:00“; sonst null. */
export function zoneNormal(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim()
  if (t === 'Z') return '+00:00'
  const m = /^([+-])(\d{2}):?(\d{2})$/.exec(t)
  if (!m || Number(m[2]) > 14 || Number(m[3]) > 59) return null
  return `${m[1]}${m[2]}:${m[3]}`
}

/**
 * EXIF/XMP-Datum lesen („2024:07:14 18:30:05“, optional Sekundenbruchteil und Zone; XMP auch
 * ohne Uhrzeit). `subsec`/`zone` ergänzen aus eigenen Tags (SubSecTime…, OffsetTime…).
 * Liefert null bei ungültigem oder unplausiblem Datum.
 */
export function leseDatum(
  text: unknown,
  { subsec, zone, jetzt = Date.now() }: { subsec?: unknown; zone?: unknown; jetzt?: number } = {}
): { lokal: string; offset: string | null } | null {
  if (typeof text !== 'string') return null
  const m = DATUM.exec(text.trim())
  if (!m) return null
  const [j, mo, t, h = 0, mi = 0, s = 0] = m
    .slice(1, 7)
    .map((x) => (x === undefined ? undefined : Number(x))) as number[]
  if (j < FRUEHESTES_JAHR || mo < 1 || mo > 12 || h > 23 || mi > 59 || s > 59) return null
  // Tag gültig für den Monat? (31.02. gibt es nicht)
  const utc = Date.UTC(j, mo - 1, t, h, mi, s)
  const d = new Date(utc)
  if (d.getUTCDate() !== t || d.getUTCMonth() !== mo - 1 || t < 1) return null
  const offset = zoneNormal(m[8]) ?? zoneNormal(zone)
  // Zukunft: als UTC gelesen und mit Zone korrigiert, großzügig (ZUKUNFT_MS)
  if (utc > jetzt + ZUKUNFT_MS) return null
  const bruch = (
    m[7] ?? (typeof subsec === 'string' || typeof subsec === 'number' ? String(subsec).trim() : '')
  )
    .replace(/\D/g, '')
    .slice(0, 3)
  const lokal =
    `${j}-${zwei(mo)}-${zwei(t)}T${zwei(h)}:${zwei(mi)}:${zwei(s)}` +
    (bruch && Number(bruch) > 0 ? '.' + bruch.padEnd(3, '0') : '')
  return { lokal, offset }
}

/** Lokale Zeit (Zeitzone dieses Rechners) aus Millisekunden, sekundengenau. */
export function lokalAusMs(ms: number): string {
  const d = new Date(ms)
  return (
    `${d.getFullYear()}-${zwei(d.getMonth() + 1)}-${zwei(d.getDate())}` +
    `T${zwei(d.getHours())}:${zwei(d.getMinutes())}:${zwei(d.getSeconds())}`
  )
}

/** Ersatzdatum aus den Dateizeiten: die ältere von Erstell- und Änderungszeit. */
export function dateiDatum(btime: number | null, mtime: number): Aufnahme {
  const erstellt = btime !== null && btime > 0 && btime < mtime
  return {
    lokal: lokalAusMs(erstellt ? (btime as number) : mtime),
    offset: null,
    quelle: erstellt ? 'datei-erstellt' : 'datei-geaendert'
  }
}

/** Datums-Tags einer Datei (Namen wie ExifTool mit -G0). */
export interface DatumsTags {
  dateTimeOriginal?: unknown
  subSecTimeOriginal?: unknown
  offsetTimeOriginal?: unknown
  createDate?: unknown
  subSecTimeDigitized?: unknown
  offsetTimeDigitized?: unknown
  xmpDateCreated?: unknown
}

/** Aufnahmedatum nach der Rangfolge; ohne gültiges Tag aus den Dateizeiten. */
export function aufnahmeDatum(
  tags: DatumsTags,
  datei: { btime: number | null; mtime: number },
  jetzt = Date.now()
): Aufnahme {
  const original = leseDatum(tags.dateTimeOriginal, {
    subsec: tags.subSecTimeOriginal,
    zone: tags.offsetTimeOriginal,
    jetzt
  })
  if (original) return { ...original, quelle: 'exif' }
  const digital = leseDatum(tags.createDate, {
    subsec: tags.subSecTimeDigitized,
    zone: tags.offsetTimeDigitized,
    jetzt
  })
  if (digital) return { ...digital, quelle: 'exif-digitalisiert' }
  const xmp = leseDatum(tags.xmpDateCreated, { jetzt })
  if (xmp) return { ...xmp, quelle: 'xmp' }
  return dateiDatum(datei.btime, datei.mtime)
}
