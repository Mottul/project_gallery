import { describe, expect, it } from 'vitest'
import { leseThumbUrl, thumbUrl } from './vorschau'

describe('thumb://-Adressen', () => {
  it('baut und liest Kennung und Stufe', () => {
    expect(thumbUrl(42, 256)).toBe('thumb://id/42/256')
    expect(thumbUrl(42, 768, 1700000000000)).toBe('thumb://id/42/768?v=1700000000000')
    expect(leseThumbUrl(thumbUrl(42, 256))).toEqual({ id: 42, stufe: 256 })
    expect(leseThumbUrl(thumbUrl(7, 768, 123))).toEqual({ id: 7, stufe: 768 })
  })

  it('lehnt alles andere ab', () => {
    for (const url of [
      'thumb://id/0/256',
      'thumb://id/-1/256',
      'thumb://id/01/256',
      'thumb://id/1.5/256',
      'thumb://id/1/512',
      'thumb://id/1/256/x',
      'thumb://id/1',
      'thumb://id/abc/256',
      'thumb://id/99999999999999999/256',
      'thumb://42/256',
      'thumb://0.0.0.42/256',
      'thumb://anders/1/256',
      'thumb://nutzer:pw@id/1/256',
      'thumb://id/1/..%2f..%2fwindows',
      'thumb://id/1/256%2f..',
      'thumb://id/..%2e/256',
      'bild://id/1/256',
      'file:///C:/Bilder/a.jpg',
      'kein url'
    ]) {
      expect(leseThumbUrl(url), url).toBeNull()
    }
  })

  it('„..“ führt nie aus dem Muster: aufgelöst bleibt nur eine gültige Adresse übrig', () => {
    // URL löst Punkt-Segmente auf – übrig bleibt höchstens eine andere GÜLTIGE Adresse
    expect(leseThumbUrl('thumb://id/1/x/../256')).toEqual({ id: 1, stufe: 256 })
    expect(leseThumbUrl('thumb://id/../../etc/passwd')).toBeNull()
    expect(leseThumbUrl('thumb://id/%2e%2e/%2e%2e/1/256')).toEqual({ id: 1, stufe: 256 })
  })
})
