import { describe, expect, it } from 'vitest'
import { dateiAufnehmen, ordnerAusgeschlossen, unterUnlesbarem } from './scanRegeln'

describe('ordnerAusgeschlossen', () => {
  it('lässt System-, Papierkorb-, versteckte und NAS-Ordner aus', () => {
    for (const n of [
      '$RECYCLE.BIN',
      'System Volume Information',
      '.git',
      '.thumbnails',
      '@eaDir',
      '#recycle',
      'AppData',
      'node_modules',
      '$WINDOWS.~BT'
    ]) {
      expect(ordnerAusgeschlossen(n), n).toBe(true)
    }
  })

  it('nimmt gewöhnliche Ordner, auch mit Punkt oder Dollar im Namen', () => {
    for (const n of ['Urlaub 2024', 'Fotos.alt', 'Preise in $', 'Kroatien', 'Bilder']) {
      expect(ordnerAusgeschlossen(n), n).toBe(false)
    }
  })
})

describe('dateiAufnehmen', () => {
  it('nimmt Bilder', () => {
    for (const n of ['IMG_0001.JPG', 'scan.tif', 'Sonne 🌞.png', '-rf.jpg'])
      expect(dateiAufnehmen(n), n).toBe(true)
  })

  it('lässt Versteckte, Zwischennamen, Office-Sperren und Nicht-Bilder aus', () => {
    for (const n of [
      '.bild.jpg',
      '._IMG_1.jpg',
      '.Bild.jpg.galerie-tmp-1a2b',
      '~$bericht.png',
      'Thumbs.db',
      'desktop.ini',
      'clip.mp4'
    ]) {
      expect(dateiAufnehmen(n), n).toBe(false)
    }
  })
})

describe('unterUnlesbarem', () => {
  it('erkennt Dateien in und unter einem unlesbaren Ordner – nicht nebenan', () => {
    const u = ['privat', 'a/b']
    expect(unterUnlesbarem('privat/x.jpg', u)).toBe(true)
    expect(unterUnlesbarem('a/b/c/d.jpg', u)).toBe(true)
    expect(unterUnlesbarem('a/b', u)).toBe(true)
    expect(unterUnlesbarem('privat2/x.jpg', u)).toBe(false)
    expect(unterUnlesbarem('a/bc/x.jpg', u)).toBe(false)
    expect(unterUnlesbarem('x.jpg', [])).toBe(false)
  })
})
