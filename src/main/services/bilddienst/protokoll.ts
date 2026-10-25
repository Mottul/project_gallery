// Nachrichten zwischen main (client.ts) und Bilddienst (einstieg.ts). Nur kleine Daten: Pfade
// hinein, Kennwerte heraus – nie ganze Bilder (Skill bibliothek-index, „Bilddienst“).

import type { GefundeneDatei } from '../library/repo'

/** main → Bilddienst */
export type AnDienst =
  { typ: 'scan'; auftrag: number; wurzel: string } | { typ: 'abbrechen'; auftrag: number }

/** Bilddienst → main */
export type VomDienst =
  | { typ: 'stapel'; auftrag: number; dateien: GefundeneDatei[] }
  | { typ: 'fertig'; auftrag: number; gefunden: number; unlesbar: string[] }
  | { typ: 'fehler'; auftrag: number; code: string; meldung: string }
  | { typ: 'log'; text: string }

/** Größe eines Stapels (Labor: 250 Zeilen blockieren main ~40 ms, Skill bibliothek-index). */
export const STAPEL = 250
