// Warteschlangen der Bibliothek (Metadaten, Vorschaubilder) mit echter Index-Datenbank (im
// Speicher) und einem nachgebauten Bilddienst: Fehler treffen nur die Datei, die sie auslöst; ein
// nicht erreichbarer Ordner bleibt offen; ohne ExifTool hört die Warteschlange auf, statt endlos
// zu versuchen; „privat“ bleibt im Arbeitsspeicher, Entfernen löscht die Cache-Dateien.
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  MetaDatei,
  MetaErgebnis,
  VorschauDatei,
  VorschauErgebnis
} from '../bilddienst/protokoll'
import type { GefundeneDatei } from './repo'

const h = vi.hoisted(() => ({
  db: null as unknown as import('../db').DB,
  dateien: [] as GefundeneDatei[],
  /** Antwort von isDirReachable, je Aufruf gefragt */
  erreichbar: (() => true) as () => boolean,
  meta: (async () => []) as (d: MetaDatei[]) => Promise<MetaErgebnis[]>,
  vorschau: (async () => []) as (d: VorschauDatei[]) => Promise<VorschauErgebnis[]>,
  /** lokaler Datenordner des Tests (Cache der Vorschaubilder) */
  tmp: '',
  /** meldet der Schlüssel beim Start „neu“ (Cache geleert)? */
  schluesselNeu: false,
  /** Antwort auf Rückfragen (0 = bestätigt) */
  antwort: 0,
  /** Papierkorb des Systems (nachgebaut): wirft = geht nicht */
  papierkorb: (async () => undefined) as (pfad: string) => Promise<void>,
  /** geschieht, während die Rückfrage offen ist */
  waehrendRueckfrage: (async () => undefined) as () => Promise<unknown>
}))

vi.mock('electron', () => ({
  // getAppPath: ffmpeg wird dort gesucht (ffmpegPath.ts) – im Test gibt es keins
  app: { getPath: () => 'C:\\Profil', getAppPath: () => h.tmp, isPackaged: false },
  BrowserWindow: { fromWebContents: () => null },
  dialog: {
    showMessageBox: async () => {
      await h.waehrendRueckfrage()
      return { response: h.antwort }
    }
  },
  shell: { trashItem: vi.fn((p: string) => h.papierkorb(p)) }
}))
// die Dateien der Tests gibt es nicht wirklich – die Prüfung (passt zum Index) gilt als bestanden
vi.mock('../dateien/pruefeDatei', async (original) => ({
  ...(await original<typeof import('../dateien/pruefeDatei')>()),
  pruefeDatei: async () => undefined
}))
vi.mock('../log', () => ({ logLine: vi.fn() }))
vi.mock('../broadcast', () => ({ broadcast: vi.fn() }))
vi.mock('../fileDialogs', () => ({ showOpenDialog: vi.fn() }))
vi.mock('../lokaleDaten', () => ({
  lokalerOrdner: () => h.tmp,
  lokalerUnterordner: (name: string) => {
    const d = join(h.tmp, name)
    mkdirSync(d, { recursive: true })
    return d
  }
}))
vi.mock('../cache/schluessel', () => ({
  vorschauSchluessel: () => ({ schluessel: Buffer.alloc(32, 7), neu: h.schluesselNeu })
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
    vorschau: vi.fn((d: VorschauDatei[]) => h.vorschau(d)),
    beenden: vi.fn()
  }
}))

const { oeffneIndex } = await import('../db')
const repo = await import('./repo')
const { bilddienst } = await import('../bilddienst/client')
const meta = vi.mocked(bilddienst.meta)
const vorschau = vi.mocked(bilddienst.vorschau)
const { shell } = await import('electron')
const { vorschauPfad } = await import('../cache/ablage')

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

/** Vorschaubilder: alles gelingt; „speicher“ bekommt die Bytes zurück */
const allesOk = async (d: VorschauDatei[]): Promise<VorschauErgebnis[]> =>
  d.map((x) => ({
    id: x.id,
    ok: true as const,
    farbe: '#102030',
    ...(x.ziel === 'speicher'
      ? { gross: Buffer.from(`G${x.id}`), klein: Buffer.from(`K${x.id}`) }
      : {})
  }))

let lib: typeof import('./library')
let vorschauen: typeof import('./vorschauen')
beforeEach(async () => {
  vi.resetModules()
  meta.mockClear()
  vorschau.mockClear()
  h.tmp = mkdtempSync(join(tmpdir(), 'galeria-lib-'))
  h.vorschau = allesOk
  h.schluesselNeu = false
  h.antwort = 0
  h.papierkorb = async () => undefined
  h.waehrendRueckfrage = async () => undefined
  h.db = oeffneIndex(':memory:')
  h.erreichbar = () => true
  h.dateien = ['a.jpg', 'gift.jpg', 'c.jpg'].map(datei)
  repo.ordnerAnlegen(h.db, 'D:\\Bilder', true, 1)
  lib = await import('./library')
  vorschauen = await import('./vorschauen')
})
afterEach(() => {
  lib.bibliothekBeenden()
  h.db.close()
  rmSync(h.tmp, { recursive: true, force: true, maxRetries: 5 })
})

type VZeile = {
  name: string
  id: number
  thumb_state: string | null
  status: string
  color: string | null
}
const vzeilen = (): Record<string, Omit<VZeile, 'name'>> =>
  Object.fromEntries(
    (h.db.prepare('SELECT name, id, thumb_state, status, color FROM images').all() as VZeile[]).map(
      ({ name: n, ...r }) => [n, r]
    )
  )

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

describe('Vorschaubilder-Warteschlange', () => {
  const eingelesen = (): Promise<void> => vi.waitFor(() => expect(lib.zustand().total).toBe(3))

  it('Hintergrund: jede Datei bekommt ihr Vorschaubild auf die Platte, mit Farbe', async () => {
    lib.bibliothekStarten()
    await eingelesen()
    await vi.waitFor(() => expect(lib.zustand().thumbPending).toBe(0))
    expect(Object.values(vzeilen()).map((z) => [z.thumb_state, z.color])).toEqual([
      ['ok', '#102030'],
      ['ok', '#102030'],
      ['ok', '#102030']
    ])
    expect(vorschau.mock.calls.flatMap(([d]) => d.map((x) => x.ziel))).not.toContain('speicher')
  })

  it('Absturz: einzeln nachfragen; beim zweiten Absturz an derselben Datei gilt sie als defekt', async () => {
    h.vorschau = async (d) => {
      if (d.length > 1 || name(d[0].pfad) === 'gift.jpg') throw fehler('DIENST_BEENDET')
      return allesOk(d)
    }
    lib.bibliothekStarten()
    await eingelesen()
    await vi.waitFor(() => {
      const z = vzeilen()
      expect([z['a.jpg'].thumb_state, z['c.jpg'].thumb_state]).toEqual(['ok', 'ok'])
    })
    // ein Abruf (thumb://) versucht es noch einmal – spätestens dann der zweite Absturz
    expect(await vorschauen.vorschauHolen(vzeilen()['gift.jpg'].id, 256)).toBe('keins')
    await vi.waitFor(() =>
      expect(vzeilen()['gift.jpg']).toMatchObject({ thumb_state: 'defekt', status: 'defekt' })
    )
    const allein = vorschau.mock.calls.filter(
      ([d]) => d.length === 1 && name(d[0].pfad) === 'gift.jpg'
    )
    expect(allein).toHaveLength(2)
    expect(lib.zustand().thumbPending).toBe(0)
  })

  it('„privat“: nichts auf der Platte, Vorschau auf Abruf aus dem Arbeitsspeicher', async () => {
    await lib.modusSetzen(1, 'privat')
    lib.bibliothekStarten()
    await eingelesen()
    // der Hintergrund lässt „privat“ aus
    await new Promise((r) => setTimeout(r, 50))
    expect(vorschau).not.toHaveBeenCalled()
    expect(lib.zustand().thumbPending).toBe(0)
    const a = vzeilen()['a.jpg']
    const gross = await vorschauen.vorschauHolen(a.id, 768)
    expect(Buffer.from(gross as Uint8Array).toString()).toBe(`G${a.id}`)
    expect(vorschau.mock.calls.flatMap(([d]) => d.map((x) => x.ziel))).toEqual(['speicher'])
    // zweiter Abruf aus dem Speicher, ohne Bilddienst; die Platte bleibt leer
    const klein = await vorschauen.vorschauHolen(a.id, 256)
    expect(Buffer.from(klein as Uint8Array).toString()).toBe(`K${a.id}`)
    expect(vorschau).toHaveBeenCalledTimes(1)
    expect(vzeilen()['a.jpg']).toMatchObject({ thumb_state: null, color: '#102030' })
    expect(existsSync(vorschauPfad(join(h.tmp, 'vorschau'), a.id, 256))).toBe(false)
  })

  it('„privat“ schalten und Ordner entfernen löschen die Cache-Dateien sofort', async () => {
    lib.bibliothekStarten()
    await eingelesen()
    await vi.waitFor(() => expect(lib.zustand().thumbPending).toBe(0))
    const cache = join(h.tmp, 'vorschau')
    const ids = Object.values(vzeilen()).map((z) => z.id)
    const anlegen = (): void => {
      for (const id of ids) {
        for (const stufe of [256, 768] as const) {
          mkdirSync(join(vorschauPfad(cache, id, stufe), '..'), { recursive: true })
          writeFileSync(vorschauPfad(cache, id, stufe), 'x')
        }
      }
    }
    const vorhanden = (): number =>
      ids
        .flatMap((id) => [256, 768].map((s) => vorschauPfad(cache, id, s as 256 | 768)))
        .filter((p) => existsSync(p)).length
    anlegen()
    expect(vorhanden()).toBe(6)
    await lib.modusSetzen(1, 'privat')
    expect(vorhanden()).toBe(0)
    // zurück auf „normal“: wieder offen, der Hintergrund legt den Cache neu an
    await lib.modusSetzen(1, 'normal')
    await vi.waitFor(() => expect(lib.zustand().thumbPending).toBe(0))
    anlegen()
    expect(await lib.ordnerEntfernen(null, 1)).toBe(true)
    expect(vorhanden()).toBe(0)
  })

  it('Neustart mit neuem Schlüssel (Cache geleert): alles entsteht im Hintergrund neu', async () => {
    lib.bibliothekStarten()
    await eingelesen()
    await vi.waitFor(() => expect(lib.zustand().thumbPending).toBe(0))
    expect(vorschau.mock.calls.flatMap(([d]) => d)).toHaveLength(3)
    // „Neustart“: frische Module, derselbe Index; der Schlüssel ist neu
    lib.bibliothekBeenden()
    vi.resetModules()
    h.schluesselNeu = true
    lib = await import('./library')
    lib.bibliothekStarten()
    await vi.waitFor(() => expect(vorschau.mock.calls.flatMap(([d]) => d)).toHaveLength(6))
    await vi.waitFor(() => expect(lib.zustand().thumbPending).toBe(0))
    expect(Object.values(vzeilen()).map((z) => z.thumb_state)).toEqual(['ok', 'ok', 'ok'])
  })

  it('der gemeldete sichtbare Ausschnitt kommt vor dem übrigen Hintergrund', async () => {
    h.dateien = Array.from({ length: 12 }, (_, i) => datei(`b${String(i).padStart(2, '0')}.jpg`))
    // der erste Stapel wartet, bis der Ausschnitt gemeldet ist
    let weiter: () => void = () => undefined
    const erster = new Promise<void>((r) => (weiter = r))
    let aufrufe = 0
    h.vorschau = async (d) => {
      if (aufrufe++ === 0) await erster
      return allesOk(d)
    }
    lib.bibliothekStarten()
    await vi.waitFor(() => expect(lib.zustand().total).toBe(12))
    await vi.waitFor(() => expect(vorschau).toHaveBeenCalledTimes(1))
    const ids = (
      h.db.prepare('SELECT id FROM images ORDER BY id').pluck().all() as number[]
    ).slice()
    const ende = ids.slice(-2)
    expect(vorschau.mock.calls[0][0].map((x) => x.id)).not.toContain(ende[0])
    lib.sichtbar(ende)
    weiter()
    await vi.waitFor(() => expect(vorschau.mock.calls.length).toBeGreaterThanOrEqual(2))
    expect(vorschau.mock.calls[1][0].map((x) => x.id)).toEqual(ende)
    await vi.waitFor(() => expect(lib.zustand().thumbPending).toBe(0))
  })
})

describe('Papierkorb', () => {
  const papierkorb = vi.mocked(shell.trashItem)
  const ids = (): Record<string, number> =>
    Object.fromEntries(Object.entries(vzeilen()).map(([n, z]) => [n, z.id]))

  // Klammern nötig: mockClear() gibt den Mock zurück – als Rückgabe von beforeEach hielte Vitest
  // ihn für Aufräumarbeit und riefe den Papierkorb nach dem Test ohne Pfad auf
  beforeEach(() => {
    papierkorb.mockClear()
  })

  async function bereit(): Promise<void> {
    lib.bibliothekStarten()
    await vi.waitFor(() => expect(lib.zustand().total).toBe(3))
    await vi.waitFor(() => expect(lib.zustand().thumbPending).toBe(0))
  }

  it('Rückfrage mit „Abbrechen“: nichts verschoben, nichts aus dem Index', async () => {
    await bereit()
    h.antwort = 1
    expect(await lib.inPapierkorb(null, [ids()['a.jpg']])).toEqual({
      moved: 0,
      failed: 0,
      cancelled: true,
      refused: null
    })
    expect(papierkorb).not.toHaveBeenCalled()
    expect(lib.zustand().total).toBe(3)
  })

  it('verschiebt nach Rückfrage; Index-Zeilen und Vorschaubilder sind danach weg', async () => {
    await bereit()
    const { a, c } = { a: ids()['a.jpg'], c: ids()['c.jpg'] }
    const cache = join(h.tmp, 'vorschau')
    for (const id of [a, c]) {
      mkdirSync(join(vorschauPfad(cache, id, 256), '..'), { recursive: true })
      writeFileSync(vorschauPfad(cache, id, 256), 'x')
    }
    expect(await lib.inPapierkorb(null, [a, c])).toEqual({
      moved: 2,
      failed: 0,
      cancelled: false,
      refused: null
    })
    expect(papierkorb.mock.calls.map(([p]) => p)).toEqual([
      join('D:\\Bilder', 'sub', 'a.jpg'),
      join('D:\\Bilder', 'sub', 'c.jpg')
    ])
    expect(Object.keys(vzeilen())).toEqual(['gift.jpg'])
    expect(existsSync(vorschauPfad(cache, a, 256))).toBe(false)
    expect(existsSync(vorschauPfad(cache, c, 256))).toBe(false)
  })

  it('Ordner „nur lesen“: nichts verschoben, keine Rückfrage, Hinweis', async () => {
    await bereit()
    await lib.modusSetzen(1, 'nur-lesen')
    h.antwort = 0
    const r = await lib.inPapierkorb(null, [ids()['a.jpg']])
    expect(r).toMatchObject({ moved: 0, failed: 0, cancelled: false })
    expect(r.refused).toMatch(/nur lesen/)
    expect(papierkorb).not.toHaveBeenCalled()
    expect(lib.zustand().total).toBe(3)
  })

  it('während der Rückfrage auf „nur lesen“ gestellt: nichts verschoben (frischer Stand)', async () => {
    await bereit()
    h.waehrendRueckfrage = () => lib.modusSetzen(1, 'nur-lesen')
    const r = await lib.inPapierkorb(null, [ids()['a.jpg']])
    expect(r).toMatchObject({ moved: 0, failed: 1, cancelled: false })
    expect(papierkorb).not.toHaveBeenCalled()
    expect(lib.zustand().total).toBe(3)
  })

  it('geht der Papierkorb nicht (Netzlaufwerk): nichts gelöscht, Datei bleibt im Index', async () => {
    await bereit()
    h.papierkorb = async (p) => {
      if (p.endsWith('gift.jpg')) throw Object.assign(new Error('x'), { code: 'EPERM' })
    }
    const r = await lib.inPapierkorb(null, [ids()['a.jpg'], ids()['gift.jpg']])
    expect(r).toMatchObject({ moved: 1, failed: 1 })
    expect(Object.keys(vzeilen()).sort()).toEqual(['c.jpg', 'gift.jpg'])
  })
})
