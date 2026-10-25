import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { GefundeneDatei } from '../library/repo'
import { scanne } from './scan'

let dir: string
let draussen: string

function datei(rel: string, inhalt = 'x'): void {
  const p = join(dir, ...rel.split('/'))
  mkdirSync(join(p, '..'), { recursive: true })
  writeFileSync(p, inhalt)
}

beforeEach(() => {
  const basis = mkdtempSync(join(tmpdir(), 'galeria-scan-'))
  dir = join(basis, 'bib')
  draussen = join(basis, 'draussen')
  mkdirSync(dir)
  mkdirSync(draussen)
  writeFileSync(join(draussen, 'fremd.jpg'), 'fremd')
})
afterEach(() => rmSync(join(dir, '..'), { recursive: true, force: true, maxRetries: 5 }))

async function alles(
  opts = {}
): Promise<{ dateien: GefundeneDatei[]; stapel: number; unlesbar: string[] }> {
  const dateien: GefundeneDatei[] = []
  let stapel = 0
  const r = await scanne(
    dir,
    (d) => {
      stapel++
      dateien.push(...d)
    },
    opts
  )
  expect(r.gefunden).toBe(dateien.length)
  return { dateien, stapel, unlesbar: r.unlesbar }
}

describe('scanne', () => {
  it('findet Bilder rekursiv mit relativem Pfad, Größe und Zeiten', async () => {
    datei('a.jpg', '12345')
    datei('Urlaub/Kroatien/b.PNG')
    datei('Sonne 🌞/c.webp')
    const { dateien } = await alles()
    expect(dateien.map((d) => d.rel).sort()).toEqual([
      'Sonne 🌞/c.webp',
      'Urlaub/Kroatien/b.PNG',
      'a.jpg'
    ])
    const a = dateien.find((d) => d.rel === 'a.jpg') as GefundeneDatei
    expect(a.name).toBe('a.jpg')
    expect(a.size).toBe(5)
    expect(Number.isInteger(a.mtime) && a.mtime > 0).toBe(true)
  })

  it('lässt Nicht-Bilder, Versteckte und ausgeschlossene Ordner aus', async () => {
    datei('notiz.txt')
    datei('clip.mp4')
    datei('.versteckt.jpg')
    datei('$RECYCLE.BIN/geloescht.jpg')
    datei('.thumbnails/t.jpg')
    datei('AppData/Local/x.jpg')
    datei('ok.jpg')
    const { dateien } = await alles()
    expect(dateien.map((d) => d.rel)).toEqual(['ok.jpg'])
  })

  it('folgt keinen Junctions/Symlinks aus dem Ordner heraus', async () => {
    datei('ok.jpg')
    // Windows: Junction (ohne Administratorrechte möglich); Linux: der Typ wird zum Symlink
    symlinkSync(draussen, join(dir, 'Verknüpfung'), 'junction')
    const { dateien } = await alles()
    expect(dateien.map((d) => d.rel)).toEqual(['ok.jpg'])
  })

  it('meldet in Stapeln der gewünschten Größe', async () => {
    for (let i = 0; i < 7; i++) datei(`bild-${i}.jpg`)
    const { dateien, stapel } = await alles({ stapelGroesse: 3 })
    expect(dateien).toHaveLength(7)
    expect(stapel).toBe(3)
  })

  it('wirft, wenn die Wurzel fehlt (= nicht erreichbar)', async () => {
    await expect(scanne(join(dir, 'gibt-es-nicht'), () => {})).rejects.toMatchObject({
      code: 'ENOENT'
    })
  })

  it('bricht auf Wunsch ab', async () => {
    for (let i = 0; i < 5; i++) datei(`bild-${i}.jpg`)
    await expect(scanne(dir, () => {}, { abgebrochen: () => true })).rejects.toMatchObject({
      code: 'ABGEBROCHEN'
    })
  })

  it('liefert für einen leeren Ordner nichts, ohne Fehler', async () => {
    const { dateien, unlesbar } = await alles()
    expect(dateien).toEqual([])
    expect(unlesbar).toEqual([])
  })
})
