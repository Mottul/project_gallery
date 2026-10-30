import { describe, expect, it } from 'vitest'
import { DIASHOW_VORGABE, pruefeDiashowWahl } from './diashow'

describe('pruefeDiashowWahl', () => {
  it('übernimmt Gültiges', () => {
    const w = { intervall: 10, uebergang: 'schnitt', kenBurns: 'aus', staerke: 'stark' }
    expect(pruefeDiashowWahl(w)).toEqual(w)
  })

  it('gibt ohne Gemerktes die Vorgabe', () => {
    for (const v of [null, undefined, 5, 'x', []]) {
      expect(pruefeDiashowWahl(v)).toEqual(DIASHOW_VORGABE)
    }
  })

  it('ersetzt nur das Ungültige und nimmt nichts Fremdes mit', () => {
    expect(
      pruefeDiashowWahl({ intervall: 7, uebergang: 'wischen', staerke: 'mittel', fremd: 1 })
    ).toEqual({ ...DIASHOW_VORGABE, staerke: 'mittel' })
  })
})
