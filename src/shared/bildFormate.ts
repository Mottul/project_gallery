// Welche Dateien gehören in die Galerie? Rein, getestet in bildFormate.test.ts.
//
// Phase 1 nimmt Bilder auf (docs/PLAN.md: JPEG, PNG, WebP, GIF, AVIF, TIFF, BMP). Videos, HEIC und
// RAW folgen mit Phase 6 – dann hier ergänzen. Die Endung entscheidet nur, ob eine Datei überhaupt
// eingelesen wird; was sie wirklich ist, prüft der Bilddienst am Inhalt (Labor: eine PNG mit
// `.jpg`-Endung ist häufig, ExifTool schreibt dann nicht).

export type BildFormat = 'jpeg' | 'png' | 'webp' | 'gif' | 'avif' | 'tiff' | 'bmp'

// Map statt Objekt: „x.constructor“ fände in einem Objekt sonst eine Funktion (Review-Checkliste)
const ENDUNGEN = new Map<string, BildFormat>([
  ['jpg', 'jpeg'],
  ['jpeg', 'jpeg'],
  ['jpe', 'jpeg'],
  ['jfif', 'jpeg'],
  ['png', 'png'],
  ['webp', 'webp'],
  ['gif', 'gif'],
  ['avif', 'avif'],
  ['tif', 'tiff'],
  ['tiff', 'tiff'],
  ['bmp', 'bmp']
])

/** Endung eines Dateinamens, klein und ohne Punkt („Bild.JPG“ → „jpg“); leer ohne Endung. */
export function endungVon(name: string): string {
  const i = name.lastIndexOf('.')
  return i > 0 && i < name.length - 1 ? name.slice(i + 1).toLowerCase() : ''
}

/** Format nach Endung, oder null, wenn die Datei nicht in die Galerie gehört. */
export function formatAusEndung(name: string): BildFormat | null {
  return ENDUNGEN.get(endungVon(name)) ?? null
}
