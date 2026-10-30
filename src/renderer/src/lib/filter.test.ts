import { describe, expect, it } from 'vitest'
import { filterChips, filterNeu } from './filter'

describe('Filter im Renderer (2.4)', () => {
  it('leere Werte nehmen ein Kriterium weg, der Rest bleibt', () => {
    const f = { bewertung: 3, kameras: ['A'], suche: 'x' }
    expect(filterNeu(f, { bewertung: undefined })).toEqual({ kameras: ['A'], suche: 'x' })
    expect(filterNeu(f, { kameras: [] })).toEqual({ bewertung: 3, suche: 'x' })
    expect(filterNeu(f, { suche: '' })).toEqual({ bewertung: 3, kameras: ['A'] })
    expect(filterNeu(f, { standort: 'mit' })).toEqual({ ...f, standort: 'mit' })
    // das Alte bleibt unberührt
    expect(f).toEqual({ bewertung: 3, kameras: ['A'], suche: 'x' })
  })

  it('Zeitraum rückwärts: das gerade Geänderte gilt, das andere Ende fällt weg', () => {
    expect(filterNeu({ bis: '2024-01-01' }, { von: '2024-06-01' })).toEqual({ von: '2024-06-01' })
    expect(filterNeu({ von: '2024-06-01' }, { bis: '2024-01-01' })).toEqual({ bis: '2024-01-01' })
    expect(filterNeu({ von: '2024-01-01' }, { bis: '2024-01-01' })).toEqual({
      von: '2024-01-01',
      bis: '2024-01-01'
    })
  })

  it('Chips: lesbarer Text, je Listenwert einer, Entfernen lässt die übrigen stehen', () => {
    const f = {
      von: '2024-07-01',
      bewertung: 3,
      farben: ['Red'],
      orte: ['Paris\u0001Frankreich'],
      formate: ['jpeg', 'png'],
      ausrichtung: 'hoch' as const,
      standort: 'ohne' as const,
      suche: 'nicht als Chip'
    }
    const c = filterChips(f)
    expect(c.map((x) => x.text)).toEqual([
      'Ab 01.07.2024',
      'Bewertung ≥ 3',
      'Rot',
      'Paris · Frankreich',
      'JPEG',
      'PNG',
      'Hochformat',
      'Ohne Standort'
    ])
    expect(new Set(c.map((x) => x.schluessel)).size).toBe(c.length)
    const jpeg = c.find((x) => x.text === 'JPEG')
    expect(filterNeu(f, jpeg?.weg ?? {}).formate).toEqual(['png'])
    expect(filterChips({})).toEqual([])
  })
})
