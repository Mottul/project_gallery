import { describe, expect, it } from 'vitest'
import {
  orderBy,
  pruefeOrdnerFilter,
  pruefeSortierung,
  SORT_FELDER,
  STANDARD_SORTIERUNG,
  unterordnerBereich
} from './sortFilter'

describe('Ordner-Filter', () => {
  it('nimmt ganzen Ordner und echte Unterordner (auch mit Umlauten, Leerzeichen, Punkten)', () => {
    expect(pruefeOrdnerFilter({ ordner: 3, pfad: '' })).toEqual({ ordner: 3, pfad: '' })
    for (const pfad of [
      'Urlaub',
      'Urlaub/2024',
      'Übersicht äöü/Sonne 🌞',
      'a.b/.versteckt',
      'pCc'
    ]) {
      expect(pruefeOrdnerFilter({ ordner: 1, pfad, extra: 1 }), pfad).toEqual({ ordner: 1, pfad })
    }
  })

  it('lehnt „..“, leere Teile, Rückstriche, Steuerzeichen und falsche Typen ab', () => {
    for (const v of [
      null,
      'Urlaub',
      { ordner: 0, pfad: '' },
      { ordner: 1.5, pfad: '' },
      { ordner: '1', pfad: '' },
      { ordner: 1 },
      { ordner: 1, pfad: '..' },
      { ordner: 1, pfad: 'a/../b' },
      { ordner: 1, pfad: './a' },
      { ordner: 1, pfad: '/a' },
      { ordner: 1, pfad: 'a/' },
      { ordner: 1, pfad: 'a//b' },
      { ordner: 1, pfad: 'a\\b' },
      { ordner: 1, pfad: 'a\u0000b' },
      { ordner: 1, pfad: 'a\nb' },
      { ordner: 1, pfad: 'x'.repeat(4097) }
    ]) {
      expect(pruefeOrdnerFilter(v), JSON.stringify(v)).toBeNull()
    }
  })

  it('Bereich unter einem Unterordner: genau seine Einträge, nicht die Geschwister', () => {
    const [von, bis] = unterordnerBereich('urlaub')
    const drin = (k: string): boolean => k >= von && k < bis
    expect(['urlaub/a.jpg', 'urlaub/2024/b.jpg', 'urlaub/ü.jpg'].every(drin)).toBe(true)
    expect(
      ['urlaub.jpg', 'urlaub 2/a.jpg', 'urlaub-x/a.jpg', 'urlaubx/a.jpg', 'urlaub'].some(drin)
    ).toBe(false)
  })
})

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
