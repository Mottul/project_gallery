// Nachrichten zwischen main (client.ts) und Bilddienst (einstieg.ts). Nur kleine Daten: Pfade
// hinein, Kennwerte heraus – nie ganze Bilder (Skill bibliothek-index, „Bilddienst“).

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

/** main → Bilddienst */
export type AnDienst =
  | { typ: 'scan'; auftrag: number; wurzel: string }
  | { typ: 'meta'; auftrag: number; dateien: MetaDatei[] }
  | { typ: 'abbrechen'; auftrag: number }
  | { typ: 'beenden' }

/** Bilddienst → main */
export type VomDienst =
  | { typ: 'stapel'; auftrag: number; dateien: GefundeneDatei[] }
  | { typ: 'fertig'; auftrag: number; gefunden: number; unlesbar: string[] }
  | { typ: 'meta-ergebnis'; auftrag: number; ergebnisse: MetaErgebnis[] }
  | { typ: 'fehler'; auftrag: number; code: string; meldung: string }
  | { typ: 'log'; text: string }

/** Größe eines Stapels (Labor: 250 Zeilen blockieren main ~40 ms, Skill bibliothek-index). */
export const STAPEL = 250

/** Start-Argument des Bilddienstes: Pfad zum gebündelten ExifTool (leer = keins) */
export const ARG_EXIFTOOL = '--exiftool='
