import { beforeEach, describe, expect, it } from 'vitest'
import {
  auswahlAbgleichen,
  auswahlAlle,
  auswahlKlick,
  auswahlLeeren,
  auswahlRahmen,
  istAusgewaehlt
} from './auswahl'

const ids = [10, 20, 30, 40, 50]
const gewaehlt = (): number[] => ids.filter(istAusgewaehlt)
const klick = (i: number, strg = false, umschalt = false): void =>
  auswahlKlick(ids, i, { strg, umschalt })

beforeEach(() => auswahlLeeren())

describe('Auswahl wie im Explorer', () => {
  it('Klick wählt eines, Strg schaltet um', () => {
    klick(1)
    expect(gewaehlt()).toEqual([20])
    klick(3, true)
    expect(gewaehlt()).toEqual([20, 40])
    klick(1, true)
    expect(gewaehlt()).toEqual([40])
    klick(0)
    expect(gewaehlt()).toEqual([10])
  })

  it('Umschalt wählt den Bereich ab dem Anker – in beide Richtungen; mit Strg dazu', () => {
    klick(1)
    klick(3, false, true)
    expect(gewaehlt()).toEqual([20, 30, 40])
    klick(0, false, true)
    expect(gewaehlt()).toEqual([10, 20])
    klick(4, true) // neuer Anker, Auswahl bleibt
    klick(3, true, true)
    expect(gewaehlt()).toEqual([10, 20, 40, 50])
  })

  it('Strg+A, Rahmen (mit/ohne vorige Auswahl), Abgleich nach neuer Liste', () => {
    auswahlAlle(ids)
    expect(gewaehlt()).toEqual(ids)
    auswahlRahmen([30, 40], null)
    expect(gewaehlt()).toEqual([30, 40])
    auswahlRahmen([10], new Set([50]))
    expect(gewaehlt()).toEqual([10, 50])
    auswahlAbgleichen([50, 60])
    expect(gewaehlt()).toEqual([50])
    // ohne Anker wirkt Umschalt wie ein Klick
    auswahlLeeren()
    klick(2, false, true)
    expect(gewaehlt()).toEqual([30])
  })

  it('nach dem Umsortieren bleibt die Auswahl dieselbe (Kennungen, nicht Stellen)', () => {
    klick(0)
    klick(1, true)
    const umsortiert = [...ids].reverse()
    auswahlAbgleichen(umsortiert)
    expect(gewaehlt()).toEqual([10, 20])
    // Umschalt nutzt die neue Reihenfolge ab dem Anker (20)
    auswahlKlick(umsortiert, 1, { strg: false, umschalt: true })
    expect(gewaehlt().sort((a, b) => a - b)).toEqual([20, 30, 40])
  })
})
