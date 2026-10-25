import { describe, expect, it } from 'vitest'
import { nameSortKey } from './sortKey'

const sortiert = (namen: string[]): string[] =>
  [...namen].sort((a, b) =>
    nameSortKey(a) < nameSortKey(b) ? -1 : nameSortKey(a) > nameSortKey(b) ? 1 : 0
  )

describe('nameSortKey', () => {
  it('sortiert Zahlen natürlich', () => {
    expect(sortiert(['Bild 10.jpg', 'Bild 2.jpg', 'Bild 1.jpg', 'Bild 100.jpg'])).toEqual([
      'Bild 1.jpg',
      'Bild 2.jpg',
      'Bild 10.jpg',
      'Bild 100.jpg'
    ])
    expect(sortiert(['IMG_0010.jpg', 'IMG_9.jpg', 'IMG_011.jpg'])).toEqual([
      'IMG_9.jpg',
      'IMG_0010.jpg',
      'IMG_011.jpg'
    ])
  })

  it('ohne Groß/Klein', () => {
    expect(nameSortKey('Bild 2.JPG')).toBe(nameSortKey('bild 2.jpg'))
    expect(sortiert(['b.jpg', 'A.jpg', 'a2.jpg', 'B1.jpg'])).toEqual([
      'A.jpg',
      'a2.jpg',
      'b.jpg',
      'B1.jpg'
    ])
  })

  it('Umlaute wie im Telefonbuch (ä wie a, ß wie ss), auch zusammengesetzt geschrieben', () => {
    expect(sortiert(['Zürich.jpg', 'Übersicht.jpg', 'Ulm.jpg', 'Ost.jpg', 'Öl.jpg'])).toEqual([
      'Öl.jpg',
      'Ost.jpg',
      'Übersicht.jpg',
      'Ulm.jpg',
      'Zürich.jpg'
    ])
    expect(nameSortKey('Straße')).toBe(nameSortKey('Strasse'))
    // „ä“ als ein Zeichen (NFC) und als a + Trema (NFD, z. B. von macOS) ergeben denselben Schlüssel
    const nfc = 'Bär'.normalize('NFC')
    const nfd = nfc.normalize('NFD')
    expect(nfd).not.toBe(nfc)
    expect(nameSortKey(nfc)).toBe(nameSortKey(nfd))
  })

  it('Zahlen stehen vor Buchstaben, Emoji stören nicht', () => {
    expect(sortiert(['abc.jpg', '2024.jpg', 'Sonne 🌞.jpg'])).toEqual([
      '2024.jpg',
      'abc.jpg',
      'Sonne 🌞.jpg'
    ])
  })

  it('führende Nullen allein machen keinen Unterschied in der Reihenfolge gegenüber größeren Zahlen', () => {
    expect(sortiert(['x 007.jpg', 'x 8.jpg'])).toEqual(['x 007.jpg', 'x 8.jpg'])
  })

  it('wie der Explorer: Satzzeichen vor Zahlen vor Buchstaben', () => {
    expect(sortiert(['ab.jpg', 'a2.jpg', 'a.jpg', 'a_1.jpg'])).toEqual([
      'a.jpg',
      'a_1.jpg',
      'a2.jpg',
      'ab.jpg'
    ])
  })
})
