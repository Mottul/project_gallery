import { describe, expect, it } from 'vitest'
import { gruppenArt, gruppenAus, gruppenAusdruck, gruppenTitel, pruefeGruppierung } from './gruppen'

describe('Gruppen (2.3)', () => {
  it('folgen der Sortierung; Name, Größe und Aufnahmewerte haben keine', () => {
    expect(gruppenArt('aufnahme')).toBe('aufnahme')
    expect(gruppenArt('ort')).toBe('ort')
    expect(gruppenArt('kamera')).toBe('kamera')
    expect(gruppenArt('name')).toBeNull()
    expect(gruppenArt('groesse')).toBeNull()
    expect(gruppenArt('iso')).toBeNull()
  })

  it('Titel: Datum je Stufe, Ort mit Land, Bewertung, Ordner, fehlende Werte', () => {
    expect(gruppenTitel('aufnahme', '2024-07')).toBe('Juli 2024')
    expect(gruppenTitel('aufnahme', '2024-07-04')).toBe('4. Juli 2024')
    expect(gruppenTitel('aufnahme', '2024')).toBe('2024')
    expect(gruppenTitel('ort', 'Paris\u0001Frankreich')).toBe('Paris · Frankreich')
    expect(gruppenTitel('ort', null)).toBe('Ohne Standort')
    expect(gruppenTitel('bewertung', 1)).toBe('1 Stern')
    expect(gruppenTitel('bewertung', 5)).toBe('5 Sterne')
    expect(gruppenTitel('kamera', null)).toBe('Ohne Kamera')
    expect(gruppenTitel('ordner', 'D:\\Bilder\u0001Urlaub/2024/')).toBe('Bilder › Urlaub › 2024')
    expect(gruppenTitel('ordner', 'D:\\Bilder\u0001')).toBe('Bilder')
  })

  it('Grenzen: je Wechsel des Schlüssels eine Gruppe mit Anfang und Anzahl', () => {
    expect(gruppenAus('aufnahme', ['2024-07', '2024-07', '2024-08', null, null])).toEqual([
      { titel: 'Juli 2024', von: 0, anzahl: 2 },
      { titel: 'August 2024', von: 2, anzahl: 1 },
      { titel: 'Ohne Datum', von: 3, anzahl: 2 }
    ])
    expect(gruppenAus('ort', [])).toEqual([])
  })

  it('SQL nur aus festen Texten; Gruppierung aus dem Renderer geprüft', () => {
    expect(gruppenAusdruck('aufnahme', 'monat')).toBe('substr(taken_at, 1, 7)')
    expect(gruppenAusdruck('geaendert', 'jahr')).toContain("'%Y'")
    expect(pruefeGruppierung('monat')).toBe('monat')
    expect(pruefeGruppierung('aus')).toBe('aus')
    for (const x of ['MONAT', 'woche', 1, null, {}, 'constructor']) {
      expect(pruefeGruppierung(x)).toBeNull()
    }
  })
})
