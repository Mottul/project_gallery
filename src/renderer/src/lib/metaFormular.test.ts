import { describe, expect, it } from 'vitest'
import type { MetaWerte } from '@shared/metaFields'
import { aenderungAus, formAus, standortLesen, standortText } from './metaFormular'

const LEER: MetaWerte = {
  bewertung: 0,
  farblabel: null,
  titel: null,
  beschreibung: null,
  stichwoerter: [],
  aufnahme: null,
  standort: null,
  ort: null,
  region: null,
  land: null,
  ortsteil: null,
  urheber: null,
  copyright: null
}
const VOLL: MetaWerte = {
  bewertung: 3,
  farblabel: 'Red',
  titel: 'Hafen',
  beschreibung: 'a\nb',
  stichwoerter: ['Meer', 'Süden'],
  aufnahme: { lokal: '2021-06-05T14:03:02', offset: '+02:00' },
  standort: { breite: 42.640278, laenge: 18.108333 },
  ort: 'Dubrovnik',
  region: 'Dalmatien',
  land: 'Kroatien',
  ortsteil: 'Altstadt',
  urheber: 'Ich',
  copyright: '© Ich'
}

describe('aenderungAus', () => {
  it('nichts geändert: leer, auch wenn nur gelesen wurde', () => {
    expect(aenderungAus(LEER, formAus(LEER))).toEqual({})
    expect(aenderungAus(VOLL, formAus(VOLL))).toEqual({})
  })

  it('nur das Geänderte: die anderen Felder fehlen', () => {
    expect(aenderungAus(VOLL, { ...formAus(VOLL), titel: 'Neu' })).toEqual({ titel: 'Neu' })
    expect(aenderungAus(VOLL, { ...formAus(VOLL), bewertung: 0 })).toEqual({ bewertung: 0 })
  })

  it('leerer Text entfernt den Wert, Leerzeichen am Rand zählen nicht', () => {
    expect(aenderungAus(VOLL, { ...formAus(VOLL), ort: '  ' })).toEqual({ ort: null })
    expect(aenderungAus(VOLL, { ...formAus(VOLL), titel: ' Hafen ' })).toEqual({})
  })

  it('Stichwörter als ganze Liste, auch die Reihenfolge zählt', () => {
    expect(aenderungAus(VOLL, { ...formAus(VOLL), stichwoerter: ['Meer'] })).toEqual({
      stichwoerter: ['Meer']
    })
    expect(aenderungAus(VOLL, { ...formAus(VOLL), stichwoerter: [] })).toEqual({ stichwoerter: [] })
  })

  it('Farblabel entfernen; ein fremdes Label bleibt unberührt', () => {
    expect(aenderungAus(VOLL, { ...formAus(VOLL), farblabel: '' })).toEqual({ farblabel: null })
    const fremd = { ...VOLL, farblabel: 'Select' }
    expect(aenderungAus(fremd, formAus(fremd))).toEqual({})
  })

  it('Datum: Zone bleibt, volle Minuten bekommen Sekunden, leer entfernt', () => {
    expect(aenderungAus(VOLL, { ...formAus(VOLL), aufnahme: '2022-01-02T03:04' })).toEqual({
      aufnahme: { lokal: '2022-01-02T03:04:00', offset: '+02:00' }
    })
    expect(aenderungAus(VOLL, { ...formAus(VOLL), aufnahme: '' })).toEqual({ aufnahme: null })
    expect(aenderungAus(LEER, { ...formAus(LEER), aufnahme: '2022-01-02T03:04:05' })).toEqual({
      aufnahme: { lokal: '2022-01-02T03:04:05', offset: null }
    })
  })

  it('Datum mit vollen Minuten gilt als unverändert', () => {
    const w = { ...VOLL, aufnahme: { lokal: '2021-06-05T14:03:00', offset: null } }
    expect(aenderungAus(w, { ...formAus(w), aufnahme: '2021-06-05T14:03' })).toEqual({})
  })

  it('Standort setzen, entfernen, und ungültig gibt einen Hinweis statt einer Änderung', () => {
    expect(aenderungAus(LEER, { ...formAus(LEER), standort: '42,65 18,09' })).toEqual({
      standort: { breite: 42.65, laenge: 18.09 }
    })
    expect(aenderungAus(VOLL, { ...formAus(VOLL), standort: '' })).toEqual({ standort: null })
    expect(aenderungAus(VOLL, { ...formAus(VOLL), standort: 'Dubrovnik' })).toMatch(/Breite, Länge/)
  })
})

describe('standortLesen', () => {
  it.each([
    ['42.65, 18.09', 42.65, 18.09],
    ['42.65,18.09', 42.65, 18.09],
    ['42,65 18,09', 42.65, 18.09],
    ['42,65; 18,09', 42.65, 18.09],
    ['-33.8568 151.2153', -33.8568, 151.2153],
    ['42, 18', 42, 18]
  ])('liest %s', (t, breite, laenge) => {
    expect(standortLesen(t)).toEqual({ breite, laenge })
  })

  it('leer heißt kein Standort', () => {
    expect(standortLesen('  ')).toBeNull()
  })

  it.each(['Paris', '42.65', '91, 0', '0, 181', '0, 0', '1, 2, 3'])('lehnt ab: %s', (t) => {
    expect(standortLesen(t)).toBeUndefined()
  })

  it('der gezeigte Text ergibt wieder denselben Ort', () => {
    const s = { breite: -33.856812, laenge: 151.215311 }
    expect(standortLesen(standortText(s))).toEqual(s)
  })
})
