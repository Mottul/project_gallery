import { describe, expect, it } from 'vitest'
import { ersteZeileAb, zeileFuer, zeilenBilden, zeilenOben } from './zeilen'

const G = [
  { titel: 'Juli 2024', von: 0, anzahl: 5 },
  { titel: 'August 2024', von: 5, anzahl: 1 }
]

describe('Zeilen mit Gruppen-Überschriften', () => {
  it('je Gruppe eine Kopfzeile, Bilder in Zeilen zu „spalten“, jede Gruppe in neuer Zeile', () => {
    expect(zeilenBilden(6, G, 3)).toEqual([
      { art: 'kopf', von: 0, titel: 'Juli 2024', anzahl: 5 },
      { art: 'bilder', von: 0, bis: 3 },
      { art: 'bilder', von: 3, bis: 5 },
      { art: 'kopf', von: 5, titel: 'August 2024', anzahl: 1 },
      { art: 'bilder', von: 5, bis: 6 }
    ])
  })

  it('ohne Gruppen oder mit unpassenden Gruppen: nur Bildzeilen, kein Bild geht verloren', () => {
    const ohne = [
      { art: 'bilder', von: 0, bis: 4 },
      { art: 'bilder', von: 4, bis: 6 }
    ]
    expect(zeilenBilden(6, [], 4)).toEqual(ohne)
    // Lücke, Überlappung, falsche Summe: lieber ohne Überschriften
    expect(zeilenBilden(6, [{ titel: 'x', von: 0, anzahl: 5 }], 4)).toEqual(ohne)
    expect(zeilenBilden(6, [{ titel: 'x', von: 1, anzahl: 5 }], 4)).toEqual(ohne)
    expect(zeilenBilden(6, [...G.slice(0, 1), { titel: 'y', von: 4, anzahl: 2 }], 4)).toEqual(ohne)
    expect(zeilenBilden(0, [], 4)).toEqual([])
  })

  it('findet die Zeile eines Bildes, nie die Kopfzeile', () => {
    const z = zeilenBilden(6, G, 3)
    expect([0, 1, 2, 3, 4, 5].map((i) => zeileFuer(z, i))).toEqual([1, 1, 1, 2, 2, 4])
    expect(zeileFuer(z, 6)).toBe(-1)
    expect(zeileFuer(z, -1)).toBe(-1)
    // Liste: eine Spalte
    const liste = zeilenBilden(6, G, 1)
    expect(liste).toHaveLength(8)
    expect(zeileFuer(liste, 5)).toBe(7)
  })

  it('obere Kanten und erste Zeile unter einer Höhe', () => {
    const z = zeilenBilden(6, G, 3)
    const oben = zeilenOben(z, (x) => (x.art === 'kopf' ? 40 : 100), 16)
    expect([...oben]).toEqual([16, 56, 156, 256, 296, 396])
    expect(ersteZeileAb(oben, 0)).toBe(0)
    expect(ersteZeileAb(oben, 56)).toBe(1)
    expect(ersteZeileAb(oben, 300)).toBe(4)
    expect(ersteZeileAb(oben, 9999)).toBe(5)
  })
})
