// Aus der Mottulbox übernommen (project_mega/src/shared/settingsMerge.test.ts, Stand 0cc14cb), mit
// eigener Beispiel-Struktur: mergeSettings ist allgemein, die Galerie hat noch kaum Einstellungen.
import { describe, expect, it } from 'vitest'
import { mergeSettings } from './settingsMerge'

interface Beispiel {
  theme: string
  ansicht: { kachel: number; sortierung: string }
  ordner: { modi: { archiv: string; urlaub: string } }
  zuletzt: string[]
  auswahl: string | null
}

const base = (): Beispiel => ({
  theme: 'system',
  ansicht: { kachel: 160, sortierung: 'datum' },
  ordner: { modi: { archiv: 'nur-lesen', urlaub: 'normal' } },
  zuletzt: [],
  auswahl: null
})

describe('Einstellungen zusammenführen', () => {
  it('ändert in Bereichen nur die übergebenen Felder', () => {
    const s = mergeSettings(base(), { ansicht: { kachel: 240 } })
    expect(s.ansicht).toEqual({ kachel: 240, sortierung: 'datum' })
    // zweite Teiländerung (anderes Fenster) überschreibt die erste nicht
    const t = mergeSettings(s, { ansicht: { sortierung: 'ort' } })
    expect(t.ansicht).toEqual({ kachel: 240, sortierung: 'ort' })
  })

  it('führt verschachtelte Bereiche tief zusammen', () => {
    const s = mergeSettings(base(), { ordner: { modi: { urlaub: 'privat' } } })
    expect(s.ordner.modi).toEqual({ archiv: 'nur-lesen', urlaub: 'privat' })
  })

  it('ersetzt Listen und einfache Werte vollständig', () => {
    const s = mergeSettings(mergeSettings(base(), { zuletzt: ['a', 'b'] }), {
      zuletzt: ['c'],
      auswahl: 'x'
    })
    expect(s.zuletzt).toEqual(['c'])
    expect(s.auswahl).toBe('x')
    expect(mergeSettings(s, { auswahl: null }).auswahl).toBeNull()
  })

  it('ignoriert undefined, falsche Typen und Prototyp-Schlüssel', () => {
    const before = base()
    const s = mergeSettings(before, {
      theme: undefined,
      ansicht: null,
      ordner: 'kaputt',
      zuletzt: { 0: 'x' },
      ...JSON.parse('{"__proto__": {"polluted": true}}')
    })
    expect(s).toEqual(before)
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
    expect(mergeSettings(before, 'kein Objekt')).toBe(before)
  })

  it('füllt beim Lesen fehlende Felder aus den Vorgaben auf', () => {
    const s = mergeSettings(base(), { theme: 'light', ansicht: { kachel: 80 } })
    expect(s.theme).toBe('light')
    expect(s.ansicht).toEqual({ kachel: 80, sortierung: 'datum' })
  })

  it('lässt die Vorlage unverändert', () => {
    const before = base()
    const copy = structuredClone(before)
    mergeSettings(before, { ansicht: { kachel: 1 }, ordner: { modi: { archiv: 'normal' } } })
    expect(before).toEqual(copy)
  })
})
