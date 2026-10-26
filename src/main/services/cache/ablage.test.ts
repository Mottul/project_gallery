import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { schreibeAtomar, vorschauLoeschen, vorschauPfad } from './ablage'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'galeria-cache-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5 }))

describe('Ablage der Vorschaubilder', () => {
  it('Pfad nennt nur Kennung und Stufe, verteilt auf 256 Unterordner', () => {
    expect(vorschauPfad(dir, 1, 256)).toBe(join(dir, '01', '1-256.gbv'))
    expect(vorschauPfad(dir, 255, 768)).toBe(join(dir, 'ff', '255-768.gbv'))
    expect(vorschauPfad(dir, 256, 256)).toBe(join(dir, '00', '256-256.gbv'))
  })

  it('schreibt atomar (kein Zwischenname bleibt) und überschreibt', async () => {
    const p = vorschauPfad(dir, 5, 256)
    await schreibeAtomar(p, Buffer.from('eins'))
    await schreibeAtomar(p, Buffer.from('zwei'))
    expect(readFileSync(p, 'utf8')).toBe('zwei')
    expect(readdirSync(join(dir, '05'))).toEqual(['5-256.gbv'])
  })

  it('löscht alle Stufen der Kennungen; fehlende sind kein Fehler', async () => {
    await schreibeAtomar(vorschauPfad(dir, 1, 256), Buffer.from('a'))
    await schreibeAtomar(vorschauPfad(dir, 1, 768), Buffer.from('b'))
    await schreibeAtomar(vorschauPfad(dir, 2, 256), Buffer.from('c'))
    expect(await vorschauLoeschen(dir, [1, 3])).toBe(2)
    expect(existsSync(vorschauPfad(dir, 1, 256))).toBe(false)
    expect(existsSync(vorschauPfad(dir, 1, 768))).toBe(false)
    expect(existsSync(vorschauPfad(dir, 2, 256))).toBe(true)
  })
})
