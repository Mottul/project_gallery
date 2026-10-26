import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { lokalAusMs } from '@shared/dates'
import { grundfelderAus } from '@shared/grundfelder'
import { orderBy, SORT_FELDER } from '@shared/sortFilter'
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

describe('Grundfelder im Index', () => {
  const datum = (rel: string): unknown =>
    db
      .prepare('SELECT taken_at, taken_offset, taken_source FROM images WHERE rel_path = ?')
      .get(rel)

  it('neue Dateien haben sofort ein vorläufiges Datum (die ältere Dateizeit)', () => {
    scan(db, id, [
      { rel: 'kopiert.jpg', name: 'kopiert.jpg', size: 1, mtime: 1_000_000, btime: 9_000_000 },
      { rel: 'bearbeitet.jpg', name: 'bearbeitet.jpg', size: 1, mtime: 9_000_000, btime: 1_000 },
      { rel: 'ohne.jpg', name: 'ohne.jpg', size: 1, mtime: 5_000_000, btime: null }
    ])
    expect(datum('kopiert.jpg')).toEqual({
      taken_at: lokalAusMs(1_000_000),
      taken_offset: null,
      taken_source: 'datei-geaendert'
    })
    expect(datum('bearbeitet.jpg')).toMatchObject({
      taken_at: lokalAusMs(1_000),
      taken_source: 'datei-erstellt'
    })
    expect(datum('ohne.jpg')).toMatchObject({ taken_source: 'datei-geaendert' })
  })

  it('Warteschlange: offene Dateien mit Pfad, ohne fehlende und ohne ausgeschlossene Ordner', () => {
    const id2 = repo.ordnerAnlegen(db, 'E:\\Stick', true, 1)
    scan(db, id, [datei('a.jpg'), datei('Urlaub/b.jpg'), datei('c.jpg')])
    scan(db, id2, [datei('d.jpg')])
    scan(db, id, [datei('a.jpg'), datei('Urlaub/b.jpg')]) // c fehlt
    const offen = repo.metaOffen(db, 10)
    expect(offen.map((o) => [o.ordner, o.rel_path])).toEqual([
      ['D:\\Bilder', 'a.jpg'],
      ['D:\\Bilder', 'Urlaub/b.jpg'],
      ['E:\\Stick', 'd.jpg']
    ])
    expect(offen[0]).toMatchObject({ folder_id: id, size: 100, mtime: 1000, btime: 500 })
    expect(repo.metaOffen(db, 1)).toHaveLength(1)
    expect(repo.metaOffen(db, 10, [id2]).map((o) => o.rel_path)).toEqual(['a.jpg', 'Urlaub/b.jpg'])
    expect(repo.metaOffenAnzahl(db)).toBe(3)
    expect(repo.metaOffenAnzahl(db, [id])).toBe(1)
  })

  it('schreibt Grundfelder; das Datum aus den Metadaten übersteht weitere Scans', () => {
    scan(db, id, [datei('a.jpg')])
    const [o] = repo.metaOffen(db, 10)
    const felder = grundfelderAus(
      {
        'EXIF:DateTimeOriginal': '2024:07:14 18:30:05',
        'EXIF:OffsetTimeOriginal': '+02:00',
        'EXIF:Orientation': 6,
        'Composite:ImageSize': '300 200',
        'File:FileType': 'JPEG',
        'EXIF:Make': 'Testkamera'
      },
      o
    )
    expect(repo.metaSchreiben(db, [{ ...o, felder }], 5000)).toBe(1)
    expect(
      db
        .prepare(
          'SELECT width, height, orientation, format, camera_make, taken_at, taken_offset, taken_source, meta_read_at FROM images'
        )
        .get()
    ).toEqual({
      width: 200,
      height: 300,
      orientation: 6,
      format: 'jpeg',
      camera_make: 'Testkamera',
      taken_at: '2024-07-14T18:30:05',
      taken_offset: '+02:00',
      taken_source: 'exif',
      meta_read_at: 5000
    })
    expect(repo.metaOffenAnzahl(db)).toBe(0)
    // unverändert neu eingelesen: bleibt
    scan(db, id, [datei('a.jpg')])
    expect(datum('a.jpg')).toEqual({
      taken_at: '2024-07-14T18:30:05',
      taken_offset: '+02:00',
      taken_source: 'exif'
    })
    // geändert: wird neu gelesen, das EXIF-Datum bleibt bis dahin stehen
    scan(db, id, [datei('a.jpg', 222, 3000)])
    expect(repo.metaOffenAnzahl(db)).toBe(1)
    expect(datum('a.jpg')).toMatchObject({ taken_source: 'exif' })
  })

  it('verwirft ein Ergebnis, wenn sich die Datei seit dem Lesen geändert hat', () => {
    scan(db, id, [datei('a.jpg')])
    const [o] = repo.metaOffen(db, 10)
    scan(db, id, [datei('a.jpg', 999, 4000)]) // während ExifTool liest
    const felder = grundfelderAus({ 'File:FileType': 'PNG' }, o)
    expect(repo.metaSchreiben(db, [{ ...o, felder }], 5000)).toBe(0)
    expect(repo.metaOffen(db, 10)).toMatchObject([{ id: o.id, size: 999, mtime: 4000 }])
  })

  it('nicht lesbare Datei: gilt als gelesen, Datum aus der Datei', () => {
    scan(db, id, [datei('kaputt.jpg')])
    const [o] = repo.metaOffen(db, 10)
    expect(repo.metaSchreiben(db, [{ ...o, felder: grundfelderAus(null, o) }], 5000)).toBe(1)
    expect(repo.metaOffenAnzahl(db)).toBe(0)
    expect(datum('kaputt.jpg')).toMatchObject({ taken_source: 'datei-erstellt' })
  })
})

describe('Abfragen', () => {
  const zeile = (rel: string, size: number, mtime: number): GefundeneDatei => ({
    rel,
    name: rel,
    size,
    mtime,
    btime: null
  })

  /** Drei vorhandene Dateien und eine fehlende; liefert Name → Kennung. */
  function mitDateien(): Record<string, number> {
    const da = [zeile('b.png', 300, 3000), zeile('A.jpg', 100, 2000), zeile('c.jpg', 200, 1000)]
    scan(db, id, [...da, zeile('weg.jpg', 1, 1)])
    scan(db, id, da)
    return Object.fromEntries(
      (db.prepare('SELECT name, id FROM images').all() as { name: string; id: number }[]).map(
        (r) => [r.name, r.id]
      )
    )
  }

  it('liefert Kennungen je Sortierung, ohne fehlende Dateien; „ab“ ist „auf“ rückwärts', () => {
    const k = mitDateien()
    const namen = (ids: number[]): string[] =>
      ids.map((i) => Object.keys(k).find((n) => k[n] === i) as string)
    const auf = (feld: (typeof SORT_FELDER)[number]): string[] =>
      namen(repo.kennungen(db, { feld, richtung: 'auf' }))
    expect(auf('name')).toEqual(['A.jpg', 'b.png', 'c.jpg'])
    expect(auf('groesse')).toEqual(['A.jpg', 'c.jpg', 'b.png'])
    expect(auf('geaendert')).toEqual(['c.jpg', 'A.jpg', 'b.png'])
    expect(auf('aufnahme')).toEqual(['c.jpg', 'A.jpg', 'b.png'])
    expect(auf('typ')).toEqual(['A.jpg', 'c.jpg', 'b.png'])
    for (const feld of SORT_FELDER) {
      const vor = repo.kennungen(db, { feld, richtung: 'auf' })
      expect(repo.kennungen(db, { feld, richtung: 'ab' })).toEqual([...vor].reverse())
    }
  })

  it('jede Sortierung nutzt einen Index (kein Umsortieren im Speicher)', () => {
    mitDateien()
    for (const feld of SORT_FELDER) {
      for (const richtung of ['auf', 'ab'] as const) {
        const plan = (
          db
            .prepare(
              `EXPLAIN QUERY PLAN SELECT id FROM images WHERE status != 'fehlt' ORDER BY ${orderBy({ feld, richtung })}`
            )
            .all() as { detail: string }[]
        )
          .map((r) => r.detail)
          .join(' | ')
        expect(plan, `${feld} ${richtung}`).not.toMatch(/TEMP B-TREE/)
        expect(plan, `${feld} ${richtung}`).toMatch(/USING INDEX/)
      }
    }
  })

  it('Details in der Reihenfolge der Anfrage, ohne Pfad; unbekannte Kennungen fehlen', () => {
    const k = mitDateien()
    const d = repo.details(db, [k['c.jpg'], 9999, k['A.jpg']])
    expect(d.map((x) => x.name)).toEqual(['c.jpg', 'A.jpg'])
    expect(d[0]).toEqual({
      id: k['c.jpg'],
      folderId: id,
      name: 'c.jpg',
      ext: 'jpg',
      format: null,
      size: 200,
      mtime: 1000,
      width: null,
      height: null,
      orientation: null,
      takenAt: lokalAusMs(1000),
      takenOffset: null,
      takenSource: 'datei-geaendert',
      cameraMake: null,
      cameraModel: null,
      status: 'ok',
      metaRead: false,
      color: null
    })
    expect(JSON.stringify(d)).not.toMatch(/Bilder/)
    expect(repo.details(db, [])).toEqual([])
    expect(() =>
      repo.details(
        db,
        Array.from({ length: 1001 }, (_, i) => i)
      )
    ).toThrow(/Höchstens/)
  })
})

describe('Vorschaubilder im Index', () => {
  const zustand = (): Record<string, { thumb_state: string | null; status: string }> =>
    Object.fromEntries(
      (
        db.prepare('SELECT name, thumb_state, status FROM images ORDER BY name').all() as {
          name: string
          thumb_state: string | null
          status: string
        }[]
      ).map(({ name, ...r }) => [name, r])
    )

  it('Warteschlange: offene Dateien nach der Kennung, ohne „privat“, fehlende und ausgeschlossene', () => {
    const privat = repo.ordnerAnlegen(db, 'E:\\Privat', true, 1)
    const stick = repo.ordnerAnlegen(db, 'F:\\Stick', true, 1)
    scan(db, id, [datei('a.jpg'), datei('b.jpg'), datei('weg.jpg')])
    scan(db, id, [datei('a.jpg'), datei('b.jpg')]) // weg.jpg fehlt
    scan(db, privat, [datei('p.jpg')])
    scan(db, stick, [datei('s.jpg')])
    repo.modusSetzen(db, privat, 'privat')
    const offen = repo.vorschauOffen(db, 10)
    expect(offen.map((z) => [z.ordner, z.rel_path, z.mode])).toEqual([
      ['D:\\Bilder', 'a.jpg', 'normal'],
      ['D:\\Bilder', 'b.jpg', 'normal'],
      ['F:\\Stick', 's.jpg', 'normal']
    ])
    expect(repo.vorschauOffen(db, 10, offen[0].id).map((z) => z.rel_path)).toEqual([
      'b.jpg',
      's.jpg'
    ])
    expect(repo.vorschauOffen(db, 10, 0, [stick]).map((z) => z.rel_path)).toEqual([
      'a.jpg',
      'b.jpg'
    ])
    expect(repo.vorschauOffenAnzahl(db)).toBe(3)
    expect(repo.vorschauOffenAnzahl(db, [stick])).toBe(2)
    // auf Abruf auch „privat“, nie fehlende
    const alle = (db.prepare('SELECT id FROM images ORDER BY id').pluck().all() as number[]).slice()
    expect(
      repo
        .vorschauZeilen(db, alle)
        .map((z) => z.rel_path)
        .sort()
    ).toEqual(['a.jpg', 'b.jpg', 'p.jpg', 's.jpg'])
  })

  it('Ergebnisse eintragen: ok mit Farbe, defekt setzt den Status; geänderte Datei bleibt offen', () => {
    scan(db, id, [datei('a.jpg'), datei('kaputt.jpg'), datei('neu.jpg')])
    const [a, kaputt, neu] = repo.vorschauOffen(db, 10)
    scan(db, id, [datei('a.jpg'), datei('kaputt.jpg'), datei('neu.jpg', 555)]) // neu geändert
    const geschrieben = repo.vorschauSchreiben(db, [
      { ...a, zustand: 'ok', farbe: '#112233' },
      { ...kaputt, zustand: 'defekt', farbe: null },
      { ...neu, zustand: 'ok', farbe: '#445566' }
    ])
    expect([...geschrieben].sort()).toEqual([a.id, kaputt.id].sort())
    expect(zustand()).toEqual({
      'a.jpg': { thumb_state: 'ok', status: 'ok' },
      'kaputt.jpg': { thumb_state: 'defekt', status: 'defekt' },
      'neu.jpg': { thumb_state: null, status: 'ok' }
    })
    expect(repo.details(db, [a.id])[0].color).toBe('#112233')
    // geänderte Datei: Vorschaubild wieder offen, Farbe bleibt bis dahin als Platzhalter
    scan(db, id, [datei('a.jpg', 777), datei('kaputt.jpg'), datei('neu.jpg', 555)])
    expect(zustand()['a.jpg'].thumb_state).toBeNull()
    expect(repo.details(db, [a.id])[0].color).toBe('#112233')
    // „defekt“ bleibt, solange die Datei gleich bleibt
    expect(zustand()['kaputt.jpg']).toEqual({ thumb_state: 'defekt', status: 'defekt' })
  })

  it('Ordner: Kennungen für das Löschen, Zurücksetzen nur der fertigen', () => {
    scan(db, id, [datei('a.jpg'), datei('b.jpg')])
    const [a, b] = repo.vorschauOffen(db, 10)
    repo.vorschauSchreiben(db, [
      { ...a, zustand: 'ok', farbe: null },
      { ...b, zustand: 'defekt', farbe: null }
    ])
    expect(repo.ordnerKennungen(db, id)).toEqual([a.id, b.id])
    repo.vorschauZuruecksetzen(db, id)
    expect(zustand()).toEqual({
      'a.jpg': { thumb_state: null, status: 'ok' },
      'b.jpg': { thumb_state: 'defekt', status: 'defekt' }
    })
  })

  it('Warteschlange nutzt den Teilindex', () => {
    const plan = (
      db
        .prepare(
          `EXPLAIN QUERY PLAN SELECT i.id FROM images i JOIN folders f ON f.id = i.folder_id
            WHERE i.thumb_state IS NULL AND i.status != 'fehlt' AND f.mode != 'privat'
              AND i.id > 0 ORDER BY i.id LIMIT 6`
        )
        .all() as { detail: string }[]
    )
      .map((r) => r.detail)
      .join(' | ')
    expect(plan).toMatch(/images_thumb_offen/)
    expect(plan).not.toMatch(/TEMP B-TREE/)
  })
})

describe('Ordner-Filter, Ordnerbaum, Summen (1.4)', () => {
  function bibliothek(): { zweiter: number; name: (id: number) => string } {
    const zweiter = repo.ordnerAnlegen(db, 'E:\\Zweiter', true, 1)
    scan(db, id, [
      datei('a.jpg', 10),
      datei('Urlaub/b.jpg', 20),
      datei('Urlaub/2024/c.jpg', 30),
      datei('Urlaub 2/d.jpg', 40),
      datei('Urlaub-x/e.jpg', 50),
      datei('urlaubx/f.jpg', 60)
    ])
    scan(db, zweiter, [datei('Urlaub/z.jpg', 70)])
    const namen = new Map(
      (
        db.prepare('SELECT id, rel_path FROM images').all() as { id: number; rel_path: string }[]
      ).map((r) => [r.id, r.rel_path])
    )
    return { zweiter, name: (i) => namen.get(i) as string }
  }
  const nachName = { feld: 'name', richtung: 'auf' } as const

  it('Filter: ganzer Ordner; Unterordner samt allem darunter, ohne Groß/Klein, ohne Geschwister', () => {
    const { zweiter, name } = bibliothek()
    expect(repo.kennungen(db, nachName, { ordner: zweiter, pfad: '' }).map(name)).toEqual([
      'Urlaub/z.jpg'
    ])
    expect(repo.kennungen(db, nachName, { ordner: id, pfad: '' })).toHaveLength(6)
    expect(
      repo.kennungen(db, nachName, { ordner: id, pfad: 'urlaub' }, true).map(name).sort()
    ).toEqual(['Urlaub/2024/c.jpg', 'Urlaub/b.jpg'])
    expect(
      repo.kennungen(db, nachName, { ordner: id, pfad: 'Urlaub/2024' }, true).map(name)
    ).toEqual(['Urlaub/2024/c.jpg'])
    expect(repo.kennungen(db, nachName, { ordner: id, pfad: 'gibts-nicht' }, true)).toEqual([])
    // ohne Filter alles, absteigend genau rückwärts auch mit Filter
    expect(repo.kennungen(db, nachName)).toHaveLength(7)
    const auf = repo.kennungen(db, nachName, { ordner: id, pfad: 'Urlaub' }, true)
    expect(
      repo.kennungen(db, { feld: 'name', richtung: 'ab' }, { ordner: id, pfad: 'Urlaub' }, true)
    ).toEqual([...auf].reverse())
  })

  it('Verzeichnisse mit Anzahl je Ordner (direkte Dateien; fehlende zählen nicht)', () => {
    const { zweiter } = bibliothek()
    scan(db, zweiter, []) // z.jpg fehlt jetzt
    expect(repo.verzeichnisse(db)).toEqual([
      { folder_id: id, pfad: '', anzahl: 1 },
      { folder_id: id, pfad: 'Urlaub', anzahl: 1 },
      { folder_id: id, pfad: 'Urlaub 2', anzahl: 1 },
      { folder_id: id, pfad: 'Urlaub-x', anzahl: 1 },
      { folder_id: id, pfad: 'Urlaub/2024', anzahl: 1 },
      { folder_id: id, pfad: 'urlaubx', anzahl: 1 }
    ])
  })

  it('Größensumme einer Auswahl; unbekannte Kennungen zählen nicht', () => {
    bibliothek()
    const alle = repo.kennungen(db, nachName)
    expect(repo.groesseSumme(db, alle)).toBe(10 + 20 + 30 + 40 + 50 + 60 + 70)
    expect(repo.groesseSumme(db, [...alle.slice(0, 1), 99999])).toBeGreaterThan(0)
    expect(repo.groesseSumme(db, [])).toBe(0)
  })

  it('offene Vorschaubilder im Ausschnitt in dessen Reihenfolge, ohne fertige', () => {
    bibliothek()
    const alle = repo.kennungen(db, nachName)
    const [erste] = repo.vorschauOffen(db, 1)
    repo.vorschauSchreiben(db, [{ ...erste, zustand: 'ok', farbe: null }])
    const ausschnitt = [...alle].reverse()
    expect(repo.vorschauOffenUnter(db, ausschnitt).map((z) => z.id)).toEqual(
      ausschnitt.filter((i) => i !== erste.id)
    )
  })
})
