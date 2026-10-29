import { describe, expect, it } from 'vitest'
import { blocksatzZeilen, seite, SEITE_MAX } from './blocksatz'
import { zeileFuer, type Zeile } from './zeilen'

type Bildzeile = Extract<Zeile, { art: 'bilder' }>
const bildzeilen = (z: Zeile[]): Bildzeile[] => z.filter((x): x is Bildzeile => x.art === 'bilder')
/** Breite einer Zeile samt Abständen */
const gesamt = (z: Bildzeile, abstand: number): number =>
  (z.breiten ?? []).reduce((a, b) => a + b, 0) + ((z.breiten?.length ?? 1) - 1) * abstand

describe('Blocksatz', () => {
  it('volle Zeilen füllen genau die Breite, alle Bilder einer Zeile gleich hoch', () => {
    // 12 Bilder 3:2 bei Breite 1000, Ziel 160 px: 3:2 bei 160 = 240 px breit; die letzte Zeile
    // ist zu 97 % voll und wird mitgestreckt
    const seiten = Array.from({ length: 12 }, () => 1.5)
    const z = bildzeilen(blocksatzZeilen(seiten, [], 1000, 160, 4))
    expect(z.map((x) => x.bis - x.von)).toEqual([4, 4, 4])
    for (const x of z) {
      expect(gesamt(x, 4)).toBeCloseTo(1000, 6)
      for (const [i, b] of (x.breiten ?? []).entries()) {
        expect(b / (x.hoehe ?? 0)).toBeCloseTo(seiten[x.von + i], 6)
      }
    }
    // (1000 - 3·4) / (4 · 1,5)
    expect(z[0].hoehe).toBeCloseTo(164.667, 2)
    // Gegenstück: ein Bild weniger – die letzte Zeile (3 von 4) bleibt in Zielhöhe
    const kurz = bildzeilen(blocksatzZeilen(seiten.slice(1), [], 1000, 160, 4))
    expect(kurz.at(-1)?.hoehe).toBe(160)
  })

  it('wählt mit oder ohne das letzte Bild – je nachdem, was näher an der Zielhöhe liegt', () => {
    // 1000 px, Ziel 200: zwei 2:1-Bilder → 250 hoch (zu hoch), drei → 166 (näher an 200 als 250)
    expect(bildzeilen(blocksatzZeilen([2, 2, 2], [], 1000, 200, 0))[0].bis).toBe(3)
    // Ziel 240: zwei → 250 (Abstand 10), drei → 166 (Abstand 74) → zwei
    const z = bildzeilen(blocksatzZeilen([2, 2, 2], [], 1000, 240, 0))
    expect(z.map((x) => [x.von, x.bis])).toEqual([
      [0, 2],
      [2, 3]
    ])
    expect(z[0].hoehe).toBe(250)
    // der Rest füllt die Breite nicht: Zielhöhe, linksbündig (nicht gestreckt)
    expect(z[1].hoehe).toBe(240)
    expect(gesamt(z[1], 0)).toBe(480)
  })

  it('jede Gruppe beginnt in einer neuen Zeile mit Kopf; ihre letzte Zeile bleibt in Zielhöhe', () => {
    const seiten = [1.5, 1.5, 1.5, 1.5, 1.5, 0.667, 0.667]
    const gruppen = [
      { titel: 'Juli 2024', von: 0, anzahl: 5 },
      { titel: 'August 2024', von: 5, anzahl: 2 }
    ]
    const z = blocksatzZeilen(seiten, gruppen, 1000, 160, 4)
    expect(z.map((x) => (x.art === 'kopf' ? x.titel : `${x.von}-${x.bis}`))).toEqual([
      'Juli 2024',
      '0-4',
      '4-5',
      'August 2024',
      '5-7'
    ])
    const b = bildzeilen(z)
    expect(b[1].hoehe).toBe(160)
    expect(b[2].hoehe).toBe(160)
    expect([0, 3, 4, 5, 6].map((i) => zeileFuer(z, i))).toEqual([1, 1, 2, 4, 4])
  })

  it('Panorama und unbekannte Maße: begrenzt bzw. quadratisch, nie breiter als die Zeile', () => {
    expect(seite(0)).toBe(1)
    expect(seite(Number.NaN)).toBe(1)
    expect(seite(15)).toBe(SEITE_MAX)
    expect(seite(0.01)).toBeCloseTo(1 / 3, 6)
    // ein Panorama (auf 3:1 begrenzt) ist bei Ziel 400 breiter als 1000 px: allein, gestaucht
    const z = bildzeilen(blocksatzZeilen([15, 1, 1], [], 1000, 400, 4))
    expect(z[0]).toMatchObject({ von: 0, bis: 1 })
    expect(z[0].breiten?.[0]).toBeCloseTo(1000, 6)
    expect(z[0].hoehe).toBeCloseTo(333.33, 1)
  })

  it('robust: keine Bilder, Breite 0 vor dem Messen, unpassende Gruppen', () => {
    expect(blocksatzZeilen([], [], 1000, 160, 4)).toEqual([])
    const vorMessen = bildzeilen(blocksatzZeilen([1, 1, 1], [], 0, 160, 4))
    expect(vorMessen.every((x) => (x.hoehe ?? 0) > 0)).toBe(true)
    expect(vorMessen.reduce((a, x) => a + x.bis - x.von, 0)).toBe(3)
    // Gruppen mit Lücke: ohne Überschriften, kein Bild geht verloren
    const z = blocksatzZeilen([1, 1, 1], [{ titel: 'x', von: 1, anzahl: 2 }], 1000, 160, 4)
    expect(z.every((x) => x.art === 'bilder')).toBe(true)
  })

  it('100.000 Bilder in wenigen Millisekunden', () => {
    const seiten = Array.from({ length: 100_000 }, (_, i) => [1.5, 0.667, 1, 1.778][i % 4])
    const t0 = performance.now()
    const z = blocksatzZeilen(seiten, [], 1600, 200, 4)
    const ms = performance.now() - t0
    expect(bildzeilen(z).reduce((a, x) => a + x.bis - x.von, 0)).toBe(100_000)
    expect(ms).toBeLessThan(200)
  })
})
