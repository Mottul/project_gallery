import { describe, expect, it } from 'vitest'
import { baueBaum, type Zweig } from './ordnerBaum'

/** Kurzform eines Baums: „name:anzahl“ mit Kindern */
const kurz = (z: Zweig): unknown =>
  z.kinder.length ? { [`${z.name}:${z.anzahl}`]: z.kinder.map(kurz) } : `${z.name}:${z.anzahl}`

describe('Ordnerbaum', () => {
  it('summiert Unterordner, ergänzt Zwischenstufen, sortiert natürlich', () => {
    const baum = baueBaum([
      { path: '', count: 2 },
      { path: 'Urlaub/2024/Juli', count: 3 },
      { path: 'Urlaub/2023', count: 1 },
      { path: 'Bild 10', count: 1 },
      { path: 'Bild 2', count: 4 },
      { path: 'Übersicht', count: 5 }
    ])
    expect(baum.anzahl).toBe(16)
    expect(baum.kinder.map(kurz)).toEqual([
      'Bild 2:4',
      'Bild 10:1',
      'Übersicht:5',
      { 'Urlaub:4': ['2023:1', { '2024:3': ['Juli:3'] }] }
    ])
    // ergänzte Stufe ohne eigene Bilder trägt den vollen Pfad
    const urlaub = baum.kinder.find((k) => k.name === 'Urlaub') as Zweig
    expect(urlaub.kinder[1].pfad).toBe('Urlaub/2024')
    expect(urlaub.kinder[1].kinder[0].pfad).toBe('Urlaub/2024/Juli')
  })

  it('leerer Ordner: Wurzel ohne Kinder', () => {
    expect(baueBaum([])).toEqual({ name: '', pfad: '', anzahl: 0, kinder: [] })
  })
})
