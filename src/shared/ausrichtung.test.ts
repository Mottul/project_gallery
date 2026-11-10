import { describe, expect, it } from 'vitest'
import {
  ausrichtungAus,
  drehbar,
  drehungText,
  gedreht,
  gedrehtText,
  getauscht,
  istAusrichtung,
  nichtDrehbarText,
  pruefeDrehung,
  tastenDrehung,
  type Drehung
} from './ausrichtung'

type Matrix = [[number, number], [number, number]]

/**
 * Was ein Betrachter mit den gespeicherten Pixeln macht, unabhängig von der Tabelle im Code aus der
 * EXIF-Norm abgeleitet (wohin Zeile 0 und Spalte 0 kommen); Bildschirm-Koordinaten, y nach unten.
 */
const NORM: Record<number, Matrix> = {
  1: [
    [1, 0],
    [0, 1]
  ],
  2: [
    [-1, 0],
    [0, 1]
  ], // waagerecht gespiegelt
  3: [
    [-1, 0],
    [0, -1]
  ], // 180°
  4: [
    [1, 0],
    [0, -1]
  ], // senkrecht gespiegelt
  5: [
    [0, 1],
    [1, 0]
  ], // transponiert
  6: [
    [0, -1],
    [1, 0]
  ], // 90° im Uhrzeigersinn
  7: [
    [0, -1],
    [-1, 0]
  ], // transversal
  8: [
    [0, 1],
    [-1, 0]
  ] // 90° gegen den Uhrzeigersinn
}
const RECHTS: Matrix = NORM[6]
const LINKS: Matrix = NORM[8]

/** Matrixprodukt; „+ 0“ macht aus -0 eine 0 (toEqual unterscheidet beide) */
const mal = (a: Matrix, b: Matrix): Matrix => [
  [a[0][0] * b[0][0] + a[0][1] * b[1][0] + 0, a[0][0] * b[0][1] + a[0][1] * b[1][1] + 0],
  [a[1][0] * b[0][0] + a[1][1] * b[1][0] + 0, a[1][0] * b[0][1] + a[1][1] * b[1][1] + 0]
]

describe('gedreht', () => {
  it.each([1, 2, 3, 4, 5, 6, 7, 8])(
    'Ausrichtung %i: das angezeigte Bild dreht sich um 90° – auch gespiegelt',
    (o) => {
      // erst die gespeicherten Pixel wie bisher zeigen, dann das Ergebnis drehen
      expect(NORM[gedreht(o, 'rechts')]).toEqual(mal(RECHTS, NORM[o]))
      expect(NORM[gedreht(o, 'links')]).toEqual(mal(LINKS, NORM[o]))
    }
  )

  it('die Tabelle aus dem Labor (sharp und Chromium zeigten jeden Fall richtig)', () => {
    const rechts = [1, 2, 3, 4, 5, 6, 7, 8].map((o) => gedreht(o, 'rechts'))
    const links = [1, 2, 3, 4, 5, 6, 7, 8].map((o) => gedreht(o, 'links'))
    expect(rechts).toEqual([6, 7, 8, 5, 2, 3, 4, 1])
    expect(links).toEqual([8, 5, 6, 7, 4, 1, 2, 3])
  })

  it('viermal in dieselbe Richtung oder hin und zurück ergibt den Anfang', () => {
    for (let o = 1; o <= 8; o++) {
      for (const d of ['rechts', 'links'] as Drehung[]) {
        let x = o
        for (let i = 0; i < 4; i++) x = gedreht(x, d)
        expect(x).toBe(o)
      }
      expect(gedreht(gedreht(o, 'rechts'), 'links')).toBe(o)
    }
  })

  it('die Maße tauschen bei jeder Drehung', () => {
    for (let o = 1; o <= 8; o++) {
      expect(getauscht(gedreht(o, 'rechts'))).toBe(!getauscht(o))
    }
    expect([1, 2, 3, 4, 5, 6, 7, 8].map(getauscht)).toEqual([
      false,
      false,
      false,
      false,
      true,
      true,
      true,
      true
    ])
  })

  it('fehlende oder ungültige Ausrichtung gilt wie bei Chromium und sharp als 1', () => {
    for (const v of [undefined, null, 0, 9, -1, 6.5, '6', NaN]) {
      expect(ausrichtungAus(v)).toBe(1)
      expect(istAusrichtung(v)).toBe(false)
      expect(gedreht(v as number, 'rechts')).toBe(6)
    }
    expect(ausrichtungAus(6)).toBe(6)
  })
})

describe('drehbar', () => {
  it('nur JPEG und TIFF (gemessen); alles andere mit klarer Meldung', () => {
    expect(drehbar('jpeg')).toBe(true)
    expect(drehbar('tiff')).toBe(true)
    for (const f of ['png', 'webp', 'avif', 'gif', 'bmp', 'mp4', '', null]) {
      expect(drehbar(f)).toBe(false)
    }
    expect(nichtDrehbarText('png')).toBe(
      'PNG-Dateien lassen sich nicht verlustfrei drehen – das geht nur bei JPEG und TIFF.'
    )
    expect(nichtDrehbarText(null)).toMatch(/^Diese Datei lässt sich nicht verlustfrei drehen/)
  })
})

describe('pruefeDrehung', () => {
  it('nimmt nur rechts und links', () => {
    expect(pruefeDrehung('rechts')).toBe('rechts')
    expect(pruefeDrehung('links')).toBe('links')
    for (const v of ['Rechts', 90, null, undefined, {}, ['rechts']]) {
      expect(pruefeDrehung(v)).toBeNull()
    }
    expect(drehungText('links')).toBe('um 90° nach links')
    expect(gedrehtText('rechts')).toBe('Um 90° nach rechts gedreht')
  })

  it('Tasten R und L, auch mit Feststelltaste; sonst keine', () => {
    expect(['r', 'R', 'l', 'L'].map(tastenDrehung)).toEqual(['rechts', 'rechts', 'links', 'links'])
    for (const t of ['e', '1', 'ArrowRight', 'rr', '']) expect(tastenDrehung(t)).toBeNull()
  })
})
