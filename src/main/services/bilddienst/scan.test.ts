import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { GefundeneDatei } from '../library/repo'
import { scanne, scanneTeile } from './scan'

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

describe('scanneTeile (nach dem Überwachen)', () => {
  async function teile(
    pfade: string[],
    nurDateien: string[] = []
  ): Promise<{ rel: string[]; unlesbar: string[] }> {
    const dateien: GefundeneDatei[] = []
    const r = await scanneTeile(dir, pfade, nurDateien, (d) => dateien.push(...d))
    expect(r.gefunden).toBe(dateien.length)
    return { rel: dateien.map((d) => d.rel).sort(), unlesbar: r.unlesbar }
  }

  it('Ordner samt allem darunter, einzelne Dateien für sich – sonst nichts', async () => {
    datei('a.jpg')
    datei('b.jpg')
    datei('Urlaub/Köln/c.jpg')
    datei('Urlaub/d.png')
    datei('Urlaub/notiz.txt')
    datei('Anderes/e.jpg')
    expect(await teile(['Urlaub', 'a.jpg'])).toEqual({
      rel: ['Urlaub/Köln/c.jpg', 'Urlaub/d.png', 'a.jpg'],
      unlesbar: []
    })
  })

  it('was es nicht mehr gibt, liefert nichts (auch nicht als unlesbar)', async () => {
    datei('a.jpg')
    expect(await teile(['weg.jpg', 'Weg/x.jpg', 'a.jpg/unsinn'])).toEqual({
      rel: [],
      unlesbar: []
    })
  })

  it('folgt keiner Junction – weder als Ziel noch auf dem Weg dorthin', async () => {
    datei('ok.jpg')
    symlinkSync(draussen, join(dir, 'Verknüpfung'), 'junction')
    expect(await teile(['Verknüpfung', 'Verknüpfung/fremd.jpg', 'ok.jpg'])).toEqual({
      rel: ['ok.jpg'],
      unlesbar: []
    })
  })

  it('als geändert gemeldet: nur Dateien – ein Ordner wird nicht durchsucht', async () => {
    datei('Urlaub/a.jpg')
    datei('Urlaub/Köln/b.jpg')
    expect(await teile([], ['Urlaub', 'Urlaub/a.jpg'])).toEqual({
      rel: ['Urlaub/a.jpg'],
      unlesbar: []
    })
  })

  it('lässt Ausgeschlossenes und ungültige Pfade aus', async () => {
    datei('$RECYCLE.BIN/x.jpg')
    datei('.versteckt/y.jpg')
    datei('Urlaub/z.jpg')
    expect(
      await teile([
        '$RECYCLE.BIN',
        '.versteckt/y.jpg',
        '../draussen/fremd.jpg',
        'Urlaub/./z.jpg',
        ''
      ])
    ).toEqual({ rel: [], unlesbar: [] })
  })

  it('wirft, wenn die Wurzel fehlt (= nicht erreichbar)', async () => {
    await expect(
      scanneTeile(join(dir, 'gibt-es-nicht'), ['a.jpg'], [], () => {})
    ).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
