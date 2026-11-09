import { describe, expect, it } from 'vitest'
import type { MetaWerte } from './metaFields'
import {
  aenderungFuer,
  pruefeMehrfachAenderung,
  pruefeSchreibOptionen,
  rueckfrageText,
  stichwoerterNeu,
  zusammenfassen
} from './metaMehrfach'

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
const A: MetaWerte = {
  ...LEER,
  bewertung: 4,
  farblabel: 'Red',
  titel: 'Hafen',
  stichwoerter: ['Urlaub', 'Kroatien', 'Altstadt'],
  aufnahme: { lokal: '2025-07-16T09:42:00', offset: '+02:00' },
  standort: { breite: 42.640278, laenge: 18.108333 },
  urheber: 'Ich'
}
const B: MetaWerte = {
  ...LEER,
  bewertung: 5,
  titel: 'Hafen',
  stichwoerter: ['urlaub', 'Kroatien', 'Meer'],
  aufnahme: { lokal: '2025-07-16T17:58:00', offset: null },
  standort: { breite: 42.6402780000001, laenge: 18.108333 },
  urheber: 'Ich'
}
const C: MetaWerte = {
  ...LEER,
  titel: 'Nacht',
  stichwoerter: ['Urlaub', 'Kroatien', 'Altstadt'],
  aufnahme: { lokal: '2025-07-17T21:47:00', offset: '+02:00' },
  urheber: 'Ich'
}

describe('pruefeMehrfachAenderung', () => {
  it('nimmt Felder wie das Panel und Stichwörter als dazu/weg', () => {
    expect(
      pruefeMehrfachAenderung({
        bewertung: 0,
        farblabel: null,
        titel: '  Hafen ',
        beschreibung: 'a\nb',
        standort: null,
        aufnahme: { lokal: '2020-01-02T03:04:05' },
        stichwoerterDazu: ['Familie', 'familie'],
        stichwoerterWeg: ['Meer']
      })
    ).toEqual({
      bewertung: 0,
      farblabel: null,
      titel: 'Hafen',
      beschreibung: 'a\nb',
      standort: null,
      aufnahme: { lokal: '2020-01-02T03:04:05' },
      stichwoerterDazu: ['Familie'],
      stichwoerterWeg: ['Meer']
    })
  })

  it.each([
    ['leer', {}],
    ['kein Objekt', ['bewertung']],
    ['unbekanntes Feld', { rating: 3 }],
    ['Tag-Name', { 'XMP-dc:Title': 'x' }],
    ['Prototyp', JSON.parse('{"constructor": 1}')],
    ['ganze Liste', { stichwoerter: ['a'] }],
    ['leere Liste', { stichwoerterDazu: [] }],
    ['Semikolon', { stichwoerterDazu: ['a;b'] }],
    ['zu lang', { stichwoerterWeg: ['x'.repeat(101)] }],
    ['dazu und weg zugleich', { stichwoerterDazu: ['Meer'], stichwoerterWeg: ['MEER'] }],
    ['Zone im Datum', { aufnahme: { lokal: '2020-01-02T03:04:05', offset: '+02:00' } }],
    ['Datum ungültig', { aufnahme: { lokal: '2020-02-30T03:04:05' } }],
    ['Bewertung', { bewertung: 6 }],
    ['Text mit Zeilenumbruch', { titel: 'a\nb' }],
    ['Standort 0/0', { standort: { breite: 0, laenge: 0 } }]
  ])('lehnt ab: %s', (_n, a) => {
    expect(pruefeMehrfachAenderung(a)).toBeNull()
  })
})

describe('stichwoerterNeu', () => {
  it('entfernt ohne Groß/Klein, hängt Fehlendes an, behält die Schreibweise der Datei', () => {
    expect(stichwoerterNeu(['Urlaub', 'Meer', 'Süden'], ['meer', 'Familie'], ['URLAUB'])).toEqual([
      'Meer',
      'Süden',
      'Familie'
    ])
  })

  it('keine Doppelten, auch nicht in der Liste dazu', () => {
    expect(stichwoerterNeu([], ['A', 'a', 'B'])).toEqual(['A', 'B'])
  })

  it('ohne dazu und weg bleibt alles', () => {
    expect(stichwoerterNeu(['b', 'a'])).toEqual(['b', 'a'])
  })
})

describe('aenderungFuer', () => {
  it('nur, was sich in dieser Datei ändert; alles schon so: null', () => {
    const m = { bewertung: 4, titel: 'Hafen', urheber: 'Ich' }
    expect(aenderungFuer(A, m)).toBeNull()
    expect(aenderungFuer(B, m)).toEqual({ bewertung: 4 })
    expect(aenderungFuer(C, m)).toEqual({ bewertung: 4, titel: 'Hafen' })
  })

  it('Stichwörter je Datei aus ihrer eigenen Liste – nie die Liste einer anderen', () => {
    const m = { stichwoerterDazu: ['Familie'], stichwoerterWeg: ['altstadt'] }
    expect(aenderungFuer(A, m)).toEqual({ stichwoerter: ['Urlaub', 'Kroatien', 'Familie'] })
    expect(aenderungFuer(B, m)).toEqual({ stichwoerter: ['urlaub', 'Kroatien', 'Meer', 'Familie'] })
    // schon da (andere Schreibweise) und nichts zu entfernen: unberührt
    expect(aenderungFuer(B, { stichwoerterDazu: ['URLAUB'] })).toBeNull()
  })

  it('Datum: Zone bleibt je Datei; entfernen nur, wo eines ist', () => {
    const m = { aufnahme: { lokal: '2020-01-02T03:04:05' } }
    expect(aenderungFuer(A, m)).toEqual({
      aufnahme: { lokal: '2020-01-02T03:04:05', offset: '+02:00' }
    })
    expect(aenderungFuer(B, m)).toEqual({
      aufnahme: { lokal: '2020-01-02T03:04:05', offset: null }
    })
    expect(aenderungFuer(LEER, { aufnahme: null })).toBeNull()
    expect(aenderungFuer(A, { aufnahme: null })).toEqual({ aufnahme: null })
  })

  it('Standort mit Rundung verglichen; entfernen nur, wo einer ist', () => {
    const ort = { breite: 42.640278, laenge: 18.108333 }
    expect(aenderungFuer(B, { standort: ort })).toBeNull()
    expect(aenderungFuer(C, { standort: ort })).toEqual({ standort: ort })
    expect(aenderungFuer(C, { standort: null })).toBeNull()
    expect(aenderungFuer(A, { standort: null })).toEqual({ standort: null })
  })

  it('Farblabel: ein fremdes Label wird ersetzt, null entfernt nur vorhandene', () => {
    const fremd = { ...LEER, farblabel: 'Select' }
    expect(aenderungFuer(fremd, { farblabel: 'Red' })).toEqual({ farblabel: 'Red' })
    expect(aenderungFuer(fremd, { farblabel: null })).toEqual({ farblabel: null })
    expect(aenderungFuer(LEER, { farblabel: null })).toBeNull()
  })

  it('leerer Text entfernt nur, wo einer steht', () => {
    expect(aenderungFuer(A, { titel: null })).toEqual({ titel: null })
    expect(aenderungFuer(LEER, { titel: null })).toBeNull()
  })
})

describe('zusammenfassen', () => {
  it('gleich oder verschieden je Feld', () => {
    const z = zusammenfassen([A, B, C])
    expect(z.anzahl).toBe(3)
    expect(z.bewertung).toEqual({ gleich: false })
    expect(z.urheber).toEqual({ gleich: true, wert: 'Ich' })
    expect(z.titel).toEqual({ gleich: false })
    expect(z.copyright).toEqual({ gleich: true, wert: null })
    expect(z.farblabel).toEqual({ gleich: false })
  })

  it('Stichwörter mit Anzahl ohne Groß/Klein, die häufigsten zuerst, sonst wie gelesen', () => {
    expect(zusammenfassen([A, B, C]).stichwoerter).toEqual([
      { wort: 'Urlaub', anzahl: 3 },
      { wort: 'Kroatien', anzahl: 3 },
      { wort: 'Altstadt', anzahl: 2 },
      { wort: 'Meer', anzahl: 1 }
    ])
  })

  it('Datum: Spanne und ohne Datum; gleich nur, wenn alle dasselbe haben', () => {
    const z = zusammenfassen([A, B, C, LEER])
    expect(z.aufnahme).toEqual({
      gleich: false,
      von: '2025-07-16T09:42:00',
      bis: '2025-07-17T21:47:00',
      ohne: 1
    })
    expect(zusammenfassen([A, A]).aufnahme).toMatchObject({
      gleich: true,
      wert: '2025-07-16T09:42:00'
    })
  })

  it('Standort: wie viele einen haben; gleich trotz Rundung', () => {
    expect(zusammenfassen([A, B]).standort).toEqual({
      gleich: true,
      wert: A.standort,
      mit: 2
    })
    expect(zusammenfassen([A, C]).standort).toEqual({ gleich: false, mit: 1 })
  })

  it('ohne Dateien: nichts gleich', () => {
    const z = zusammenfassen([])
    expect(z.anzahl).toBe(0)
    expect(z.bewertung).toEqual({ gleich: false })
    expect(z.stichwoerter).toEqual([])
  })
})

describe('rueckfrageText', () => {
  it.each([
    [{ bewertung: 3 }, 12, '3 Sterne für 12 Bilder schreiben?'],
    [{ bewertung: 1 }, 2, '1 Stern für 2 Bilder schreiben?'],
    [{ bewertung: 0 }, 1234, 'Bewertung bei 1.234 Bildern entfernen?'],
    [{ farblabel: 'Yellow' as const }, 3, 'Farblabel Gelb für 3 Bilder schreiben?'],
    [{ farblabel: null }, 3, 'Farblabel bei 3 Bildern entfernen?'],
    [{ titel: 'x', bewertung: 2 }, 3, 'Änderungen in 3 Bilder schreiben?']
  ])('%j bei %i', (m, n, text) => {
    expect(rueckfrageText(m, n)).toBe(text)
  })
})

describe('pruefeSchreibOptionen', () => {
  it('fehlt = keine, sonst nur bekannte Schalter', () => {
    expect(pruefeSchreibOptionen(undefined)).toEqual({})
    expect(pruefeSchreibOptionen({ rueckfrage: true })).toEqual({ rueckfrage: true })
    expect(pruefeSchreibOptionen({ nochmal: 'ja' })).toBeNull()
    expect(pruefeSchreibOptionen({ anders: true })).toBeNull()
    expect(pruefeSchreibOptionen([])).toBeNull()
  })
})
