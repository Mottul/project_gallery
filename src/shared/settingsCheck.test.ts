import { describe, expect, it } from 'vitest'
import { bereinigeEinstellungen, pruefeAenderung } from './settingsCheck'
import { DEFAULT_SETTINGS } from './types'

describe('pruefeAenderung', () => {
  it('nimmt gültige Teiländerungen', () => {
    expect(pruefeAenderung({ theme: 'light' })).toEqual({ theme: 'light' })
    expect(pruefeAenderung({ theme: 'system' })).toEqual({ theme: 'system' })
    expect(pruefeAenderung({})).toEqual({})
    // undefined heißt „nicht ändern“
    expect(pruefeAenderung({ theme: undefined })).toEqual({})
  })

  it('lehnt ungültige Werte ab', () => {
    for (const theme of ['blau', 'Light', '', 1, null, ['dark'], { dark: true }]) {
      expect(() => pruefeAenderung({ theme }), String(theme)).toThrow(/ungültiger Wert/)
    }
  })

  it('lehnt unbekannte Felder und Nicht-Objekte ab', () => {
    expect(() => pruefeAenderung({ theme: 'dark', fremd: 1 })).toThrow(/unbekanntes Feld/)
    expect(() => pruefeAenderung(JSON.parse('{"__proto__": {"x": 1}}'))).toThrow(/unbekanntes Feld/)
    for (const raw of [null, undefined, 'theme', 42, ['theme']]) {
      expect(() => pruefeAenderung(raw), String(raw)).toThrow(/kein Objekt/)
    }
  })
})

describe('bereinigeEinstellungen', () => {
  it('übernimmt gültige Werte', () => {
    expect(bereinigeEinstellungen({ theme: 'dark' })).toEqual({
      ...DEFAULT_SETTINGS,
      theme: 'dark'
    })
  })

  it('setzt ungültige Werte auf die Vorgabe und lässt Unbekanntes weg', () => {
    expect(bereinigeEinstellungen({ theme: 'lila', alt: true })).toEqual(DEFAULT_SETTINGS)
  })

  it('startet mit Vorgaben, wenn die Datei kein Objekt enthält', () => {
    for (const raw of [null, 'x', 3, []])
      expect(bereinigeEinstellungen(raw)).toEqual(DEFAULT_SETTINGS)
  })

  it('gibt nie die Vorgabe selbst heraus (wird später geändert)', () => {
    expect(bereinigeEinstellungen({})).not.toBe(DEFAULT_SETTINGS)
  })
})
