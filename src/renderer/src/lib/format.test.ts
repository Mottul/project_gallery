import { describe, expect, it } from 'vitest'
import { belichtungText, blendeText, brennweiteText, gpsText } from './format'

describe('Aufnahmedaten anzeigen', () => {
  it('Belichtung: Bruch unter einer Sekunde, sonst Sekunden', () => {
    expect(belichtungText(0.004)).toBe('1/250 s')
    expect(belichtungText(1 / 3)).toBe('1/3 s')
    expect(belichtungText(0.3)).toBe('0,3 s')
    expect(belichtungText(2)).toBe('2 s')
    expect(belichtungText(1.5)).toBe('1,5 s')
  })

  it('Blende, Brennweite, Koordinaten mit Himmelsrichtung', () => {
    expect(blendeText(8)).toBe('f/8')
    expect(blendeText(2.8)).toBe('f/2,8')
    expect(brennweiteText(35)).toBe('35 mm')
    expect(gpsText(42.6507, 18.0944)).toBe('42,6507° N, 18,0944° O')
    expect(gpsText(-33.86, -70.65)).toBe('33,8600° S, 70,6500° W')
  })
})
