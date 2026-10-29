// Zeilen für Raster und Liste mit Gruppen-Überschriften (Phase 2.3) – rein, getestet in
// zeilen.test.ts. Je Gruppe eine Kopfzeile, dann ihre Bilder in Zeilen zu `spalten` Stück (die
// Liste nimmt 1); eine Gruppe beginnt immer in einer neuen Zeile. Ohne Gruppen nur Bildzeilen.
// Der Blocksatz (2.3b, `blocksatz.ts`) baut dieselben Zeilen, dazu Höhe und Breiten je Bild.

import type { Gruppe } from '@shared/gruppen'

export type Zeile =
  | { art: 'kopf'; von: number; titel: string; anzahl: number }
  | {
      art: 'bilder'
      von: number
      bis: number
      /** nur Blocksatz: Höhe der Bilder dieser Zeile und Breite je Bild (px) */
      hoehe?: number
      breiten?: readonly number[]
    }

/** Passen die Gruppen lückenlos zu den Kennungen? Sonst ohne Überschriften (nie Bilder verlieren). */
export function gruppenPassend(anzahl: number, gruppen: readonly Gruppe[]): boolean {
  let erwartet = 0
  for (const g of gruppen) {
    if (g.von !== erwartet || g.anzahl < 1) return false
    erwartet += g.anzahl
  }
  return erwartet === anzahl
}

export function zeilenBilden(anzahl: number, gruppen: readonly Gruppe[], spalten: number): Zeile[] {
  const mitKopf = gruppen.length > 0 && gruppenPassend(anzahl, gruppen)
  const bereiche = mitKopf ? gruppen : [{ titel: '', von: 0, anzahl }]
  const breite = Math.max(1, Math.floor(spalten))
  const out: Zeile[] = []
  for (const g of bereiche) {
    if (mitKopf) out.push({ art: 'kopf', von: g.von, titel: g.titel, anzahl: g.anzahl })
    const ende = g.von + g.anzahl
    for (let von = g.von; von < ende; von += breite) {
      out.push({ art: 'bilder', von, bis: Math.min(ende, von + breite) })
    }
  }
  return out
}

/** Zeile, in der das Bild an Stelle `index` steht (-1 = keine). */
export function zeileFuer(zeilen: readonly Zeile[], index: number): number {
  // letzte Zeile mit von <= index; eine Kopfzeile teilt ihr `von` mit der folgenden Bildzeile
  let lo = 0
  let hi = zeilen.length - 1
  let treffer = -1
  while (lo <= hi) {
    const mitte = (lo + hi) >> 1
    if (zeilen[mitte].von <= index) {
      treffer = mitte
      lo = mitte + 1
    } else hi = mitte - 1
  }
  const z = zeilen[treffer]
  return z && z.art === 'bilder' && index < z.bis ? treffer : -1
}

/** Obere Kanten aller Zeilen (und dahinter die Gesamthöhe) – für Rahmen und Sprünge. */
export function zeilenOben(
  zeilen: readonly Zeile[],
  hoehe: (z: Zeile) => number,
  start: number
): Float64Array {
  const oben = new Float64Array(zeilen.length + 1)
  oben[0] = start
  for (let i = 0; i < zeilen.length; i++) oben[i + 1] = oben[i] + hoehe(zeilen[i])
  return oben
}

/** Erste Zeile, deren Unterkante unter `y` liegt (für den Rahmen). */
export function ersteZeileAb(oben: Float64Array, y: number): number {
  let lo = 0
  let hi = oben.length - 2
  let treffer = oben.length - 1
  while (lo <= hi) {
    const mitte = (lo + hi) >> 1
    if (oben[mitte + 1] > y) {
      treffer = mitte
      hi = mitte - 1
    } else lo = mitte + 1
  }
  return treffer
}
