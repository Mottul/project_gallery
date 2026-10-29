// Die echte Ortsdatei aus dem Repository (resources/geo, GeoNames): Prüfsumme, und für die Punkte
// der Testbibliothek der erwartete Ort – so fällt ein Neubau der Daten auf, der die Regel bricht.
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { orteLaden } from './orte'

const GEO = join(__dirname, '..', '..', '..', '..', 'resources', 'geo')

describe('Ortsdaten (resources/geo)', () => {
  it('Prüfsumme stimmt; Orte der Testbibliothek und Großstädte richtig, deutsche Namen', async () => {
    const index = await orteLaden(GEO)
    const name = (lat: number, lon: number): string | undefined => index?.naechster(lat, lon)?.name
    expect(name(48.8584, 2.2945)).toBe('Paris') // Eiffelturm, nicht „Paris 16 Passy“
    expect(name(42.6507, 18.0944)).toBe('Dubrovnik')
    expect(name(48.1374, 11.5755)).toBe('München') // nicht „Munich“
    expect(index?.naechster(33.6609, -95.5555)).toMatchObject({ name: 'Paris', land: 'US' })
    expect(name(50.9413, 6.9583)).toBe('Köln') // Dom, nicht „Altstadt Nord“
    expect(name(52.5163, 13.3777)).toBe('Berlin') // Brandenburger Tor, nicht „Tiergarten“
    expect(name(48.2082, 16.3738)).toBe('Wien')
  })

  it('verfälschte Datei: Prüfsumme stimmt nicht, kein Index', async () => {
    const d = mkdtempSync(join(tmpdir(), 'galeria-orte-'))
    try {
      copyFileSync(join(GEO, 'orte.json'), join(d, 'orte.json'))
      writeFileSync(join(d, 'orte.tsv.gz'), Buffer.from('untergeschoben'))
      await expect(orteLaden(d)).rejects.toMatchObject({ code: 'ORTE_PRUEFSUMME' })
    } finally {
      rmSync(d, { recursive: true, force: true })
    }
  })
})
