import { describe, expect, it } from 'vitest'
import { entfernungKm, landName, MAX_KM, OrtsIndex, orteParsen, type Ort } from './geo'

const ort = (name: string, lat: number, lon: number, land: string, einw: number): Ort => ({
  name,
  lat,
  lon,
  land,
  einw
})

// Ausschnitt echter Werte aus GeoNames cities1000 (Labor 29.10.2026)
const ORTE = [
  ort('Paris', 48.8534, 2.3488, 'FR', 2138551),
  ort('Paris 16 Passy', 48.8637, 2.2769, 'FR', 159386),
  ort('Issy-les-Moulineaux', 48.8247, 2.2706, 'FR', 68395),
  ort('Dubrovnik', 42.6412, 18.1091, 'HR', 26922),
  ort('Mokošica', 42.6729, 18.0889, 'HR', 2193),
  ort('München', 48.1374, 11.5755, 'DE', 1505005),
  // Dorf 7,8 km neben einer Großstadt
  ort('Dorf', 48.2, 11.0, 'DE', 2000),
  ort('Großstadt', 48.27, 11.0, 'DE', 500000),
  ort('Suva', -18.1416, 178.4415, 'FJ', 77366),
  ort('Taveuni', -16.85, -179.95, 'FJ', 1200)
]
const index = new OrtsIndex(ORTE)
const name = (lat: number, lon: number): string | null => index.naechster(lat, lon)?.name ?? null

describe('nächster Ort', () => {
  it('Entfernung (Haversine)', () => {
    expect(entfernungKm({ lat: 48.8584, lon: 2.2945 }, { lat: 48.8534, lon: 2.3488 })).toBeCloseTo(
      4.0,
      1
    )
    expect(entfernungKm({ lat: 0, lon: 179.9 }, { lat: 0, lon: -179.9 })).toBeCloseTo(22.2, 0)
  })

  it('Eiffelturm: Paris, nicht das nähere Arrondissement (größere Stadt im Umkreis)', () => {
    expect(name(48.8584, 2.2945)).toBe('Paris')
  })

  it('Dubrovnik, München: der nächste Ort', () => {
    expect(name(42.6507, 18.0944)).toBe('Dubrovnik')
    expect(name(48.1374, 11.5755)).toBe('München')
  })

  it('ein Dorf neben einer Großstadt bleibt das Dorf', () => {
    expect(name(48.204, 11.0)).toBe('Dorf')
    // mitten in der Großstadt: die Großstadt
    expect(name(48.27, 11.001)).toBe('Großstadt')
  })

  it('über die Datumsgrenze hinweg; zu weit weg: kein Ort; Unsinn: kein Ort', () => {
    expect(name(-16.85, 179.98)).toBe('Taveuni')
    expect(name(0, -30)).toBeNull()
    expect(name(48.8584 + MAX_KM / 100, 2.2945)).toBeNull()
    expect(name(91, 0)).toBeNull()
    expect(name(Number.NaN, 0)).toBeNull()
  })

  it('Ortsdatei lesen: Unbrauchbares fällt weg', () => {
    expect(
      orteParsen(
        'Paris\t48.8534\t2.3488\tFR\t2138551\nkaputt\t1\nX\t95\t0\tFR\t1\nY\t1\t2\tfr\t1\n'
      )
    ).toEqual([ort('Paris', 48.8534, 2.3488, 'FR', 2138551)])
  })

  it('Ländernamen auf Deutsch', () => {
    expect(landName('HR')).toBe('Kroatien')
    expect(landName('US')).toBe('Vereinigte Staaten')
    expect(landName('de')).toBe('Deutschland')
  })
})
