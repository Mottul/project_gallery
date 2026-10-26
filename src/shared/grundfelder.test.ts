// Fälle aus der echten ExifTool-Ausgabe der Testbibliothek (Labor 1.2, ExifTool 13.59)
import { describe, expect, it } from 'vitest'
import { lokalAusMs } from './dates'
import { GRUNDFELD_TAGS, grundfelderAus } from './grundfelder'

const JETZT = Date.UTC(2026, 9, 25, 12)
const DATEI = { btime: Date.UTC(2026, 9, 25, 9), mtime: Date.UTC(2026, 9, 25, 10) }

describe('grundfelderAus', () => {
  it('Foto mit Ausrichtung 6: Maße aufgerichtet, Datum aus EXIF', () => {
    const g = grundfelderAus(
      {
        'EXIF:DateTimeOriginal': '2024:05:06 12:00:00',
        'EXIF:CreateDate': '2024:05:06 12:00:00',
        'EXIF:Orientation': 6,
        'Composite:ImageSize': '200 300',
        'File:FileType': 'JPEG',
        'EXIF:Make': 'Galeria',
        'EXIF:Model': 'Testkamera A'
      },
      DATEI,
      JETZT
    )
    expect(g).toEqual({
      breite: 300,
      hoehe: 200,
      ausrichtung: 6,
      format: 'jpeg',
      kameraHersteller: 'Galeria',
      kameraModell: 'Testkamera A',
      aufnahme: { lokal: '2024-05-06T12:00:00', offset: null, quelle: 'exif' },
      fehler: null
    })
  })

  it('Ausrichtung 1–4 lässt die Maße, 5–8 tauscht sie', () => {
    for (let o = 1; o <= 8; o++) {
      const g = grundfelderAus(
        { 'EXIF:Orientation': o, 'Composite:ImageSize': '400x300' },
        DATEI,
        JETZT
      )
      expect([g.breite, g.hoehe], `Ausrichtung ${o}`).toEqual(o >= 5 ? [300, 400] : [400, 300])
    }
  })

  it('Zone aus OffsetTimeOriginal', () => {
    const g = grundfelderAus(
      { 'EXIF:DateTimeOriginal': '2024:07:14 18:30:05', 'EXIF:OffsetTimeOriginal': '+02:00' },
      DATEI,
      JETZT
    )
    expect(g.aufnahme).toEqual({ lokal: '2024-07-14T18:30:05', offset: '+02:00', quelle: 'exif' })
  })

  it('PNG mit .jpg-Endung: Format nach Inhalt; ohne Datum die ältere Dateizeit', () => {
    const g = grundfelderAus(
      { 'Composite:ImageSize': '120 90', 'File:FileType': 'PNG' },
      DATEI,
      JETZT
    )
    expect(g.format).toBe('png')
    // animiertes WebP: FileType mit Leerzeichen, dann gilt die Kennung der Endung
    expect(
      grundfelderAus(
        { 'File:FileType': 'Extended WEBP', 'File:FileTypeExtension': 'WEBP' },
        DATEI,
        JETZT
      ).format
    ).toBe('webp')
    expect(g.aufnahme).toEqual({
      lokal: lokalAusMs(DATEI.btime),
      offset: null,
      quelle: 'datei-erstellt'
    })
  })

  it('leere oder nicht gelesene Datei: Fehler, keine Maße, Dateizeit als Datum', () => {
    const leer = grundfelderAus({ 'ExifTool:Error': 'File is empty' }, DATEI, JETZT)
    expect(leer).toMatchObject({ breite: null, hoehe: null, format: null, fehler: 'File is empty' })
    expect(leer.aufnahme.quelle).toBe('datei-erstellt')
    expect(grundfelderAus(null, DATEI, JETZT).fehler).toBe('nicht gelesen')
  })

  it('übernimmt nichts Unplausibles aus fremden Dateien', () => {
    const g = grundfelderAus(
      {
        'EXIF:Orientation': 99,
        'Composite:ImageSize': '0 5000000',
        'File:FileType': '<script>',
        'EXIF:Make': 'Canon\u0000\u0000\u0000',
        'EXIF:Model': { boese: true },
        'EXIF:DateTimeOriginal': ['2024:01:01 00:00:00']
      },
      DATEI,
      JETZT
    )
    expect(g).toMatchObject({
      ausrichtung: null,
      breite: null,
      hoehe: null,
      format: null,
      kameraHersteller: 'Canon',
      kameraModell: null
    })
    expect(g.aufnahme.quelle).toBe('datei-erstellt')
    expect(
      grundfelderAus({ 'EXIF:Make': 'x'.repeat(500) }, DATEI, JETZT).kameraHersteller
    ).toHaveLength(64)
  })

  it('fragt Fehler und Warnungen ausdrücklich ab', () => {
    expect(GRUNDFELD_TAGS).toEqual(expect.arrayContaining(['-ExifTool:Error', '-ExifTool:Warning']))
  })
})
