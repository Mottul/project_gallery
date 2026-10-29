import { describe, expect, it } from 'vitest'
import { alleFelderAus, FELDER_MAX, WERT_MAX } from './alleFelder'

describe('alleFelderAus', () => {
  it('Gruppe und Name getrennt, Werte als Text; Pfade und ExifTool selbst nicht', () => {
    expect(
      alleFelderAus({
        SourceFile: 'C:/Bilder/a.jpg',
        'ExifTool:ExifToolVersion': 13.59,
        'System:Directory': 'C:/Bilder',
        'System:FileName': 'a.jpg',
        'IFD0:Make': 'Galeria',
        'ExifIFD:FNumber': 8,
        'XMP-dc:Subject': ['Urlaub', 'Meer'],
        'Composite:GPSPosition': '42 deg 39\' 2.52" N, 18 deg 5\' 39.84" E'
      })
    ).toEqual([
      { gruppe: 'System', name: 'FileName', wert: 'a.jpg' },
      { gruppe: 'IFD0', name: 'Make', wert: 'Galeria' },
      { gruppe: 'ExifIFD', name: 'FNumber', wert: '8' },
      { gruppe: 'XMP-dc', name: 'Subject', wert: 'Urlaub, Meer' },
      { gruppe: 'Composite', name: 'GPSPosition', wert: '42 deg 39\' 2.52" N, 18 deg 5\' 39.84" E' }
    ])
  })

  it('fremde Werte: Steuerzeichen weg, lange gekürzt, Leeres fällt weg, Anzahl begrenzt', () => {
    const f = alleFelderAus({
      'XMP-dc:Title': 'a\u0000b\nc',
      'XMP-dc:Description': 'x'.repeat(5000),
      'IFD0:Leer': '   ',
      'IFD0:Struktur': { a: 1 }
    })
    expect(f[0].wert).toBe('a b c')
    expect(f[1].wert).toHaveLength(WERT_MAX)
    expect(f.map((x) => x.name)).toEqual(['Title', 'Description', 'Struktur'])
    const viele = Object.fromEntries(Array.from({ length: 5000 }, (_, i) => [`G:F${i}`, i]))
    expect(alleFelderAus(viele)).toHaveLength(FELDER_MAX)
    expect(alleFelderAus(null)).toEqual([])
    expect(alleFelderAus([1, 2])).toEqual([])
  })
})
