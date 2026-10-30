import { describe, expect, it } from 'vitest'
import {
  ANSICHT_NAME_MAX,
  GROESSE_MAX,
  GROESSE_MIN,
  nameSchluessel,
  pruefeAnsichtName,
  pruefeAnsichtStand,
  standGleich,
  type AnsichtStand
} from './gespeicherteAnsicht'

const stand: AnsichtStand = {
  knoten: { ordner: 3, pfad: 'Reisen/Split' },
  art: 'blocksatz',
  groesse: 200,
  sortierung: { feld: 'ort', richtung: 'auf' },
  gruppierung: 'monat',
  filter: { bewertung: 4, orte: ['Split\u0001Kroatien'], suche: 'hafen' }
}

describe('pruefeAnsichtName', () => {
  it('nimmt Rand-Leerzeichen weg und vereinheitlicht Unicode', () => {
    expect(pruefeAnsichtName('  Beste Bilder ')).toBe('Beste Bilder')
    expect(pruefeAnsichtName('München')).toBe('München')
  })

  it('lehnt Leeres, zu Langes, Steuerzeichen und Fremdes ab', () => {
    expect(pruefeAnsichtName('   ')).toBeNull()
    expect(pruefeAnsichtName('x'.repeat(ANSICHT_NAME_MAX + 1))).toBeNull()
    expect(pruefeAnsichtName('a\nb')).toBeNull()
    expect(pruefeAnsichtName(5)).toBeNull()
    expect(pruefeAnsichtName('x'.repeat(ANSICHT_NAME_MAX))).not.toBeNull()
  })
})

describe('nameSchluessel', () => {
  it('fasst Schreibweisen zusammen', () => {
    expect(nameSchluessel('ÄPFEL')).toBe(nameSchluessel('äpfel'))
    expect(nameSchluessel('München')).toBe(nameSchluessel('MÜNCHEN'))
  })
})

describe('pruefeAnsichtStand', () => {
  it('lässt Gültiges durch und nimmt nur bekannte Felder', () => {
    expect(pruefeAnsichtStand(stand)).toEqual(stand)
    expect(pruefeAnsichtStand({ ...stand, knoten: null })?.knoten).toBeNull()
    expect(pruefeAnsichtStand({ ...stand, fremd: 1 })).toEqual(stand)
  })

  it.each([
    ['kein Objekt', 'x'],
    ['Liste', []],
    ['Knoten fehlt', { ...stand, knoten: undefined }],
    ['Knoten mit ..', { ...stand, knoten: { ordner: 1, pfad: '../x' } }],
    ['fremde Darstellung', { ...stand, art: 'mosaik' }],
    ['Größe zu klein', { ...stand, groesse: GROESSE_MIN - 1 }],
    ['Größe zu groß', { ...stand, groesse: GROESSE_MAX + 1 }],
    ['Größe keine Zahl', { ...stand, groesse: NaN }],
    ['fremdes Sortierfeld', { ...stand, sortierung: { feld: 'rowid; DROP', richtung: 'auf' } }],
    ['fremde Gruppen', { ...stand, gruppierung: 'woche' }],
    ['ungültiger Filter', { ...stand, filter: { bewertung: 9 } }],
    ['Filter fehlt', { ...stand, filter: undefined }]
  ])('lehnt ab: %s', (_name, v) => {
    expect(pruefeAnsichtStand(v)).toBeNull()
  })
})

describe('standGleich', () => {
  it('Reihenfolge der Kriterien und Werte zählt nicht, die Größe auch nicht', () => {
    const a = { ...stand, filter: { kameras: ['A', 'B'], bewertung: 3 } }
    const b = { ...stand, groesse: 120, filter: { bewertung: 3, kameras: ['B', 'A'] } }
    expect(standGleich(a, b)).toBe(true)
  })

  it.each([
    ['anderer Ordner', { knoten: { ordner: 4, pfad: 'Reisen/Split' } }],
    ['anderer Unterordner', { knoten: { ordner: 3, pfad: '' } }],
    ['alle Bilder', { knoten: null }],
    ['andere Darstellung', { art: 'liste' as const }],
    ['andere Gruppen', { gruppierung: 'jahr' as const }],
    ['andere Richtung', { sortierung: { feld: 'ort', richtung: 'ab' } as const }],
    ['anderer Filter', { filter: { bewertung: 3 } }]
  ])('erkennt: %s', (_name, patch) => {
    expect(standGleich(stand, { ...stand, ...patch })).toBe(false)
  })
})
