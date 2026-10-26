import { describe, expect, it } from 'vitest'
import { bildUrl, direktTyp, leseBildUrl, leseRange } from './bild'

describe('bild://-Adressen', () => {
  it('baut und liest die Kennung', () => {
    expect(bildUrl(42)).toBe('bild://id/42')
    expect(bildUrl(42, 1700000000000)).toBe('bild://id/42?v=1700000000000')
    expect(leseBildUrl(bildUrl(42, 5))).toEqual({ id: 42 })
  })

  it('lehnt alles andere ab', () => {
    for (const url of [
      'bild://id/0',
      'bild://id/01',
      'bild://id/-1',
      'bild://id/1/256',
      'bild://id/abc',
      'bild://42',
      'bild://anders/1',
      'bild://nutzer@id/1',
      'bild://id/1%2f..',
      'thumb://id/1/256',
      'file:///C:/x.jpg',
      'kein url'
    ]) {
      expect(leseBildUrl(url), url).toBeNull()
    }
    // Punkt-Segmente löst URL auf – übrig bleibt höchstens eine andere gültige Adresse
    expect(leseBildUrl('bild://id/../../windows/win.ini')).toBeNull()
  })
})

describe('Inhaltstyp', () => {
  it('nach dem Format laut Inhalt; ohne Format nach der Endung', () => {
    expect(direktTyp('jpeg', 'jpg')).toBe('image/jpeg')
    // PNG mit .jpg-Endung: der Inhalt zählt
    expect(direktTyp('png', 'jpg')).toBe('image/png')
    expect(direktTyp('bmp', 'bmp')).toBe('image/bmp')
    expect(direktTyp(null, 'webp')).toBe('image/webp')
    expect(direktTyp(null, 'JPG')).toBe('image/jpeg')
  })

  it('TIFF und Unbekanntes werden umgerechnet (null)', () => {
    expect(direktTyp('tiff', 'tif')).toBeNull()
    expect(direktTyp(null, 'tif')).toBeNull()
    expect(direktTyp('txt', 'png')).toBeNull()
    expect(direktTyp(null, '')).toBeNull()
    expect(direktTyp('constructor', 'x')).toBeNull()
  })
})

describe('Range-Kopf', () => {
  it('liest die üblichen Formen', () => {
    expect(leseRange(null, 100)).toBeNull()
    expect(leseRange('bytes=0-9', 100)).toEqual([0, 9])
    expect(leseRange('bytes=90-', 100)).toEqual([90, 99])
    expect(leseRange('bytes=-10', 100)).toEqual([90, 99])
    expect(leseRange('bytes=-500', 100)).toEqual([0, 99])
    // Ende über die Datei hinaus: gekürzt
    expect(leseRange('bytes=50-1000', 100)).toEqual([50, 99])
  })

  it('außerhalb der Datei: 416; Unverständliches oder mehrere Bereiche: das Ganze', () => {
    expect(leseRange('bytes=100-', 100)).toBe('ungueltig')
    expect(leseRange('bytes=20-10', 100)).toBe('ungueltig')
    expect(leseRange('bytes=-0', 100)).toBe('ungueltig')
    expect(leseRange('bytes=0-1,5-6', 100)).toBeNull()
    expect(leseRange('items=0-1', 100)).toBeNull()
    expect(leseRange('bytes=-', 100)).toBeNull()
  })
})
