import { describe, expect, it } from 'vitest'
import {
  pruefeAnsichtNameStreng,
  pruefeAnsichtStandStreng,
  pruefeBildFilterStreng,
  pruefeGruppierungStreng,
  pruefeKennung,
  pruefeKennungen,
  pruefeOrdnerFilterStreng,
  pruefeOrdnerModus,
  pruefeSchalterStreng,
  pruefePfade,
  pruefeSortierungStreng
} from './eingaben'

describe('pruefePfade (gezogene Ordner)', () => {
  it('nimmt Listen von Pfaden bis zur Höchstzahl', () => {
    expect(pruefePfade([], 2)).toEqual([])
    expect(pruefePfade(['D:\\Bilder', '\\\\nas\\fotos', 'C:\\Ü 🌞'], 3)).toHaveLength(3)
  })

  it('lehnt zu viele, Nicht-Texte, leere und Steuerzeichen ab', () => {
    expect(() => pruefePfade(['a', 'b', 'c'], 2)).toThrow(/Pfade/)
    for (const v of [null, 'D:\\Bilder', [1], [''], ['a\u0000b'], ['a\nb'], ['x'.repeat(32_768)]]) {
      expect(() => pruefePfade(v, 5), JSON.stringify(v)).toThrow(/Pfad/)
    }
  })
})

describe('pruefeOrdnerFilterStreng', () => {
  it('wirft bei ungültigem Filter statt still zu korrigieren', () => {
    expect(pruefeOrdnerFilterStreng({ ordner: 2, pfad: 'Urlaub' })).toEqual({
      ordner: 2,
      pfad: 'Urlaub'
    })
    expect(() => pruefeOrdnerFilterStreng({ ordner: 2, pfad: '../x' })).toThrow(/Filter/)
  })
})

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

describe('pruefeBildFilterStreng', () => {
  it('liefert die saubere Kopie, wirft bei Ungültigem', () => {
    expect(pruefeBildFilterStreng({ bewertung: 3, extra: 1 })).toEqual({ bewertung: 3 })
    for (const v of [null, 'x', { bewertung: 9 }, { kameras: 'A' }, { von: 'gestern' }]) {
      expect(() => pruefeBildFilterStreng(v), JSON.stringify(v)).toThrow(/Filter/)
    }
  })
})

describe('pruefeSchalterStreng', () => {
  it('fehlt = aus, sonst nur true/false', () => {
    expect(pruefeSchalterStreng(undefined)).toBe(false)
    expect(pruefeSchalterStreng(true)).toBe(true)
    expect(pruefeSchalterStreng(false)).toBe(false)
    for (const v of [1, 0, 'true', null, {}, []]) {
      expect(() => pruefeSchalterStreng(v), String(v)).toThrow(/Schalter/)
    }
  })
})

describe('pruefeGruppierungStreng', () => {
  it('nimmt die vier Stufen, wirft bei allem anderen', () => {
    for (const g of ['aus', 'tag', 'monat', 'jahr']) expect(pruefeGruppierungStreng(g)).toBe(g)
    for (const v of ['Monat', 'woche', '', 2, null, undefined, 'constructor']) {
      expect(() => pruefeGruppierungStreng(v), String(v)).toThrow(/Gruppierung/)
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

describe('gespeicherte Ansichten', () => {
  const stand = {
    knoten: null,
    art: 'kacheln',
    groesse: 160,
    sortierung: { feld: 'aufnahme', richtung: 'ab' },
    gruppierung: 'monat',
    filter: {}
  }

  it('lässt Gültiges durch', () => {
    expect(pruefeAnsichtNameStreng(' Beste ')).toBe('Beste')
    expect(pruefeAnsichtStandStreng(stand)).toEqual(stand)
  })

  it('wirft bei Ungültigem', () => {
    expect(() => pruefeAnsichtNameStreng('')).toThrow('Ungültiger Name')
    expect(() => pruefeAnsichtNameStreng('a\u0000b')).toThrow('Ungültiger Name')
    expect(() => pruefeAnsichtStandStreng({ ...stand, art: 'x' })).toThrow('Ungültige Ansicht')
  })
})
