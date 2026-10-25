import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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
})
