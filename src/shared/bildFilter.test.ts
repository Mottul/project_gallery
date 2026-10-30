import { describe, expect, it } from 'vitest'
import {
  farblabelText,
  filterAktiv,
  filterBedingung,
  folgetag,
  LISTE_MAX,
  pruefeBildFilter,
  suchAusdruck
} from './bildFilter'

describe('Filter prüfen (2.4)', () => {
  it('nimmt alle Kriterien, gibt nur bekannte zurück, leere fallen weg', () => {
    expect(
      pruefeBildFilter({
        von: '2024-07-01',
        bis: '2024-07-31',
        bewertung: 3,
        farben: ['Red'],
        kameras: ['Galeria Testkamera A', 'Galeria Testkamera A'],
        orte: ['Paris\u0001Frankreich'],
        stichwoerter: ['Urlaub'],
        formate: ['jpeg'],
        ausrichtung: 'quer',
        standort: 'mit',
        suche: '  Altstadt  ',
        extra: 'x',
        stichwoerterLeer: []
      })
    ).toEqual({
      von: '2024-07-01',
      bis: '2024-07-31',
      bewertung: 3,
      farben: ['Red'],
      kameras: ['Galeria Testkamera A'],
      orte: ['Paris\u0001Frankreich'],
      stichwoerter: ['Urlaub'],
      formate: ['jpeg'],
      ausrichtung: 'quer',
      standort: 'mit',
      suche: 'Altstadt'
    })
    expect(pruefeBildFilter({})).toEqual({})
    expect(pruefeBildFilter({ kameras: [], suche: '   ' })).toEqual({})
  })

  it('lehnt Ungültiges ab – nie still korrigiert', () => {
    for (const v of [
      null,
      'Paris',
      [],
      { von: '2024-02-30' },
      { von: '2024-7-1' },
      { von: '2024-08-01', bis: '2024-07-01' },
      { bewertung: 0 },
      { bewertung: 6 },
      { bewertung: 2.5 },
      { bewertung: '3' },
      { kameras: 'Testkamera' },
      { kameras: [1] },
      { kameras: [''] },
      { kameras: ['x'.repeat(201)] },
      { kameras: Array.from({ length: LISTE_MAX + 1 }, (_, i) => `k${i}`) },
      { stichwoerter: ['a\nb'] },
      { stichwoerter: ['a\u0001b'] }, // Trenner nur im Ort-Schlüssel
      { ausrichtung: 'schraeg' },
      { standort: true },
      { suche: 'x'.repeat(201) },
      { suche: 'a\u0000b' }
    ]) {
      expect(pruefeBildFilter(v), JSON.stringify(v)).toBeNull()
    }
  })

  it('geerbte Schlüssel zählen nicht', () => {
    const v = Object.create({ bewertung: 9 }) as object
    expect(pruefeBildFilter(v)).toEqual({})
    expect(filterAktiv({})).toBe(false)
    expect(filterAktiv({ bewertung: 1 })).toBe(true)
  })
})

describe('Suche (FTS5)', () => {
  it('jedes Wort in Anführungszeichen und als Präfix – Operatoren aus der Eingabe wirken nicht', () => {
    expect(suchAusdruck('pari')).toBe('"pari"*')
    expect(suchAusdruck('Altstadt  Abend')).toBe('"Altstadt"* "Abend"*')
    expect(suchAusdruck('a OR b')).toBe('"a"* "OR"* "b"*')
    expect(suchAusdruck('"x" NEAR(y) -z title:w')).toBe('"x"* "NEAR(y)"* "-z"* "title:w"*')
    expect(suchAusdruck('   ')).toBeNull()
    expect(suchAusdruck('"')).toBeNull()
    expect(suchAusdruck('- ... *')).toBeNull()
    expect(
      suchAusdruck(Array.from({ length: 20 }, (_, i) => `w${i}`).join(' '))?.split(' ')
    ).toHaveLength(10)
  })
})

describe('SQL-Bedingung', () => {
  it('nur Platzhalter für Werte, Kriterien mit UND, Listen mit IN', () => {
    const { sql, werte } = filterBedingung({
      von: '2024-07-01',
      bis: '2024-07-31',
      bewertung: 3,
      kameras: ['A', 'B'],
      stichwoerter: ["x'); DROP TABLE images; --"],
      suche: 'pari'
    })
    expect(werte).toEqual([
      '2024-07-01',
      '2024-08-01',
      3,
      'A',
      'B',
      "x'); DROP TABLE images; --",
      '"pari"*'
    ])
    expect(sql).not.toContain('DROP')
    expect(sql).toContain('(taken_at >= ?) AND (taken_at < ?) AND (rating >= ?)')
    expect(sql).toContain('IN (?, ?)')
    expect(sql).toContain('images_fts MATCH ?')
    expect(filterBedingung({})).toEqual({ sql: '', werte: [] })
  })

  it('Folgetag über Monats- und Jahresgrenzen, Schaltjahr', () => {
    expect(folgetag('2024-02-28')).toBe('2024-02-29')
    expect(folgetag('2023-02-28')).toBe('2023-03-01')
    expect(folgetag('2024-12-31')).toBe('2025-01-01')
  })

  it('Farblabel deutsch, Unbekanntes bleibt; geerbte Schlüssel nicht', () => {
    expect(farblabelText('Red')).toBe('Rot')
    expect(farblabelText('purple')).toBe('Lila')
    expect(farblabelText('Türkis')).toBe('Türkis')
    expect(farblabelText('constructor')).toBe('constructor')
  })
})
