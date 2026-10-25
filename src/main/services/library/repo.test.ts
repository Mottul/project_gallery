import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GefundeneDatei } from './repo'

vi.mock('../log', () => ({ logLine: vi.fn() }))

const { oeffneIndex } = await import('../db')
const repo = await import('./repo')
type DB = ReturnType<typeof oeffneIndex>

const datei = (rel: string, size = 100, mtime = 1000): GefundeneDatei => ({
  rel,
  name: rel.split('/').pop() as string,
  size,
  mtime,
  btime: 500
})

const status = (db: DB): Record<string, string> =>
  Object.fromEntries(
    (
      db.prepare('SELECT rel_path, status FROM images ORDER BY rel_path').all() as {
        rel_path: string
        status: string
      }[]
    ).map((r) => [r.rel_path, r.status])
  )

/** Vollständiger Scan mit diesen Dateien (ein Stapel). */
function scan(db: DB, id: number, dateien: GefundeneDatei[], unlesbar: string[] = []): number {
  const seq = repo.scanBeginnen(db, id)
  repo.stapelSchreiben(db, id, seq, dateien, true)
  return repo.scanAbschliessen(db, id, seq, unlesbar, true, 2000)
}

let db: DB
let id: number
beforeEach(() => {
  db = oeffneIndex(':memory:')
  id = repo.ordnerAnlegen(db, 'D:\\Bilder', true, 1)
})
afterEach(() => db.close())

describe('Bibliothek im Index', () => {
  it('legt Ordner an und zählt eingelesene Dateien', () => {
    scan(db, id, [datei('a.jpg'), datei('Urlaub/b.jpg'), datei('Urlaub/c.png')])
    expect(repo.ordnerListe(db).map((o) => [o.path, o.path_key, o.mode])).toEqual([
      ['D:\\Bilder', 'd:/bilder', 'normal']
    ])
    expect(repo.zaehlen(db).get(id)).toEqual({ count: 3, missing: 0 })
    expect(repo.ordnerHolen(db, id)?.last_scan).toBe(2000)
  })

  it('berechnet Sortierschlüssel und Endung beim Eintragen', () => {
    scan(db, id, [datei('Bild 10.JPG')])
    const row = db.prepare('SELECT name, name_sort, ext, rel_key FROM images').get()
    expect(row).toEqual({
      name: 'Bild 10.JPG',
      name_sort: 'bild 0210!.jpg',
      ext: 'jpg',
      rel_key: 'bild 10.jpg'
    })
  })

  it('Abgleich: geändert, verschwunden, neu, wieder da', () => {
    scan(db, id, [datei('a.jpg'), datei('b.jpg'), datei('c.jpg')])
    db.prepare("UPDATE images SET meta_read_at = 1, thumb_state = 'fertig'").run()
    const fehlend = scan(db, id, [datei('a.jpg'), datei('b.jpg', 222), datei('d.jpg')])
    expect(fehlend).toBe(1)
    expect(status(db)).toEqual({ 'a.jpg': 'ok', 'b.jpg': 'ok', 'c.jpg': 'fehlt', 'd.jpg': 'ok' })
    const meta = (rel: string): unknown =>
      db.prepare('SELECT meta_read_at, thumb_state FROM images WHERE rel_path = ?').get(rel)
    // unverändert: bleibt; geändert: wird neu gelesen
    expect(meta('a.jpg')).toEqual({ meta_read_at: 1, thumb_state: 'fertig' })
    expect(meta('b.jpg')).toEqual({ meta_read_at: null, thumb_state: null })
    expect(repo.zaehlen(db).get(id)).toEqual({ count: 3, missing: 1 })
    // c taucht wieder auf
    scan(db, id, [datei('a.jpg'), datei('b.jpg', 222), datei('c.jpg'), datei('d.jpg')])
    expect(status(db)['c.jpg']).toBe('ok')
  })

  it('eine nur in der Schreibweise umbenannte Datei behält ihre Zeile', () => {
    scan(db, id, [datei('Urlaub/IMG_1.jpg')])
    const vorher = db.prepare('SELECT id FROM images').get()
    scan(db, id, [datei('urlaub/img_1.JPG')])
    expect(db.prepare('SELECT id, rel_path, name FROM images').all()).toEqual([
      { ...(vorher as object), rel_path: 'urlaub/img_1.JPG', name: 'img_1.JPG' }
    ])
  })

  it('Dateien unter einem unlesbaren Ordner fehlen nicht', () => {
    scan(db, id, [
      datei('a.jpg'),
      datei('Privat/x.jpg'),
      datei('Privat/tief/y.jpg'),
      datei('Privat2/z.jpg')
    ])
    scan(db, id, [datei('a.jpg')], ['Privat'])
    expect(status(db)).toEqual({
      'a.jpg': 'ok',
      'Privat/tief/y.jpg': 'ok',
      'Privat/x.jpg': 'ok',
      'Privat2/z.jpg': 'fehlt'
    })
    expect(repo.ordnerHolen(db, id)?.unreadable).toBe(1)
  })

  it('ein begonnener, nicht abgeschlossener Scan markiert nichts als fehlend', () => {
    scan(db, id, [datei('a.jpg'), datei('b.jpg')])
    const seq = repo.scanBeginnen(db, id)
    repo.stapelSchreiben(db, id, seq, [datei('a.jpg')], true)
    // abgebrochen: kein scanAbschliessen
    expect(status(db)).toEqual({ 'a.jpg': 'ok', 'b.jpg': 'ok' })
  })

  it('„defekt“ bleibt, solange die Datei gleich bleibt; geändert wird sie neu geprüft', () => {
    scan(db, id, [datei('kaputt.jpg')])
    db.prepare("UPDATE images SET status = 'defekt'").run()
    scan(db, id, [datei('kaputt.jpg')])
    expect(status(db)['kaputt.jpg']).toBe('defekt')
    scan(db, id, [datei('kaputt.jpg', 999)])
    expect(status(db)['kaputt.jpg']).toBe('ok')
  })

  it('Modus setzen und Ordner samt Dateien entfernen', () => {
    scan(db, id, [datei('a.jpg')])
    expect(repo.modusSetzen(db, id, 'privat')).toBe(true)
    expect(repo.ordnerHolen(db, id)?.mode).toBe('privat')
    expect(repo.ordnerEntfernen(db, id)).toBe(true)
    expect(repo.ordnerListe(db)).toEqual([])
    expect(db.prepare('SELECT count(*) n FROM images').get()).toEqual({ n: 0 })
    expect(repo.ordnerEntfernen(db, id)).toBe(false)
  })

  it('lehnt ungültige Modi schon in der Datenbank ab', () => {
    expect(() =>
      repo.modusSetzen(db, id, 'alles' as unknown as Parameters<typeof repo.modusSetzen>[2])
    ).toThrow(/CHECK/)
  })
})
