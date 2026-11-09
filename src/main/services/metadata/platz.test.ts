import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { freierPlatz, groesseText, platzHinweis, PLATZ_RESERVE } from './platz'

const GB = 1024 ** 3
const dir = mkdtempSync(join(tmpdir(), 'galeria-platz-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

describe('freierPlatz', () => {
  it('misst am nächsten vorhandenen Ordner, wenn der Ordner der Sicherungen noch fehlt', async () => {
    const da = (await freierPlatz(dir)) as number
    expect(da).toBeGreaterThan(0)
    // dasselbe Laufwerk; nebenher laufende Tests schreiben, darum nur ungefähr gleich
    const darunter = (await freierPlatz(join(dir, 'gibt', 'es', 'nicht'))) as number
    expect(Math.abs(darunter - da)).toBeLessThan(GB / 2)
  })
})

describe('platzHinweis', () => {
  it('passt: kein Hinweis; nicht messbar oder nichts zu sichern: auch nicht', () => {
    expect(platzHinweis(GB, 3 * GB)).toBeNull()
    expect(platzHinweis(GB, null)).toBeNull()
    expect(platzHinweis(0, 0)).toBeNull()
  })

  it('zu wenig: nennt beide Größen, die Reserve bleibt frei', () => {
    expect(platzHinweis(2 * GB, 2 * GB + PLATZ_RESERVE - 1)).toMatch(
      /brauchen 2 GB, frei sind 2 GB .*weniger Bilder/
    )
    expect(platzHinweis(5 * GB, GB / 2)).toMatch(/frei sind 0 Byte/)
  })
})

describe('groesseText', () => {
  it.each([
    [512, '512 Byte'],
    [1536, '1,5 KB'],
    [12.34 * GB, '12,3 GB']
  ])('%i', (b, text) => {
    expect(groesseText(b)).toBe(text)
  })
})
