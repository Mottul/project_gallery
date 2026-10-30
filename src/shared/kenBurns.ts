// Ken-Burns-Bahn der Diashow (Phase 2.5) – rein, getestet in kenBurns.test.ts. Bahn und Stärken aus
// der Mottulbox übernommen (project_mega/src/shared/videoGenPlan.ts: `kenBurnsPath`, `kenBurnsRect`,
// `KEN_BURNS_STRENGTH`; Stand 3f05492) und angepasst: Die Diashow zeigt das ganze Bild, Bezug ist
// also das Bild selbst statt eines Fensters im Format der Ausgabe, und „automatisch“ wechselt nach
// der Stelle in der Liste, so tun zwei Bilder nacheinander nie dasselbe. Phase 7 (Diashow als
// Video) soll dieselbe Bahn rechnen.

export type KenBurnsStaerke = 'sanft' | 'mittel' | 'stark'
export const KEN_BURNS_STAERKEN: readonly KenBurnsStaerke[] = ['sanft', 'mittel', 'stark']

const FAKTOR: Record<KenBurnsStaerke, number> = { sanft: 1.1, mittel: 1.2, stark: 1.35 }

export type KenBurnsArt =
  'zoom-rein' | 'zoom-raus' | 'schwenk-links' | 'schwenk-rechts' | 'schwenk-hoch' | 'schwenk-runter'

/** Zoom (1 = ganzes Bild) und Bildmitte (Anteile des Bildes, 0..1) am Anfang und am Ende */
export interface KenBurnsBahn {
  art: KenBurnsArt
  z0: number
  z1: number
  cx0: number
  cx1: number
  cy0: number
  cy1: number
}

export interface Masse {
  w: number
  h: number
}

/** Ab so viel breiter als die Bühne gilt ein Bild als Panorama */
const PANORAMA = 1.3
/** Stützstellen je Bahn: dazwischen rechnet der Browser linear */
const STUETZSTELLEN = 12

/**
 * Bahn eines Bildes: Hochkant schwenkt senkrecht, Panoramen waagerecht, alles andere zoomt. Die
 * Richtung wechselt mit `nr` (Stelle in der Liste). Schwenks zoomen um die Stärke, um Platz zu
 * bekommen, und fahren dann von Rand zu Rand – die Stärke bestimmt so auch das Tempo.
 */
export function kenBurnsBahn(
  nr: number,
  staerke: KenBurnsStaerke,
  bild: Masse,
  buehne: Masse
): KenBurnsBahn {
  const z = FAKTOR[staerke]
  const gerade = nr % 2 === 0
  const rand = 1 / z / 2
  const mitte = { cx0: 0.5, cx1: 0.5, cy0: 0.5, cy1: 0.5 }
  if (bild.h > bild.w) {
    const [cy0, cy1] = gerade ? [rand, 1 - rand] : [1 - rand, rand]
    const art = gerade ? 'schwenk-runter' : 'schwenk-hoch'
    return { ...mitte, art, z0: z, z1: z, cy0, cy1 }
  }
  if (bild.w / bild.h > (buehne.w / buehne.h) * PANORAMA) {
    const [cx0, cx1] = gerade ? [rand, 1 - rand] : [1 - rand, rand]
    const art = gerade ? 'schwenk-rechts' : 'schwenk-links'
    return { ...mitte, art, z0: z, z1: z, cx0, cx1 }
  }
  return gerade
    ? { ...mitte, art: 'zoom-rein', z0: 1, z1: z }
    : { ...mitte, art: 'zoom-raus', z0: z, z1: 1 }
}

/**
 * CSS-Transform zur Zeit t (0..1) für ein Bild, das mittig auf der Bühne liegt; `fit` ist der
 * Maßstab, mit dem es ganz hineinpasst. Zoom exponentiell (gleichmäßig fürs Auge), Mitte linear.
 */
export function kenBurnsTransform(b: KenBurnsBahn, t: number, bild: Masse, fit: number): string {
  const s = fit * b.z0 * Math.pow(b.z1 / b.z0, t)
  const cx = b.cx0 + (b.cx1 - b.cx0) * t
  const cy = b.cy0 + (b.cy1 - b.cy0) * t
  const x = (0.5 - cx) * bild.w * s
  const y = (0.5 - cy) * bild.h * s
  return `translate(-50%, -50%) translate(${x.toFixed(2)}px, ${y.toFixed(2)}px) scale(${s.toFixed(5)})`
}

/** Keyframes der ganzen Bahn für `element.animate` */
export function kenBurnsFrames(b: KenBurnsBahn, bild: Masse, fit: number): { transform: string }[] {
  return Array.from({ length: STUETZSTELLEN + 1 }, (_, i) => ({
    transform: kenBurnsTransform(b, i / STUETZSTELLEN, bild, fit)
  }))
}
