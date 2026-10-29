// Blocksatz (Phase 2.3b, entschieden 29.10.2026) – rein, getestet in blocksatz.test.ts. Bilder in
// ihrem Seitenverhältnis, Zeilen gleicher Höhe, die genau die Breite füllen (wie Google Fotos,
// Lightroom). Gierig von links: Bilder kommen in die Zeile, bis sie bei der Zielhöhe breiter als
// verfügbar wäre; dann gilt die Zeile mit oder ohne das letzte Bild – je nachdem, welche Höhe
// näher an der Zielhöhe liegt – und wird auf die Breite gestreckt. Die letzte Zeile einer Gruppe
// bleibt in Zielhöhe linksbündig, außer sie ist schon fast voll (ab 90 %, sonst sähe ein Raster aus
// gleich großen Bildern unten ausgefranst aus). Jede Gruppe beginnt in einer neuen Zeile.

import type { Gruppe } from '@shared/gruppen'
import { gruppenPassend, type Zeile } from './zeilen'

/** Ab dieser Füllung wird auch die letzte Zeile einer Gruppe auf die Breite gestreckt. */
const FAST_VOLL = 0.9

/** Grenzen des Seitenverhältnisses: Panoramen und Streifen werden beschnitten gezeigt. */
export const SEITE_MIN = 1 / 3
export const SEITE_MAX = 3

/** Seitenverhältnis für das Layout: unbekannt (0) = quadratisch, sonst begrenzt. */
export function seite(r: number | undefined): number {
  if (!r || !Number.isFinite(r) || r <= 0) return 1
  return Math.min(SEITE_MAX, Math.max(SEITE_MIN, r))
}

/**
 * Zeilen für den Blocksatz. `seiten[i]` gehört zur Kennung an Stelle i; `breite` ist die
 * verfügbare Breite (ohne Rand), `zielHoehe` die Höhe aus dem Größenregler.
 */
export function blocksatzZeilen(
  seiten: ArrayLike<number>,
  gruppen: readonly Gruppe[],
  breite: number,
  zielHoehe: number,
  abstand: number
): Zeile[] {
  const anzahl = seiten.length
  const ziel = Math.max(1, zielHoehe)
  // vor dem ersten Messen (Breite 0): wenigstens ein Bild je Zeile, nie negative Maße
  const b = Math.max(breite, ziel)
  const mitKopf = gruppen.length > 0 && gruppenPassend(anzahl, gruppen)
  const bereiche = mitKopf ? gruppen : [{ titel: '', von: 0, anzahl }]
  const out: Zeile[] = []
  const zeile = (von: number, bis: number, hoehe: number): void => {
    const breiten: number[] = []
    for (let i = von; i < bis; i++) breiten.push(seite(seiten[i]) * hoehe)
    out.push({ art: 'bilder', von, bis, hoehe, breiten })
  }
  for (const g of bereiche) {
    if (mitKopf) out.push({ art: 'kopf', von: g.von, titel: g.titel, anzahl: g.anzahl })
    const ende = g.von + g.anzahl
    let von = g.von
    while (von < ende) {
      let summe = 0
      let bis = von
      let voll = false
      while (bis < ende) {
        const s = seite(seiten[bis])
        summe += s
        bis++
        const hoehe = (b - (bis - von - 1) * abstand) / summe
        if (hoehe <= ziel) {
          // ohne das letzte Bild wäre die Zeile höher als das Ziel – was liegt näher?
          if (bis - 1 > von) {
            const ohne = (b - (bis - von - 2) * abstand) / (summe - s)
            if (Math.abs(ohne - ziel) < Math.abs(hoehe - ziel)) {
              bis--
              summe -= s
            }
          }
          zeile(von, bis, (b - (bis - von - 1) * abstand) / summe)
          voll = true
          break
        }
      }
      // Rest der Gruppe füllt die Breite nicht: in Zielhöhe linksbündig, fast voll gestreckt
      if (!voll) {
        const luecken = (bis - von - 1) * abstand
        zeile(von, bis, summe * ziel + luecken >= FAST_VOLL * b ? (b - luecken) / summe : ziel)
      }
      von = bis
    }
  }
  return out
}
