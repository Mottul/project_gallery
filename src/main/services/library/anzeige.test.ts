// bild:// aus Sicht des main: Kennung → Prüfung → Original oder Umrechnung, mit echten Dateien im
// Temp-Ordner und einem nachgebauten Bilddienst.
import { mkdirSync, mkdtempSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AnzeigeDatei, AnzeigeErgebnis } from '../bilddienst/protokoll'

const h = vi.hoisted(() => ({
  anzeige: (async () => ({ daten: null, code: 'DEFEKT' })) as (
    d: AnzeigeDatei
  ) => Promise<AnzeigeErgebnis>
}))
vi.mock('../log', () => ({ logLine: vi.fn() }))
vi.mock('../bilddienst/client', () => ({
  bilddienst: { anzeige: vi.fn((d: AnzeigeDatei) => h.anzeige(d)) }
}))

const { oeffneIndex } = await import('../db')
const repo = await import('./repo')
const { bildHolen, anzeigeVerwerfen } = await import('./anzeige')
const { bilddienst } = await import('../bilddienst/client')

let basis: string
let ordner: string
let db: ReturnType<typeof oeffneIndex>
let folderId: number

/** Datei anlegen und wie ein Scan eintragen; liefert die Kennung. */
function datei(rel: string, inhalt: Buffer | string, format: string | null): number {
  const p = join(ordner, ...rel.split('/'))
  mkdirSync(join(p, '..'), { recursive: true })
  writeFileSync(p, inhalt)
  const st = statSync(p)
  const seq = repo.scanBeginnen(db, folderId)
  repo.stapelSchreiben(
    db,
    folderId,
    seq,
    [
      {
        rel,
        name: rel.split('/').pop() as string,
        size: st.size,
        mtime: Math.trunc(st.mtimeMs),
        btime: null
      }
    ],
    process.platform === 'win32'
  )
  const id = db.prepare('SELECT id FROM images WHERE rel_path = ?').pluck().get(rel) as number
  db.prepare('UPDATE images SET format = ? WHERE id = ?').run(format, id)
  return id
}

beforeEach(() => {
  basis = mkdtempSync(join(tmpdir(), 'galeria-anzeige-'))
  ordner = join(basis, 'bib')
  mkdirSync(ordner)
  db = oeffneIndex(':memory:')
  folderId = repo.ordnerAnlegen(db, ordner, process.platform === 'win32', 1)
  h.anzeige = async () => ({ daten: null, code: 'DEFEKT' })
})
afterEach(() => {
  db.close()
  rmSync(basis, { recursive: true, force: true, maxRetries: 5 })
})

describe('bild:// im main', () => {
  it('Original direkt, wenn Chromium es zeigen kann – Typ nach dem Inhalt', async () => {
    const id = datei('a.jpg', 'PNG-INHALT', 'png')
    expect(await bildHolen(db, id)).toEqual({
      art: 'datei',
      pfad: join(ordner, 'a.jpg'),
      typ: 'image/png',
      size: 10
    })
    expect(bilddienst.anzeige).not.toHaveBeenCalled()
  })

  it('unbekannt 404, geändert 409, verschwunden 404', async () => {
    expect(await bildHolen(db, 9999)).toEqual({ art: 'status', status: 404 })
    const id = datei('b.jpg', 'x', 'jpeg')
    writeFileSync(join(ordner, 'b.jpg'), 'größer geworden')
    expect(await bildHolen(db, id)).toEqual({ art: 'status', status: 409 })
    rmSync(join(ordner, 'b.jpg'))
    expect(await bildHolen(db, id)).toEqual({ art: 'status', status: 404 })
  })

  it('eine Verknüpfung nach außen (Junction) liefert nichts: 403', async () => {
    const aussen = join(basis, 'aussen')
    mkdirSync(aussen)
    writeFileSync(join(aussen, 'geheim.jpg'), 'geheim')
    symlinkSync(aussen, join(ordner, 'link'), 'junction')
    // so stünde es im Index, wenn die Junction nach dem Einlesen untergeschoben wurde
    const st = statSync(join(aussen, 'geheim.jpg'))
    const seq = repo.scanBeginnen(db, folderId)
    repo.stapelSchreiben(
      db,
      folderId,
      seq,
      [
        {
          rel: 'link/geheim.jpg',
          name: 'geheim.jpg',
          size: st.size,
          mtime: Math.trunc(st.mtimeMs),
          btime: null
        }
      ],
      process.platform === 'win32'
    )
    const id = db.prepare("SELECT id FROM images WHERE name = 'geheim.jpg'").pluck().get() as number
    expect(await bildHolen(db, id)).toEqual({ art: 'status', status: 403 })
  })

  it('TIFF: Umrechnung aus dem Bilddienst, danach aus dem Arbeitsspeicher; nicht darstellbar: 204', async () => {
    const id = datei('c.tif', 'TIFF', 'tiff')
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3])
    h.anzeige = async () => ({ daten: jpeg, code: null })
    expect(await bildHolen(db, id)).toEqual({ art: 'daten', daten: jpeg })
    expect(await bildHolen(db, id)).toEqual({ art: 'daten', daten: jpeg })
    expect(bilddienst.anzeige).toHaveBeenCalledTimes(1)
    anzeigeVerwerfen([id])
    h.anzeige = async () => ({ daten: null, code: 'DEFEKT' })
    expect(await bildHolen(db, id)).toEqual({ art: 'status', status: 204 })
  })
})
