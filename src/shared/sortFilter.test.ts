import { describe, expect, it } from 'vitest'
import { orderBy, pruefeSortierung, SORT_FELDER, STANDARD_SORTIERUNG } from './sortFilter'

describe('Sortierung prüfen', () => {
  it('nimmt jedes bekannte Feld in beiden Richtungen an', () => {
    for (const feld of SORT_FELDER) {
      expect(pruefeSortierung({ feld, richtung: 'auf' })).toEqual({ feld, richtung: 'auf' })
      expect(pruefeSortierung({ feld, richtung: 'ab' })).toEqual({ feld, richtung: 'ab' })
    }
    expect(pruefeSortierung(STANDARD_SORTIERUNG)).toEqual(STANDARD_SORTIERUNG)
  })

  it('lehnt alles andere ab – auch SQL im Feldnamen und geerbte Schlüssel', () => {
    for (const v of [
      null,
      undefined,
      'name',
      [],
      {},
      { feld: 'name' },
      { feld: 'name', richtung: 'DESC' },
      { feld: 'id; DROP TABLE images', richtung: 'auf' },
      { feld: 'taken_at', richtung: 'auf' },
      { feld: 'constructor', richtung: 'auf' },
      { feld: 'toString', richtung: 'ab' },
      { feld: ['name'], richtung: 'auf' }
    ]) {
      expect(pruefeSortierung(v)).toBeNull()
    }
  })

  it('gibt nur die bekannten Felder zurück (keine zusätzlichen Schlüssel)', () => {
    expect(pruefeSortierung({ feld: 'groesse', richtung: 'ab', extra: 'x' })).toEqual({
      feld: 'groesse',
      richtung: 'ab'
    })
  })
})

describe('ORDER BY', () => {
  it('endet immer mit der Kennung; absteigend kehrt alles um', () => {
    expect(orderBy({ feld: 'aufnahme', richtung: 'auf' })).toBe('taken_at, id')
    expect(orderBy({ feld: 'name', richtung: 'ab' })).toBe('name_sort DESC, id DESC')
    expect(orderBy({ feld: 'geaendert', richtung: 'auf' })).toBe('mtime, id')
    expect(orderBy({ feld: 'groesse', richtung: 'auf' })).toBe('size, id')
    expect(orderBy({ feld: 'typ', richtung: 'ab' })).toBe('ext DESC, name_sort DESC, id DESC')
  })

  it('wirft bei einem ungeprüften Feld, statt etwas ins SQL zu schreiben', () => {
    expect(() => orderBy({ feld: 'id; --' as unknown as 'name', richtung: 'auf' })).toThrow(
      /Unbekannt/
    )
  })
})
