import { describe, expect, it } from 'vitest'
import { kenBurnsBahn, kenBurnsFrames, kenBurnsTransform, type KenBurnsBahn } from './kenBurns'

const BUEHNE = { w: 1600, h: 900 }
const QUER = { w: 6000, h: 4000 }
const HOCH = { w: 3000, h: 4500 }
const PANO = { w: 8000, h: 2000 }

/** Zahlen aus einem Transform: x, y, Maßstab */
function teile(t: string): [number, number, number] {
  const m = /translate\((-?[\d.]+)px, (-?[\d.]+)px\) scale\(([\d.]+)\)/.exec(t)
  if (!m) throw new Error(t)
  return [Number(m[1]), Number(m[2]), Number(m[3])]
}

describe('kenBurnsBahn', () => {
  it('Querformat zoomt, abwechselnd rein und raus, um die Mitte', () => {
    const a = kenBurnsBahn(0, 'sanft', QUER, BUEHNE)
    const b = kenBurnsBahn(1, 'sanft', QUER, BUEHNE)
    expect([a.art, a.z0, a.z1]).toEqual(['zoom-rein', 1, 1.1])
    expect([b.art, b.z0, b.z1]).toEqual(['zoom-raus', 1.1, 1])
    expect([a.cx0, a.cx1, a.cy0, a.cy1]).toEqual([0.5, 0.5, 0.5, 0.5])
  })

  it('die Stärke bestimmt den Zoom', () => {
    expect(kenBurnsBahn(0, 'mittel', QUER, BUEHNE).z1).toBe(1.2)
    expect(kenBurnsBahn(0, 'stark', QUER, BUEHNE).z1).toBe(1.35)
  })

  it('Hochkant schwenkt senkrecht, abwechselnd, ohne aus dem Bild zu laufen', () => {
    const a = kenBurnsBahn(0, 'mittel', HOCH, BUEHNE)
    const b = kenBurnsBahn(1, 'mittel', HOCH, BUEHNE)
    expect([a.art, b.art]).toEqual(['schwenk-runter', 'schwenk-hoch'])
    expect(a.z0).toBe(a.z1)
    expect(a.cy0).toBeCloseTo(1 / 1.2 / 2)
    expect(a.cy1).toBeCloseTo(1 - 1 / 1.2 / 2)
    expect([a.cx0, a.cx1]).toEqual([0.5, 0.5])
    expect([b.cy0, b.cy1]).toEqual([a.cy1, a.cy0])
  })

  it('Panorama schwenkt waagerecht – gemessen an der Bühne', () => {
    expect(kenBurnsBahn(0, 'sanft', PANO, BUEHNE).art).toBe('schwenk-rechts')
    expect(kenBurnsBahn(1, 'sanft', PANO, BUEHNE).art).toBe('schwenk-links')
    // auf einer breiteren Bühne ist dasselbe Bild keins mehr
    expect(kenBurnsBahn(0, 'sanft', PANO, { w: 3200, h: 900 }).art).toBe('zoom-rein')
  })

  it('ein quadratisches Bild zoomt', () => {
    expect(kenBurnsBahn(0, 'sanft', { w: 2000, h: 2000 }, BUEHNE).art).toBe('zoom-rein')
  })
})

describe('kenBurnsTransform', () => {
  const fit = 900 / 4500

  it('Zoom: ohne Verschiebung, Anfang und Ende wie die Bahn, dazwischen gleichmäßig', () => {
    const b = kenBurnsBahn(0, 'stark', QUER, BUEHNE)
    const [x, y, s0] = teile(kenBurnsTransform(b, 0, QUER, 0.2))
    expect([x, y]).toEqual([0, 0])
    expect(s0).toBeCloseTo(0.2)
    expect(teile(kenBurnsTransform(b, 1, QUER, 0.2))[2]).toBeCloseTo(0.27)
    // exponentiell: in der Mitte das geometrische Mittel, nicht das arithmetische
    expect(teile(kenBurnsTransform(b, 0.5, QUER, 0.2))[2]).toBeCloseTo(0.2 * Math.sqrt(1.35))
  })

  it('Schwenk: das Bild deckt die Bühne von Kante zu Kante, keine Lücke oben oder unten', () => {
    const b: KenBurnsBahn = kenBurnsBahn(0, 'mittel', HOCH, BUEHNE)
    for (const [t, vorzeichen] of [
      [0, 1],
      [1, -1]
    ]) {
      const [x, y, s] = teile(kenBurnsTransform(b, t, HOCH, fit))
      expect(x).toBe(0)
      const hoehe = HOCH.h * s
      expect(hoehe).toBeCloseTo(BUEHNE.h * 1.2)
      // Abstand der Bildkante zur Bühnenkante ist genau 0
      expect(y * vorzeichen).toBeCloseTo((hoehe - BUEHNE.h) / 2, 1)
    }
  })
})

describe('kenBurnsFrames', () => {
  it('beginnt und endet genau wie die Bahn und läuft stetig', () => {
    const b = kenBurnsBahn(0, 'sanft', QUER, BUEHNE)
    const f = kenBurnsFrames(b, QUER, 0.2)
    expect(f[0].transform).toBe(kenBurnsTransform(b, 0, QUER, 0.2))
    expect(f.at(-1)?.transform).toBe(kenBurnsTransform(b, 1, QUER, 0.2))
    const s = f.map((k) => teile(k.transform)[2])
    for (let i = 1; i < s.length; i++) expect(s[i]).toBeGreaterThan(s[i - 1])
  })
})
