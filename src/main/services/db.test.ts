import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { lokalAusMs } from '@shared/dates'

vi.mock('./log', () => ({ logLine: vi.fn() }))

const { migrieren, oeffneIndex, SCHEMA_VERSION } = await import('./db')

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'galeria-db-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true, maxRetries: 5 })
})

describe('Index-Datenbank', () => {
  it('legt eine neue Datei mit aktuellem Schema an (WAL, Fremdschlüssel)', () => {
    const db = oeffneIndex(join(dir, 'galerie.db'))
    expect(db.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION)
    expect(db.pragma('journal_mode', { simple: true })).toBe('wal')
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1)
    const tabellen = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all()
      .map((r) => (r as { name: string }).name)
    expect(tabellen).toEqual(expect.arrayContaining(['folders', 'images']))
    db.close()
  })

  it('öffnet eine vorhandene Datei erneut, ohne etwas zu verlieren', () => {
    const pfad = join(dir, 'galerie.db')
    let db = oeffneIndex(pfad)
    db.prepare("INSERT INTO folders (path, path_key, added_at) VALUES ('D:\\x', 'd:/x', 1)").run()
    db.close()
    db = oeffneIndex(pfad)
    expect(db.prepare('SELECT count(*) n FROM folders').get()).toEqual({ n: 1 })
    db.close()
  })

  it('Ordner entfernen löscht seine Dateien mit (keine Reste)', () => {
    const db = oeffneIndex(join(dir, 'galerie.db'))
    const f = db
      .prepare("INSERT INTO folders (path, path_key, added_at) VALUES ('D:\\x', 'd:/x', 1)")
      .run()
    db.prepare(
      "INSERT INTO images (folder_id, rel_path, rel_key, name, name_sort, ext, size, mtime) VALUES (?, 'a.jpg', 'a.jpg', 'a.jpg', 'a.jpg', 'jpg', 1, 1)"
    ).run(f.lastInsertRowid)
    db.prepare('DELETE FROM folders WHERE id = ?').run(f.lastInsertRowid)
    expect(db.prepare('SELECT count(*) n FROM images').get()).toEqual({ n: 0 })
    db.close()
  })

  it('sichert eine defekte Datei weg und legt neu an', () => {
    const pfad = join(dir, 'galerie.db')
    writeFileSync(pfad, 'Das ist keine SQLite-Datei, sondern Text.'.repeat(100))
    const db = oeffneIndex(pfad)
    expect(db.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION)
    db.close()
    expect(readdirSync(dir).some((n) => /^galerie\.db\.defekt-\d+$/.test(n))).toBe(true)
  })

  it('lässt eine Datei einer neueren App unangetastet und meldet das', () => {
    const pfad = join(dir, 'galerie.db')
    const neu = new Database(pfad)
    neu.pragma(`user_version = ${SCHEMA_VERSION + 1}`)
    neu.close()
    expect(() => oeffneIndex(pfad)).toThrow(/neuer/)
    expect(existsSync(pfad)).toBe(true)
    expect(readdirSync(dir).some((n) => n.includes('defekt'))).toBe(false)
  })

  it('migriert Schritt für Schritt von Version 0', () => {
    const db = new Database(':memory:')
    expect(db.pragma('user_version', { simple: true })).toBe(0)
    migrieren(db)
    expect(db.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION)
    // zweimal ist harmlos
    migrieren(db)
    expect(db.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION)
    db.close()
  })

  it('Version 1 → 2: vorhandene Dateien bekommen ein vorläufiges Aufnahmedatum (ältere Dateizeit)', () => {
    const db = new Database(':memory:')
    migrieren(db, 1)
    db.prepare(
      "INSERT INTO folders (id, path, path_key, added_at) VALUES (1, 'D:\\x', 'd:/x', 1)"
    ).run()
    const ein = db.prepare(
      'INSERT INTO images (folder_id, rel_path, rel_key, name, name_sort, ext, size, mtime, btime) VALUES (1, ?, ?, ?, ?, ?, 1, ?, ?)'
    )
    const kopiert = { btime: Date.UTC(2026, 9, 20, 8), mtime: Date.UTC(2019, 5, 1, 8, 30) }
    const bearbeitet = { btime: Date.UTC(2019, 5, 1, 8, 30), mtime: Date.UTC(2026, 9, 20, 8) }
    ein.run('a.jpg', 'a.jpg', 'a.jpg', 'a.jpg', 'jpg', kopiert.mtime, kopiert.btime)
    ein.run('b.jpg', 'b.jpg', 'b.jpg', 'b.jpg', 'jpg', bearbeitet.mtime, bearbeitet.btime)
    ein.run('c.jpg', 'c.jpg', 'c.jpg', 'c.jpg', 'jpg', bearbeitet.mtime, null)
    migrieren(db)
    const rows = db
      .prepare('SELECT rel_path, taken_at, taken_source, format FROM images ORDER BY rel_path')
      .all()
    // SQLites 'localtime' muss dieselbe Ortszeit liefern wie der App-Code (dates.ts)
    const lokal = lokalAusMs
    expect(rows).toEqual([
      {
        rel_path: 'a.jpg',
        taken_at: lokal(kopiert.mtime),
        taken_source: 'datei-geaendert',
        format: null
      },
      {
        rel_path: 'b.jpg',
        taken_at: lokal(bearbeitet.btime),
        taken_source: 'datei-erstellt',
        format: null
      },
      {
        rel_path: 'c.jpg',
        taken_at: lokal(bearbeitet.mtime),
        taken_source: 'datei-geaendert',
        format: null
      }
    ])
    db.close()
  })

  it('Version 6 → 7: gespeicherte Ansichten gehen mit ihrem Ordner', () => {
    const db = new Database(':memory:')
    db.pragma('foreign_keys = ON')
    migrieren(db, 6)
    db.prepare(
      "INSERT INTO folders (id, path, path_key, added_at) VALUES (1, 'D:/x', 'd:/x', 1)"
    ).run()
    migrieren(db)
    const neu = db.prepare(
      "INSERT INTO ansichten (name, name_key, folder_id, stand) VALUES (?, ?, ?, '{}')"
    )
    neu.run('Ordner', 'ordner', 1)
    neu.run('Alle', 'alle', null)
    expect(() => neu.run('ORDNER', 'ordner', null)).toThrow(/UNIQUE/)
    db.prepare('DELETE FROM folders WHERE id = 1').run()
    expect(db.prepare('SELECT name FROM ansichten').pluck().all()).toEqual(['Alle'])
    db.close()
  })

  it('Version 5 → 6: Suchindex aus den vorhandenen Zeilen, danach von Triggern aktuell', () => {
    const db = new Database(':memory:')
    migrieren(db, 5)
    db.prepare(
      "INSERT INTO folders (id, path, path_key, added_at) VALUES (1, 'D:/x', 'd:/x', 1)"
    ).run()
    db.prepare(
      `INSERT INTO images (id, folder_id, rel_path, rel_key, name, name_sort, ext, size, mtime,
         title, description, place_name, place_country)
       VALUES (7, 1, 'a.jpg', 'a.jpg', 'a.jpg', 'a.jpg', 'jpg', 1, 1, 'Altstadt', 'Mauer',
         'Dubrovnik', 'Kroatien')`
    ).run()
    db.prepare("INSERT INTO keywords (image_id, keyword) VALUES (7, 'Urlaub')").run()
    db.prepare("INSERT INTO keywords (image_id, keyword) VALUES (7, 'Sonne')").run()
    migrieren(db)
    const treffer = (q: string): unknown[] =>
      db.prepare('SELECT rowid FROM images_fts WHERE images_fts MATCH ?').pluck().all(q)
    for (const q of ['altstadt', 'mauer', 'urlaub', 'sonne', 'dubrovnik', 'kroatien', 'a']) {
      expect(treffer(q), q).toEqual([7])
    }
    expect(treffer('nichts')).toEqual([])
    // ein neues Bild kommt über den Trigger hinein
    db.prepare(
      "INSERT INTO images (id, folder_id, rel_path, rel_key, name, name_sort, ext, size, mtime) VALUES (8, 1, 'b.jpg', 'b.jpg', 'Hafen.jpg', 'hafen', 'jpg', 1, 1)"
    ).run()
    expect(treffer('hafen')).toEqual([8])
    db.close()
  })

  it('Version 4 → 5: alles wird nachgelesen (Ort-Feld), Ort-Spalten, kv, Indizes je Richtung', () => {
    const db = new Database(':memory:')
    migrieren(db, 4)
    db.prepare(
      "INSERT INTO folders (id, path, path_key, added_at) VALUES (1, 'D:/x', 'd:/x', 1)"
    ).run()
    db.prepare(
      "INSERT INTO images (folder_id, rel_path, rel_key, name, name_sort, ext, size, mtime, meta_read_at) VALUES (1, 'a.jpg', 'a.jpg', 'a.jpg', 'a.jpg', 'jpg', 1, 1, 5)"
    ).run()
    migrieren(db)
    expect(
      db.prepare('SELECT meta_read_at, place_name, place_source, place_missing FROM images').get()
    ).toEqual({ meta_read_at: null, place_name: null, place_source: null, place_missing: 1 })
    db.prepare("INSERT INTO kv (key, value) VALUES ('orte_stand', 'x')").run()
    const indizes = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'images_ort%'")
      .pluck()
      .all()
    expect(indizes.sort()).toEqual(['images_ort', 'images_ort_ab'])
    db.close()
  })

  it('Version 3 → 4: alles wird nachgelesen; Fehlende zählen ab jetzt; Stichwörter-Tabelle', () => {
    const db = new Database(':memory:')
    migrieren(db, 3)
    db.prepare(
      "INSERT INTO folders (id, path, path_key, added_at) VALUES (1, 'D:/x', 'd:/x', 1)"
    ).run()
    const ein = db.prepare(
      "INSERT INTO images (folder_id, rel_path, rel_key, name, name_sort, ext, size, mtime, meta_read_at, status) VALUES (1, ?, ?, ?, ?, 'jpg', 1, 1, 5, ?)"
    )
    ein.run('a.jpg', 'a.jpg', 'a.jpg', 'a.jpg', 'ok')
    ein.run('b.jpg', 'b.jpg', 'b.jpg', 'b.jpg', 'fehlt')
    const vorher = Date.now() - 1000
    migrieren(db)
    const rows = db
      .prepare('SELECT name, meta_read_at, missing_since FROM images ORDER BY name')
      .all() as { name: string; meta_read_at: number | null; missing_since: number | null }[]
    expect(rows[0]).toEqual({ name: 'a.jpg', meta_read_at: null, missing_since: null })
    // fehlende werden nicht nachgelesen
    expect(rows[1].meta_read_at).toBe(5)
    expect(rows[1].missing_since).toBeGreaterThanOrEqual(vorher)
    db.prepare("INSERT INTO keywords (image_id, keyword) VALUES (1, 'Urlaub')").run()
    db.prepare('DELETE FROM images WHERE id = 1').run()
    expect(db.prepare('SELECT count(*) FROM keywords').pluck().get()).toBe(0)
    db.close()
  })

  it('Version 2 → 3: alle Dateien warten auf ihr Vorschaubild, Farbe leer', () => {
    const db = new Database(':memory:')
    migrieren(db, 2)
    db.prepare(
      "INSERT INTO folders (id, path, path_key, added_at) VALUES (1, 'D:/x', 'd:/x', 1)"
    ).run()
    db.prepare(
      "INSERT INTO images (folder_id, rel_path, rel_key, name, name_sort, ext, size, mtime, thumb_state) VALUES (1, 'a.jpg', 'a.jpg', 'a.jpg', 'a.jpg', 'jpg', 1, 1, 'irgendwas')"
    ).run()
    migrieren(db)
    expect(db.prepare('SELECT thumb_state, color FROM images').get()).toEqual({
      thumb_state: null,
      color: null
    })
    const plan = db
      .prepare('EXPLAIN QUERY PLAN SELECT id FROM images WHERE thumb_state IS NULL ORDER BY id')
      .all() as { detail: string }[]
    expect(plan.map((r) => r.detail).join(' ')).toMatch(/images_thumb_offen/)
    db.close()
  })
})
