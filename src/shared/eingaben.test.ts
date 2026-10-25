import { describe, expect, it } from 'vitest'
import { pruefeKennung, pruefeOrdnerModus } from './eingaben'

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
