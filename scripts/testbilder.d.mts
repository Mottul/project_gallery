// Typen für scripts/testbilder.mjs, damit Labortests in TypeScript die Testbibliothek nutzen können.

export type Rgb = [number, number, number]

export interface Eintrag {
  datei: string
  art: 'bild' | 'video' | 'defekt' | 'fehlt'
  format?: string
  breite?: number
  hoehe?: number
  ausrichtung?: number
  farbraum?: 'cmyk' | 'p3'
  bilder?: number
  aufnahme?: { lokal?: string; offset?: string; utc?: string }
  kamera?: { hersteller: string; modell: string }
}

export interface Manifest {
  hinweis: string
  erzeugt: string
  eintraege: Eintrag[]
}

export const QUADRANTEN: Record<'obenLinks' | 'obenRechts' | 'untenLinks' | 'untenRechts', Rgb>
export const BMP_FARBEN: { oben: Rgb; unten: Rgb }
/** Größe des Vierfarb-Motivs, aufgerichtet (quer) */
export const MOTIV: { breite: number; hoehe: number }

/** Gespeicherte Pixel (PNG) für EXIF-Ausrichtung 1–8: aufgerichtet ergibt sich das Motiv. */
export function ausrichtungsPixel(n: number): Promise<Buffer>

/** Pfad eines gebündelten Werkzeugs (exiftool, ffmpeg, ffprobe) oder null. */
export function werkzeug(name: 'exiftool' | 'ffmpeg' | 'ffprobe'): string | null

export function erzeugeTestbilder(
  ziel: string,
  optionen?: { gross?: boolean; videos?: boolean }
): Promise<Manifest>
