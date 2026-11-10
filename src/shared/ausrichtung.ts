// Verlustfreies Drehen über die EXIF-Ausrichtung (Phase 3.4) – rein, getestet in ausrichtung.test.ts.
// Die Ausrichtung 1–8 sagt, wie ein Betrachter die gespeicherten Pixel zeigt: erst waagerecht spiegeln
// (bei 2, 4, 5, 7), dann um ein Vielfaches von 90° im Uhrzeigersinn drehen. Weiterdrehen ändert nur
// die Drehung, die Spiegelung bleibt – so werden auch gespiegelte Ausrichtungen richtig weitergedreht.
// Gemessen (scripts/labor/ausrichtung.mjs, 9.11.2026): alle 16 Fälle zeigen sharp und Chromium so.
//
// Drehbar sind nur Formate, deren Ausrichtung die App selbst UND Windows beachten (gemessen): JPEG
// (sharp, Chromium, Explorer) und TIFF (sharp für Vorschaubild und Betrachter; Windows liest den
// Wert). PNG beachtet Windows gar nicht, WebP zeigt Chromium ungedreht, AVIF dreht über `irot` – das
// schreibt ExifTool nicht, die EXIF-Ausrichtung beachtet dort niemand; GIF und BMP haben keine. Was
// nicht drehbar ist, lehnt der main mit `nichtDrehbarText` ab – pixelweise gedreht wird in 3.4 nicht.

export type Drehung = 'rechts' | 'links'

/** Ausrichtung → [waagerecht gespiegelt, Viertel im Uhrzeigersinn] (Reihenfolge: erst spiegeln) */
const LAGE: ReadonlyMap<number, readonly [boolean, number]> = new Map([
  [1, [false, 0]],
  [2, [true, 0]],
  [3, [false, 2]],
  [4, [true, 2]],
  [5, [true, 3]],
  [6, [false, 1]],
  [7, [true, 1]],
  [8, [false, 3]]
])

/** Eine der acht Ausrichtungen der EXIF-Norm? */
export const istAusrichtung = (v: unknown): v is number =>
  typeof v === 'number' && Number.isInteger(v) && LAGE.has(v)

/**
 * Die Ausrichtung, wie Chromium und sharp sie anwenden: fehlt sie oder ist sie ungültig (0, 9, Text),
 * zeigen beide das Bild, wie es gespeichert ist – das ist 1.
 */
export const ausrichtungAus = (v: unknown): number => (istAusrichtung(v) ? v : 1)

/** Die neue Ausrichtung, wenn das angezeigte Bild um 90° nach rechts bzw. links gedreht wird. */
export function gedreht(ausrichtung: number, d: Drehung): number {
  const [spiegel, viertel] = LAGE.get(ausrichtungAus(ausrichtung)) as readonly [boolean, number]
  const neu = (viertel + (d === 'rechts' ? 1 : 3)) % 4
  for (const [o, [s, v]] of LAGE) if (s === spiegel && v === neu) return o
  throw new Error('Ausrichtung nicht gefunden') // unerreichbar: LAGE enthält alle acht
}

/** Liegen die Maße gegenüber den gespeicherten Pixeln quer (5–8)? */
export const getauscht = (ausrichtung: number): boolean => ausrichtungAus(ausrichtung) >= 5

const DREHBAR = new Set(['jpeg', 'tiff'])

/** Lässt sich ein Bild dieses Formats (nach Inhalt) verlustfrei drehen? */
export const drehbar = (format: string | null): boolean => format !== null && DREHBAR.has(format)

/** Was der Nutzer liest, wenn ein Format nicht drehbar ist */
export const nichtDrehbarText = (format: string | null): string =>
  `${format ? `${format.toUpperCase()}-Dateien lassen` : 'Diese Datei lässt'} sich nicht ` +
  'verlustfrei drehen – das geht nur bei JPEG und TIFF.'

export const drehungText = (d: Drehung): string =>
  d === 'rechts' ? 'um 90° nach rechts' : 'um 90° nach links'

/** Hinweis nach dem Drehen eines Bildes („Um 90° nach rechts gedreht“) */
export const gedrehtText = (d: Drehung): string => `Um 90° nach ${d} gedreht`

/** Taste R bzw. L (auch mit Feststelltaste); sonst null */
export const tastenDrehung = (taste: string): Drehung | null =>
  taste === 'r' || taste === 'R' ? 'rechts' : taste === 'l' || taste === 'L' ? 'links' : null

/** Eingabe aus dem Renderer prüfen; null = keine gültige Drehung. */
export const pruefeDrehung = (v: unknown): Drehung | null =>
  v === 'rechts' || v === 'links' ? v : null
