// Index-Datenbank (SQLite über better-sqlite3) – Muster aus der Mottulbox
// (project_mega/src/main/services/db.ts): WAL, eine defekte Datei wird samt WAL/SHM weggesichert
// und neu angelegt. Neu: versionierte Migrationen über PRAGMA user_version (Skill
// bibliothek-index, „Migrationen“). Nur main schreibt (ein Schreiber, better-sqlite3 ist synchron).
//
// Der Index ist eine Kopie dessen, was in den Dateien steht – er lässt sich jederzeit neu aufbauen.
// Er liegt lokal (lokaleDaten.ts), nicht im Roaming-Profil (Schicht D).

import Database from 'better-sqlite3'
import { existsSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { logLine } from './log'

export type DB = Database.Database

/**
 * Migrationen in Reihenfolge; Index + 1 = Schema-Version. Nie eine bestehende ändern – nur neue
 * anhängen (mit Test „alte DB → neue DB“). Spalten aus den Metadaten sind schon da und bleiben
 * NULL, bis 1.2/Phase 2 sie füllen.
 */
const MIGRATIONEN: readonly string[] = [
  // 1 – Phase 1.1: Ordner und Dateien
  `
  CREATE TABLE folders (
    id         INTEGER PRIMARY KEY,
    path       TEXT NOT NULL,                 -- wie gewählt (Anzeige)
    path_key   TEXT NOT NULL UNIQUE,          -- Vergleichsschlüssel (ordnerPruefen.pfadSchluessel)
    mode       TEXT NOT NULL DEFAULT 'normal' CHECK (mode IN ('normal', 'nur-lesen', 'privat')),
    added_at   INTEGER NOT NULL,
    last_scan  INTEGER,                       -- Ende des letzten vollständigen Scans (ms)
    scan_seq   INTEGER NOT NULL DEFAULT 0,    -- Nummer des laufenden/letzten Scans
    unreadable INTEGER NOT NULL DEFAULT 0     -- beim letzten Scan nicht lesbare Pfade
  );
  CREATE TABLE images (
    id            INTEGER PRIMARY KEY,
    folder_id     INTEGER NOT NULL REFERENCES folders (id) ON DELETE CASCADE,
    rel_path      TEXT NOT NULL,              -- relativ zum Ordner, „/“ als Trenner
    rel_key       TEXT NOT NULL,              -- Vergleichsschlüssel (Windows: ohne Groß/Klein)
    name          TEXT NOT NULL,
    name_sort     TEXT NOT NULL,              -- sortKey.nameSortKey
    ext           TEXT NOT NULL,
    kind          TEXT NOT NULL DEFAULT 'bild' CHECK (kind IN ('bild', 'video', 'raw')),
    size          INTEGER NOT NULL,
    mtime         INTEGER NOT NULL,           -- Änderungszeit (ms)
    btime         INTEGER,                    -- Erstellzeit (ms)
    width INTEGER, height INTEGER, orientation INTEGER, duration_ms INTEGER,
    taken_at TEXT, taken_offset TEXT, taken_source TEXT,
    gps_lat REAL, gps_lon REAL, place_id INTEGER, place_sort TEXT,
    place_missing INTEGER NOT NULL DEFAULT 1,
    camera_make TEXT, camera_model TEXT, lens TEXT,
    iso INTEGER, aperture REAL, exposure REAL, focal REAL,
    rating INTEGER, color_label TEXT, title TEXT, description TEXT,
    thumb_state TEXT, meta_json TEXT, meta_read_at INTEGER,
    status        TEXT NOT NULL DEFAULT 'ok' CHECK (status IN ('ok', 'fehlt', 'defekt')),
    seen_scan     INTEGER NOT NULL DEFAULT 0, -- Scan, der die Datei zuletzt gesehen hat
    UNIQUE (folder_id, rel_key)
  );
  CREATE INDEX images_name ON images (name_sort, id);
  CREATE INDEX images_mtime ON images (mtime, id);
  CREATE INDEX images_size ON images (size, id);
  CREATE INDEX images_folder_seen ON images (folder_id, seen_scan);
  `
]

export const SCHEMA_VERSION = MIGRATIONEN.length

/** Fehlende Migrationen ausführen – jede in einer Transaktion zusammen mit der neuen Version. */
export function migrieren(db: DB): void {
  const ist = db.pragma('user_version', { simple: true }) as number
  if (ist > SCHEMA_VERSION) {
    // eine neuere App hat die Datei angelegt – nicht anfassen, sonst gehen Daten verloren
    throw new Error(`Index ist neuer (Version ${ist}) als diese App (${SCHEMA_VERSION})`)
  }
  for (let v = ist; v < SCHEMA_VERSION; v++) {
    db.transaction(() => {
      db.exec(MIGRATIONEN[v])
      db.pragma(`user_version = ${v + 1}`)
    })()
  }
}

function oeffnen(pfad: string): DB {
  const db = new Database(pfad)
  try {
    db.pragma('journal_mode = WAL')
    db.pragma('synchronous = NORMAL')
    db.pragma('foreign_keys = ON')
    migrieren(db)
    return db
  } catch (err) {
    db.close()
    throw err
  }
}

/**
 * Öffnet die Index-Datei und migriert sie. Ist sie defekt (Stromausfall, fremde Datei), wird sie
 * samt WAL/SHM weggesichert und neu angelegt – der Index lässt sich aus den Dateien neu aufbauen.
 * Eine NEUERE Datei (Downgrade der App) wird nicht weggesichert, sondern gemeldet.
 */
export function oeffneIndex(pfad: string): DB {
  try {
    return oeffnen(pfad)
  } catch (err) {
    const meldung = err instanceof Error ? err.message : String(err)
    if (/ist neuer/.test(meldung)) throw err
    logLine('[db] Index defekt – sichere und lege neu an:', meldung)
    const ts = Date.now()
    for (const ext of ['', '-wal', '-shm']) {
      try {
        if (existsSync(pfad + ext)) renameSync(pfad + ext, `${pfad}${ext}.defekt-${ts}`)
      } catch (e2) {
        logLine('[db] Sichern der defekten Datei fehlgeschlagen:', ext || 'db', String(e2))
      }
    }
    return oeffnen(pfad)
  }
}

let db: DB | null = null

/** Der Index der App (einmal geöffnet, unter dem lokalen Datenordner). */
export function getDb(ordner: string): DB {
  if (!db) db = oeffneIndex(join(ordner, 'galerie.db'))
  return db
}

/** Beim Beenden: WAL zurückschreiben und schließen. */
export function schliesseDb(): void {
  if (!db) return
  try {
    db.pragma('wal_checkpoint(TRUNCATE)')
    db.close()
  } catch (err) {
    logLine('[db] Schließen fehlgeschlagen:', String(err))
  }
  db = null
}
