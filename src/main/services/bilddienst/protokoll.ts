// Nachrichten zwischen main (client.ts) und Bilddienst (einstieg.ts). Nur kleine Daten: Pfade
// hinein, Kennwerte heraus – nie ganze Bilder (Skill bibliothek-index, „Bilddienst“).

import { cpus } from 'node:os'
import type { GefundeneDatei } from '../library/repo'

/** Datei, deren Grundfelder gelesen werden sollen (Kennung aus dem Index, absoluter Pfad) */
export interface MetaDatei {
  id: number
  pfad: string
}

/** Rohe ExifTool-Tags je Datei; null = nicht gelesen */
export interface MetaErgebnis {
  id: number
  roh: Record<string, unknown> | null
}

/** Datei, deren Vorschaubilder entstehen sollen (alles, was zum Prüfen nötig ist) */
export interface VorschauDatei {
  id: number
  pfad: string
  /** Bibliotheksordner: der echte Pfad der Datei muss darin liegen */
  ordner: string
  size: number
  mtime: number
  /** Format nach Inhalt (ExifTool) oder Endung – „bmp“ geht über ffmpeg */
  format: string
  /** platte = verschlüsselt in den Cache; speicher = zurück an main (Ordner „privat“) */
  ziel: 'platte' | 'speicher'
}

export type VorschauErgebnis =
  | { id: number; ok: true; farbe: string; gross?: Uint8Array; klein?: Uint8Array }
  | { id: number; ok: false; code: string }

/** Datei für die Anzeige-Umrechnung (Betrachter, TIFF) */
export interface AnzeigeDatei {
  pfad: string
  ordner: string
  size: number
  mtime: number
}

/** Umgerechnetes Bild (JPEG/WebP, höchstens 3840 px) oder der Grund, warum nicht */
export interface AnzeigeErgebnis {
  daten: Uint8Array | null
  code: string | null
}

/** main → Bilddienst */
export type AnDienst =
  | {
      typ: 'einrichten'
      /** Schlüssel des Vorschau-Caches – nur über die Nachricht, nie über Argumente (sichtbar) */
      schluessel: Uint8Array
      cacheOrdner: string
      ffmpeg: string | null
    }
  | { typ: 'scan'; auftrag: number; wurzel: string }
  | { typ: 'meta'; auftrag: number; dateien: MetaDatei[] }
  | { typ: 'vorschau'; auftrag: number; dateien: VorschauDatei[] }
  | { typ: 'anzeige'; auftrag: number; datei: AnzeigeDatei }
  | { typ: 'abbrechen'; auftrag: number }
  | { typ: 'beenden' }

/** Bilddienst → main */
export type VomDienst =
  | { typ: 'stapel'; auftrag: number; dateien: GefundeneDatei[] }
  | { typ: 'fertig'; auftrag: number; gefunden: number; unlesbar: string[] }
  | { typ: 'meta-ergebnis'; auftrag: number; ergebnisse: MetaErgebnis[] }
  | { typ: 'vorschau-ergebnis'; auftrag: number; ergebnisse: VorschauErgebnis[] }
  | { typ: 'anzeige-ergebnis'; auftrag: number; ergebnis: AnzeigeErgebnis }
  | { typ: 'fehler'; auftrag: number; code: string; meldung: string }
  | { typ: 'log'; text: string }

/** Größe eines Stapels (Labor: 250 Zeilen blockieren main ~40 ms, Skill bibliothek-index). */
export const STAPEL = 250

/** Start-Argument des Bilddienstes: Pfad zum gebündelten ExifTool (leer = keins) */
export const ARG_EXIFTOOL = '--exiftool='

/**
 * Vorschaubilder gleichzeitig (Labor: je ein libvips-Thread, halbe Thread-Zahl, mindestens 2 –
 * 6 parallel: 45 Bilder/s). Zugleich die Stapelgröße eines Auftrags.
 */
export function vorschauParallel(): number {
  return Math.max(2, Math.floor(cpus().length / 2))
}
