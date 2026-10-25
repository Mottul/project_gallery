import { describe, expect, it } from 'vitest'
import { endungVon, formatAusEndung } from './bildFormate'

describe('formatAusEndung', () => {
  it('erkennt die Bildformate aus Phase 1, ohne Groß/Klein', () => {
    expect(formatAusEndung('Urlaub.JPG')).toBe('jpeg')
    expect(formatAusEndung('a.jpeg')).toBe('jpeg')
    expect(formatAusEndung('scan.TIF')).toBe('tiff')
    expect(formatAusEndung('x.webp')).toBe('webp')
    expect(formatAusEndung('alt.bmp')).toBe('bmp')
    expect(formatAusEndung('neu.avif')).toBe('avif')
  })

  it('lässt Videos, RAW, HEIC und alles andere (noch) weg', () => {
    for (const n of [
      'clip.mp4',
      'IMG_1.HEIC',
      'raw.CR3',
      'notiz.txt',
      'testbilder.json',
      'Thumbs.db'
    ]) {
      expect(formatAusEndung(n), n).toBeNull()
    }
  })

  it('braucht eine echte Endung', () => {
    expect(formatAusEndung('jpg')).toBeNull()
    expect(formatAusEndung('.jpg')).toBeNull()
    expect(formatAusEndung('bild.')).toBeNull()
    expect(endungVon('a.b.PNG')).toBe('png')
  })

  it('kennt keine Prototyp-Schlüssel als Endung', () => {
    expect(formatAusEndung('x.constructor')).toBeNull()
    expect(formatAusEndung('x.__proto__')).toBeNull()
  })
})
