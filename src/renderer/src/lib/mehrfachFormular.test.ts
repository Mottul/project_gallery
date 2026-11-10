import { describe, expect, it } from 'vitest'
import type { MetaWerte } from '@shared/metaFields'
import { zusammenfassen } from '@shared/metaMehrfach'
import {
  aenderungAus,
  chipsAus,
  feldZuruecksetzen,
  formAus,
  geaenderteFelder,
  stichwortDazu,
  stichwortWeg
} from './mehrfachFormular'

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
  copyright: null,
  ausrichtung: { wert: 1, xmp: false }
}
const ORT = { breite: 42.640278, laenge: 18.108333 }
const A: MetaWerte = {
  ...LEER,
  bewertung: 4,
  titel: 'Hafen',
  beschreibung: 'Sommer',
  stichwoerter: ['Urlaub', 'Kroatien', 'Altstadt'],
  aufnahme: { lokal: '2025-07-16T09:42:00', offset: '+02:00' },
  standort: ORT,
  urheber: 'Ich'
}
const B: MetaWerte = {
  ...A,
  bewertung: 5,
  titel: 'Nacht',
  stichwoerter: ['Urlaub', 'Kroatien', 'Meer'],
  aufnahme: { lokal: '2025-07-17T21:47:00', offset: null }
}
const W = zusammenfassen([A, B, { ...A, stichwoerter: ['Urlaub', 'Kroatien', 'Altstadt'] }])

describe('formAus und aenderungAus', () => {
  it('gleiche Werte vorbelegt, verschiedene leer; ohne Eingabe keine Änderung', () => {
    const f = formAus(W)
    expect(f.texte.titel).toBe('')
    expect(f.texte.beschreibung).toBe('Sommer')
    expect(f.texte.urheber).toBe('Ich')
    expect(f.standort).toBe('42.640278, 18.108333')
    expect(f.aufnahme).toBe('')
    expect(aenderungAus(W, f)).toEqual({})
  })

  it('‹verschieden› leer gelassen behält, getippt setzt für alle, „entfernen“ nimmt weg', () => {
    const f = formAus(W)
    expect(aenderungAus(W, { ...f, texte: { ...f.texte, titel: ' Hafen ' } })).toEqual({
      titel: 'Hafen'
    })
    expect(aenderungAus(W, { ...f, entfernen: ['titel'] })).toEqual({ titel: null })
    // getippt geht vor „entfernen“
    expect(
      aenderungAus(W, { ...f, texte: { ...f.texte, titel: 'X' }, entfernen: ['titel'] })
    ).toEqual({ titel: 'X' })
  })

  it('gleicher Wert: geändert setzt, geleert entfernt bei allen, unverändert nichts', () => {
    const f = formAus(W)
    expect(aenderungAus(W, { ...f, texte: { ...f.texte, urheber: 'Du' } })).toEqual({
      urheber: 'Du'
    })
    expect(aenderungAus(W, { ...f, texte: { ...f.texte, urheber: '  ' } })).toEqual({
      urheber: null
    })
    expect(aenderungAus(W, { ...f, texte: { ...f.texte, urheber: 'Ich ' } })).toEqual({})
  })

  it('Bewertung und Farblabel nur, wenn gewählt; 0 und null entfernen', () => {
    const f = formAus(W)
    expect(aenderungAus(W, { ...f, bewertung: 0, farblabel: null })).toEqual({
      bewertung: 0,
      farblabel: null
    })
    expect(aenderungAus(W, { ...f, farblabel: 'Blue' })).toEqual({ farblabel: 'Blue' })
  })

  it('Datum: verschieden + leer behält, eingegeben gilt für alle (volle Minuten mit Sekunden)', () => {
    const f = formAus(W)
    expect(aenderungAus(W, { ...f, aufnahme: '2020-01-02T03:04' })).toEqual({
      aufnahme: { lokal: '2020-01-02T03:04:00' }
    })
    const gleich = zusammenfassen([A, A])
    const g = formAus(gleich)
    expect(g.aufnahme).toBe('2025-07-16T09:42:00')
    expect(aenderungAus(gleich, { ...g, aufnahme: '2025-07-16T09:42' })).toEqual({})
    expect(aenderungAus(gleich, { ...g, aufnahme: '' })).toEqual({ aufnahme: null })
  })

  it('Standort: entfernen, setzen, ungültig gibt einen Hinweis', () => {
    const f = formAus(W)
    expect(aenderungAus(W, { ...f, standortWeg: true })).toEqual({ standort: null })
    expect(aenderungAus(W, { ...f, standort: '1,5 2,5' })).toEqual({
      standort: { breite: 1.5, laenge: 2.5 }
    })
    expect(aenderungAus(W, { ...f, standort: 'Dubrovnik' })).toMatch(/Breite, Länge/)
    const ohne = zusammenfassen([LEER, A])
    expect(formAus(ohne).standort).toBe('')
    expect(aenderungAus(ohne, formAus(ohne))).toEqual({})
  })
})

describe('Stichwörter', () => {
  it('Chips mit Anzahl; entfernen und dazu gelten für alle, Gelesenes bleibt in der Liste', () => {
    let f = formAus(W)
    expect(chipsAus(W, f)).toEqual([
      { wort: 'Urlaub', anzahl: 3, alle: true },
      { wort: 'Kroatien', anzahl: 3, alle: true },
      { wort: 'Altstadt', anzahl: 2, alle: false },
      { wort: 'Meer', anzahl: 1, alle: false }
    ])
    f = stichwortWeg(W, f, 'Meer')
    f = stichwortDazu(W, f, 'altstadt')
    f = stichwortDazu(W, f, ' Familie ')
    expect(chipsAus(W, f).map((c) => `${c.wort} ${c.anzahl}`)).toEqual([
      'Urlaub 3',
      'Kroatien 3',
      'Altstadt 3',
      'Familie 3'
    ])
    // geschickt wird nur dazu/weg – nie eine Liste, die auf alle kopiert würde
    expect(aenderungAus(W, f)).toEqual({
      stichwoerterDazu: ['Altstadt', 'Familie'],
      stichwoerterWeg: ['Meer']
    })
  })

  it('Rücknahmen: ein neues Wort wieder weg, ein entferntes wieder dazu – dann keine Änderung', () => {
    let f = formAus(W)
    f = stichwortDazu(W, f, 'Neu')
    f = stichwortWeg(W, f, 'neu')
    f = stichwortWeg(W, f, 'Urlaub')
    f = stichwortDazu(W, f, 'URLAUB')
    expect(aenderungAus(W, f)).toEqual({})
  })

  it('Teil-Chip „dazu“ und dann das Kreuz: bei allen weg', () => {
    let f = stichwortDazu(W, formAus(W), 'Altstadt')
    f = stichwortWeg(W, f, 'Altstadt')
    expect(aenderungAus(W, f)).toEqual({ stichwoerterWeg: ['Altstadt'] })
  })

  it('leer oder mit Semikolon: nichts', () => {
    const f = formAus(W)
    expect(stichwortDazu(W, f, '  ')).toBe(f)
    expect(stichwortDazu(W, f, 'a;b')).toBe(f)
  })
})

describe('geänderte Felder', () => {
  it('zählt Stichwörter einmal; zurücksetzen stellt den gelesenen Stand her', () => {
    let f = formAus(W)
    f = { ...stichwortWeg(W, stichwortDazu(W, f, 'X'), 'Meer'), bewertung: 2 }
    f = { ...f, texte: { ...f.texte, urheber: 'Du' }, entfernen: ['titel'] }
    const a = aenderungAus(W, f)
    if (typeof a === 'string') throw new Error(a)
    expect([...geaenderteFelder(a)].sort()).toEqual([
      'bewertung',
      'stichwoerter',
      'titel',
      'urheber'
    ])
    for (const feld of geaenderteFelder(a)) f = feldZuruecksetzen(W, f, feld)
    expect(aenderungAus(W, f)).toEqual({})
  })
})
