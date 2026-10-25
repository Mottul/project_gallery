import { describe, expect, it } from 'vitest'
import { findDone, findMissing } from './check-doc-refs.mjs'

const files = ['src/main/services/netzRegel.ts', 'docs/PLAN.md', 'e2e/smoke.mjs']

describe('findMissing', () => {
  it('findet volle Pfade, Teilpfade, bloße Namen und Aliase', () => {
    const text =
      '`src/main/services/netzRegel.ts`, `services/netzRegel.ts`, `netzRegel.ts`, `docs/PLAN.md`, `smoke.mjs`'
    expect(findMissing(text, files)).toEqual([])
  })

  it('meldet Fehlendes je einmal, Laufzeitdateien nie', () => {
    const text = '`src/shared/geo.ts` und `geo.ts` und `geo.ts` und `settings.json`'
    expect(findMissing(text, files)).toEqual(['src/shared/geo.ts', 'geo.ts'])
  })

  it('Teilpfade passen nur an Pfadgrenzen', () => {
    expect(findMissing('`Regel.ts` `ices/netzRegel.ts`', files)).toEqual([
      'Regel.ts',
      'ices/netzRegel.ts'
    ])
  })
})

describe('findDone', () => {
  it('meldet geplante Dateien, die es inzwischen gibt', () => {
    expect(findDone(['netzRegel.ts', 'geo.ts', 'e2e/smoke.mjs'], files)).toEqual([
      'netzRegel.ts',
      'e2e/smoke.mjs'
    ])
  })
})
