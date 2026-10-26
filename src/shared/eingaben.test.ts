import { describe, expect, it } from 'vitest'
import {
  pruefeKennung,
  pruefeKennungen,
  pruefeOrdnerModus,
  pruefeSortierungStreng
} from './eingaben'

describe('pruefeKennung', () => {
  it('nimmt ganze Zahlen ab 1', () => {
    expect(pruefeKennung(1)).toBe(1)
    expect(pruefeKennung(123456)).toBe(123456)
  })

  it('lehnt alles andere ab', () => {
    for (const v of [0, -1, 1.5, NaN, Infinity, 2 ** 53, '1', null, undefined, {}, [1]]) {
      expect(() => pruefeKennung(v), String(v)).toThrow(/Kennung/)
    }
  })
})

describe('pruefeKennungen', () => {
  it('nimmt Listen gültiger Kennungen bis zur Höchstzahl', () => {
    expect(pruefeKennungen([], 3)).toEqual([])
    expect(pruefeKennungen([3, 1, 2], 3)).toEqual([3, 1, 2])
  })

  it('lehnt zu lange Listen, Nicht-Listen und ungültige Einträge ab', () => {
    expect(() => pruefeKennungen([1, 2, 3, 4], 3)).toThrow(/Kennungen/)
    for (const v of [null, 1, '1,2', { length: 1, 0: 1 }]) {
      expect(() => pruefeKennungen(v, 3), String(v)).toThrow(/Kennungen/)
    }
    expect(() => pruefeKennungen([1, 0], 3)).toThrow(/Kennung/)
    expect(() => pruefeKennungen([1, '2'], 3)).toThrow(/Kennung/)
  })
})

describe('pruefeSortierungStreng', () => {
  it('wirft bei ungültiger Sortierung statt still zu korrigieren', () => {
    expect(pruefeSortierungStreng({ feld: 'name', richtung: 'ab' })).toEqual({
      feld: 'name',
      richtung: 'ab'
    })
    expect(() => pruefeSortierungStreng({ feld: 'name; --', richtung: 'ab' })).toThrow(/Sortierung/)
  })
})

describe('pruefeOrdnerModus', () => {
  it('nimmt nur die drei Modi', () => {
    expect(pruefeOrdnerModus('normal')).toBe('normal')
    expect(pruefeOrdnerModus('nur-lesen')).toBe('nur-lesen')
    expect(pruefeOrdnerModus('privat')).toBe('privat')
    for (const v of ['Normal', 'lesen', '', 1, null, 'constructor']) {
      expect(() => pruefeOrdnerModus(v), String(v)).toThrow(/Modus/)
    }
  })
})
