// Metadaten-Warteschlange der Bibliothek mit echter Index-Datenbank (im Speicher) und einem
// nachgebauten Bilddienst: Fehler treffen nur die Datei, die sie auslöst; ein nicht erreichbarer
// Ordner bleibt offen; ohne ExifTool hört die Warteschlange auf, statt endlos zu versuchen.
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MetaDatei, MetaErgebnis } from '../bilddienst/protokoll'
import type { GefundeneDatei } from './repo'

const h = vi.hoisted(() => ({
  db: null as unknown as import('../db').DB,
  dateien: [] as GefundeneDatei[],
  /** Antwort von isDirReachable, je Aufruf gefragt */
  erreichbar: (() => true) as () => boolean,
  meta: (async () => []) as (d: MetaDatei[]) => Promise<MetaErgebnis[]>
}))

vi.mock('electron', () => ({
  app: { getPath: () => 'C:\\Profil' },
  BrowserWindow: { fromWebContents: () => null },
  dialog: {}
}))
vi.mock('../log', () => ({ logLine: vi.fn() }))
vi.mock('../broadcast', () => ({ broadcast: vi.fn() }))
vi.mock('../fileDialogs', () => ({ showOpenDialog: vi.fn() }))
vi.mock('../lokaleDaten', () => ({
  lokalerOrdner: () => 'C:\\Lokal',
  lokalerUnterordner: () => 'C:\\Lokal\\index'
}))
vi.mock('../reachableDir', () => ({ isDirReachable: async () => h.erreichbar() }))
vi.mock('../db', async (original) => ({
  ...(await original<typeof import('../db')>()),
  getDb: () => h.db,
  schliesseDb: vi.fn()
}))
vi.mock('../bilddienst/client', () => ({
  bilddienst: {
    // liefert die Dateien sofort in einem Stapel
    scan: (_wurzel: string, onStapel: (d: GefundeneDatei[]) => void) => {
      onStapel(h.dateien)
      return {
        fertig: Promise.resolve({ gefunden: h.dateien.length, unlesbar: [] }),
        abbrechen() {}
      }
    },
    meta: vi.fn((d: MetaDatei[]) => h.meta(d)),
    beenden: vi.fn()
  }
}))

const { oeffneIndex } = await import('../db')
const repo = await import('./repo')
const { bilddienst } = await import('../bilddienst/client')
const meta = vi.mocked(bilddienst.meta)

const datei = (name: string): GefundeneDatei => ({
  rel: `sub/${name}`,
  name,
  size: 10,
  mtime: Date.UTC(2026, 0, 1),
  btime: null
})
const fehler = (code: string): Error => Object.assign(new Error('x'), { code })
const exif = { 'File:FileType': 'JPEG', 'EXIF:DateTimeOriginal': '2020:01:01 10:00:00' }
const name = (pfad: string): string => pfad.split(/[\\/]/).pop() as string

type Zeile = { name: string; taken_source: string; meta_read_at: number | null }
const zeilen = (): Record<string, Omit<Zeile, 'name'>> =>
  Object.fromEntries(
    (h.db.prepare('SELECT name, taken_source, meta_read_at FROM images').all() as Zeile[]).map(
      ({ name: n, ...r }) => [n, r]
    )
  )

let lib: typeof import('./library')
beforeEach(async () => {
  vi.resetModules()
  meta.mockClear()
  h.db = oeffneIndex(':memory:')
  h.erreichbar = () => true
  h.dateien = ['a.jpg', 'gift.jpg', 'c.jpg'].map(datei)
  repo.ordnerAnlegen(h.db, 'D:\\Bilder', true, 1)
  lib = await import('./library')
})
afterEach(() => {
  lib.bibliothekBeenden()
  h.db.close()
})

describe('Metadaten-Warteschlange', () => {
  it('Stapel scheitert: einzeln nachlesen – nur die auslösende Datei bekommt das Dateidatum', async () => {
    h.meta = async (d) => {
      if (d.length > 1) throw fehler('DIENST_BEENDET')
      if (name(d[0].pfad) === 'gift.jpg') throw fehler('ZEITLIMIT')
      return d.map((x) => ({ id: x.id, roh: exif }))
    }
    lib.bibliothekStarten()
    // erst eingelesen (3 Dateien), dann alle gelesen
    await vi.waitFor(() => expect(lib.zustand()).toMatchObject({ total: 3, metaPending: 0 }))
    expect(zeilen()).toEqual({
      'a.jpg': { taken_source: 'exif', meta_read_at: expect.any(Number) },
      'gift.jpg': { taken_source: 'datei-geaendert', meta_read_at: expect.any(Number) },
      'c.jpg': { taken_source: 'exif', meta_read_at: expect.any(Number) }
    })
    // Pfade absolut, mit dem Trenner des Systems zusammengesetzt
    expect(meta.mock.calls[0][0].map((x) => x.pfad)).toContain(join('D:\\Bilder', 'sub', 'a.jpg'))
  })

  it('Ordner nicht erreichbar: Dateien bleiben offen, kein endloses Wiederholen', async () => {
    h.meta = async (d) => d.map((x) => ({ id: x.id, roh: null }))
    // das Einlesen findet den Ordner noch, beim Lesen der Metadaten ist er weg
    let fragen = 0
    h.erreichbar = () => fragen++ === 0
    lib.bibliothekStarten()
    await vi.waitFor(() => expect(lib.zustand().folders[0].status).toBe('nicht-erreichbar'))
    expect(meta).toHaveBeenCalled()
    const aufrufe = meta.mock.calls.length
    await new Promise((r) => setTimeout(r, 100))
    expect(meta.mock.calls.length).toBe(aufrufe)
    // nichts einzeln nachgelesen, nichts als gelesen markiert
    expect(meta.mock.calls.every(([d]) => d.length === 3)).toBe(true)
    expect(Object.values(zeilen()).every((z) => z.meta_read_at === null)).toBe(true)
    expect(lib.zustand().metaPending).toBe(0)
  })

  it('ExifTool fehlt: hört auf, ohne etwas als gelesen zu markieren', async () => {
    h.meta = async () => {
      throw fehler('KEIN_EXIFTOOL')
    }
    lib.bibliothekStarten()
    await vi.waitFor(() => expect(meta).toHaveBeenCalled())
    await new Promise((r) => setTimeout(r, 50))
    expect(meta).toHaveBeenCalledTimes(1)
    expect(Object.values(zeilen()).every((z) => z.meta_read_at === null)).toBe(true)
    expect(lib.zustand().metaPending).toBe(0)
  })
})
