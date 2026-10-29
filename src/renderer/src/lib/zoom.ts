// Zoom des Betrachters, rein und getestet (zoom.test.ts): Grenzen, Schieberegler (logarithmisch –
// jede Reglerstufe vergrößert um denselben Faktor) und Mausrad (stufenlos nach dem Ausschlag: ein
// Raster am Mausrad = ein Zoomschritt, ein kleiner Ausschlag am Touchpad entsprechend weniger).

export const ZOOM_SCHRITT = 1.25
export const ZOOM_MAX = 8
/** Feste Stufen im Menü an der Prozentzahl */
export const ZOOM_STUFEN = [0.25, 0.5, 1, 2, 4] as const
/** Auflösung des Schiebereglers (0 … REGLER) */
export const REGLER = 200

/** Kleinste und größte Zoomstufe bei der Stufe `passend` (Bild füllt die Bühne). */
export function zoomGrenzen(passend: number): { min: number; max: number } {
  return { min: passend / 4, max: ZOOM_MAX }
}

export function begrenzen(s: number, passend: number): number {
  const { min, max } = zoomGrenzen(passend)
  return Math.max(min, Math.min(max, s))
}

/** Stellung des Reglers (0 … REGLER) für die Stufe `s`. */
export function reglerWert(s: number, passend: number): number {
  const { min, max } = zoomGrenzen(passend)
  const v = (REGLER * Math.log(begrenzen(s, passend) / min)) / Math.log(max / min)
  return Math.round(v)
}

/** Stufe für eine Stellung des Reglers. */
export function ausRegler(v: number, passend: number): number {
  const { min, max } = zoomGrenzen(passend)
  const t = Math.max(0, Math.min(REGLER, v)) / REGLER
  return min * (max / min) ** t
}

/** Pixel je Zeile bzw. Seite, wenn das Rad in Zeilen oder Seiten meldet (WheelEvent.deltaMode) */
const ZEILE = 33
const SEITE = 800
/** Ein Raster am Mausrad (Windows: 100 px) entspricht einem Zoomschritt. */
const RASTER = 100

/**
 * Zoomfaktor für ein Mausrad-Ereignis: nach oben (deltaY < 0) größer. Ein Ereignis zoomt höchstens
 * drei Schritte – sehr schnelle Räder melden große Sprünge auf einmal.
 */
export function radFaktor(deltaY: number, deltaMode = 0): number {
  const px = deltaY * (deltaMode === 1 ? ZEILE : deltaMode === 2 ? SEITE : 1)
  const schritte = Math.max(-3, Math.min(3, -px / RASTER))
  return ZOOM_SCHRITT ** schritte
}
