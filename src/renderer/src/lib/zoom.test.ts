import { describe, expect, it } from 'vitest'
import {
  REGLER,
  ZOOM_MAX,
  ZOOM_SCHRITT,
  ausRegler,
  begrenzen,
  radFaktor,
  reglerWert,
  zoomGrenzen
} from './zoom'

describe('Zoom des Betrachters', () => {
  it('Grenzen: ein Viertel der passenden Stufe bis 800 %', () => {
    expect(zoomGrenzen(0.5)).toEqual({ min: 0.125, max: ZOOM_MAX })
    expect(begrenzen(0.01, 0.5)).toBe(0.125)
    expect(begrenzen(100, 0.5)).toBe(ZOOM_MAX)
    expect(begrenzen(1, 0.5)).toBe(1)
  })

  it('Regler: Enden sind die Grenzen, hin und zurück ohne Sprung', () => {
    expect(ausRegler(0, 0.4)).toBeCloseTo(0.1)
    expect(ausRegler(REGLER, 0.4)).toBeCloseTo(ZOOM_MAX)
    expect(reglerWert(0.001, 0.4)).toBe(0)
    expect(reglerWert(99, 0.4)).toBe(REGLER)
    for (const v of [0, 1, 37, 100, 163, REGLER]) {
      expect(reglerWert(ausRegler(v, 0.4), 0.4)).toBe(v)
    }
  })

  it('Regler: logarithmisch – gleiche Strecke, gleicher Faktor', () => {
    const f1 = ausRegler(60, 0.25) / ausRegler(50, 0.25)
    const f2 = ausRegler(160, 0.25) / ausRegler(150, 0.25)
    expect(f1).toBeCloseTo(f2)
    expect(f1).toBeGreaterThan(1)
  })

  it('Mausrad: ein Raster ein Schritt, Touchpad feiner, große Sprünge begrenzt', () => {
    expect(radFaktor(-100)).toBeCloseTo(ZOOM_SCHRITT)
    expect(radFaktor(100)).toBeCloseTo(1 / ZOOM_SCHRITT)
    const fein = radFaktor(-10)
    expect(fein).toBeGreaterThan(1)
    expect(fein).toBeLessThan(1.03)
    expect(radFaktor(-5000)).toBeCloseTo(ZOOM_SCHRITT ** 3)
    // in Zeilen (deltaMode 1): 3 Zeilen ≈ ein Raster
    expect(radFaktor(-3, 1)).toBeCloseTo(ZOOM_SCHRITT ** 0.99)
    expect(radFaktor(0)).toBe(1)
  })
})
