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
  `,
  // 2 – Phase 1.2: Grundfelder und Sortieren. Format nach Inhalt (kann von der Endung abweichen);
  // vorläufiges Aufnahmedatum aus den Dateizeiten (die ältere – dates.ts), bis ExifTool gelesen
  // hat – so ist taken_at nie leer und „nach Datum“ sortiert ohne Sonderfall; Indizes für die
  // Sortierungen, Teilindex für die Warteschlange „Metadaten noch nicht gelesen“.
  `
  ALTER TABLE images ADD COLUMN format TEXT;
  UPDATE images SET
    taken_at = strftime('%Y-%m-%dT%H:%M:%S',
      (CASE WHEN btime > 0 AND btime < mtime THEN btime ELSE mtime END) / 1000.0,
      'unixepoch', 'localtime'),
    taken_offset = NULL,
    taken_source = CASE WHEN btime > 0 AND btime < mtime THEN 'datei-erstellt' ELSE 'datei-geaendert' END
  WHERE taken_at IS NULL;
  CREATE INDEX images_taken ON images (taken_at, id);
  CREATE INDEX images_typ ON images (ext, name_sort, id);
  CREATE INDEX images_meta_offen ON images (id) WHERE meta_read_at IS NULL;
  `,
  // 3 – Phase 1.3: Vorschaubilder. thumb_state: NULL = offen, 'ok' = beide Stufen im Cache,
  // sonst ein Grund, es nicht wieder zu versuchen, bis sich die Datei ändert ('defekt',
  // 'zu-gross', 'abgelehnt', 'kein-werkzeug'). color = Durchschnittsfarbe für den Platzhalter.
  // Teilindex für die Warteschlange; alle als offen vormerken (bisher gab es keine Vorschaubilder).
  `
  ALTER TABLE images ADD COLUMN color TEXT;
  UPDATE images SET thumb_state = NULL;
  CREATE INDEX images_thumb_offen ON images (id) WHERE thumb_state IS NULL;
  `,
  // 4 – Phase 2.1: alle Metadaten. Höhe zum Standort, Stichwörter als eigene Tabelle (für Filter
  // und Gruppen, 2.3/2.4), missing_since = seit wann eine Datei fehlt (nach 30 Tagen fällt sie
  // samt Vorschaubildern weg; vorhandene fehlende zählen ab jetzt). Alle vorhandenen Dateien zum
  // Nachlesen vormerken – die neuen Felder kommen im Hintergrund dazu.
  `
  ALTER TABLE images ADD COLUMN gps_alt REAL;
  ALTER TABLE images ADD COLUMN missing_since INTEGER;
  CREATE TABLE keywords (
    image_id INTEGER NOT NULL REFERENCES images (id) ON DELETE CASCADE,
    keyword  TEXT NOT NULL,
    PRIMARY KEY (image_id, keyword)
  ) WITHOUT ROWID;
  CREATE INDEX keywords_keyword ON keywords (keyword);
  UPDATE images SET missing_since = CAST(strftime('%s', 'now') AS INTEGER) * 1000
   WHERE status = 'fehlt';
  CREATE INDEX images_fehlt ON images (missing_since) WHERE status = 'fehlt';
  UPDATE images SET meta_read_at = NULL WHERE status != 'fehlt';
  `,
  // 5 – Phase 2.2: Orte. Name und Land (Anzeige), Quelle ('metadaten' = Ort-Feld der Datei,
  // 'gps' = nächster Ort aus den Ortsdaten); place_sort/place_missing gab es schon. Je Richtung
  // ein Index: „ohne Ort“ steht in beiden am Ende, absteigend nur die Orte umgekehrt. kv merkt
  // sich den Stand der Ortsdaten (neue Daten = Orte neu bestimmen). Alles nachlesen (Ort-Feld).
  `
  ALTER TABLE images ADD COLUMN place_name TEXT;
  ALTER TABLE images ADD COLUMN place_country TEXT;
  ALTER TABLE images ADD COLUMN place_source TEXT;
  CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT) WITHOUT ROWID;
  CREATE INDEX images_ort ON images (place_missing, place_sort, taken_at, id);
  CREATE INDEX images_ort_ab ON images (place_missing, place_sort DESC, taken_at DESC, id DESC);
  UPDATE images SET meta_read_at = NULL WHERE status != 'fehlt';
  `
]

export const SCHEMA_VERSION = MIGRATIONEN.length

/** Fehlende Migrationen ausführen – jede in einer Transaktion zusammen mit der neuen Version. */
export function migrieren(db: DB, bis = SCHEMA_VERSION): void {
  const ist = db.pragma('user_version', { simple: true }) as number
  if (ist > SCHEMA_VERSION) {
    // eine neuere App hat die Datei angelegt – nicht anfassen, sonst gehen Daten verloren
    throw new Error(`Index ist neuer (Version ${ist}) als diese App (${SCHEMA_VERSION})`)
  }
  // `bis` nur für Tests („alte DB → neue DB“)
  for (let v = ist; v < Math.min(bis, SCHEMA_VERSION); v++) {
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
