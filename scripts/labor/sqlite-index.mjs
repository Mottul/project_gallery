// Labor (Skill bild-labor, bibliothek-index): Index mit better-sqlite3 messen – 50.000 Zeilen in
// Stapeln einfügen (wie lange blockiert der main je Stapel?), Sortier- und Filterabfragen,
// Volltextsuche, Öffnen nach einem Neustart. Schema nach docs/PLAN.md („Index (Skizze)“).
// Läuft unter Electrons Node (ELECTRON_RUN_AS_NODE), wie später im main.
//
// Aufruf: node scripts/labor/sqlite-index.mjs [--zeilen 50000]
// Ergebnis: Konsole und JSON in <tmp>/galeria-labor-sqlite.json.

import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)

const SCHEMA = `
CREATE TABLE folders (id INTEGER PRIMARY KEY, path TEXT UNIQUE NOT NULL, mode TEXT NOT NULL DEFAULT 'normal');
CREATE TABLE images (
  id INTEGER PRIMARY KEY, folder_id INTEGER NOT NULL, rel_path TEXT NOT NULL, name TEXT NOT NULL,
  name_sort TEXT NOT NULL, ext TEXT, kind TEXT NOT NULL, size INTEGER, mtime INTEGER, btime INTEGER,
  width INTEGER, height INTEGER, orientation INTEGER, duration_ms INTEGER,
  taken_at TEXT, taken_offset TEXT, taken_source TEXT,
  gps_lat REAL, gps_lon REAL, place_sort TEXT, camera_model TEXT, lens TEXT,
  rating INTEGER, title TEXT, description TEXT, meta_json TEXT, status TEXT NOT NULL DEFAULT 'ok',
  UNIQUE (folder_id, rel_path)
);
CREATE INDEX images_taken ON images (taken_at, id);
CREATE INDEX images_name ON images (name_sort, id);
CREATE INDEX images_place ON images (place_sort, taken_at, id);
CREATE INDEX images_rating ON images (rating, taken_at, id);
CREATE INDEX images_camera ON images (camera_model, taken_at, id);
CREATE TABLE keywords (image_id INTEGER NOT NULL, keyword TEXT NOT NULL);
CREATE INDEX keywords_kw ON keywords (keyword, image_id);
CREATE VIRTUAL TABLE images_fts USING fts5 (name, title, description, keywords, place, tokenize = 'unicode61 remove_diacritics 2');
`

const ORTE = [
  'Dubrovnik · Kroatien',
  'München · Deutschland',
  'Paris · Frankreich',
  'Paris · Vereinigte Staaten',
  'Wien · Österreich',
  'Zürich · Schweiz',
  'Ålesund · Norwegen',
  'Krakau · Polen'
]
const KAMERAS = ['Testkamera A', 'Testkamera B', 'Handy C', 'Kompakt D']
const STICHWOERTER = [
  'Urlaub',
  'Familie',
  'Meer',
  'Berge',
  'Weihnachten',
  'Geburtstag',
  'Café',
  'Ärger'
]

/** Deterministischer Zufall: gleiche Daten in jedem Lauf. */
function zufall(seed) {
  let s = seed >>> 0
  return () => (s = (Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x9e3779b9) >>> 0) / 2 ** 32
}

function zeile(i, r) {
  const t = new Date(Date.UTC(2016, 0, 1) + Math.floor(r() * 10 * 365 * 86_400_000))
  const ohneDatum = r() < 0.03
  const ohneOrt = r() < 0.2
  const name = `IMG_${String(i).padStart(5, '0')}.jpg`
  return {
    folder_id: 1 + (i % 20),
    rel_path: `${2016 + (i % 10)}/${String(1 + (i % 12)).padStart(2, '0')}/${name}`,
    name,
    name_sort: name.toLowerCase(),
    ext: 'jpg',
    kind: i % 50 === 0 ? 'video' : 'bild',
    size: 3_000_000 + Math.floor(r() * 5_000_000),
    mtime: t.getTime(),
    width: 6000,
    height: 4000,
    taken_at: ohneDatum ? null : t.toISOString().slice(0, 19),
    place_sort: ohneOrt ? null : ORTE[Math.floor(r() * ORTE.length)],
    camera_model: KAMERAS[Math.floor(r() * KAMERAS.length)],
    rating: Math.floor(r() * 6),
    title: r() < 0.1 ? `Titel ${i}` : null,
    keywords: STICHWOERTER.filter(() => r() < 0.15)
  }
}

function kind([datei, anzahl, stapelGroesse]) {
  const Database = require('better-sqlite3')
  const db = new Database(datei)
  db.pragma('journal_mode = WAL')
  db.pragma('synchronous = NORMAL')
  db.exec(SCHEMA)
  const insFolder = db.prepare('INSERT INTO folders (id, path) VALUES (?, ?)')
  for (let f = 1; f <= 20; f++) insFolder.run(f, `D:\\Bilder\\Ordner ${f}`)
  const ins =
    db.prepare(`INSERT INTO images (folder_id, rel_path, name, name_sort, ext, kind, size, mtime, width, height, taken_at, place_sort, camera_model, rating, title)
    VALUES (@folder_id, @rel_path, @name, @name_sort, @ext, @kind, @size, @mtime, @width, @height, @taken_at, @place_sort, @camera_model, @rating, @title)`)
  const insKw = db.prepare('INSERT INTO keywords (image_id, keyword) VALUES (?, ?)')
  const insFts = db.prepare(
    'INSERT INTO images_fts (rowid, name, title, description, keywords, place) VALUES (?, ?, ?, NULL, ?, ?)'
  )
  const stapel = db.transaction((rows) => {
    for (const z of rows) {
      const id = ins.run(z).lastInsertRowid
      for (const k of z.keywords) insKw.run(id, k)
      insFts.run(id, z.name, z.title, z.keywords.join(' '), z.place_sort)
    }
  })
  const r = zufall(42)
  const zeiten = []
  const t0 = performance.now()
  for (let i = 0; i < anzahl; i += stapelGroesse) {
    const rows = []
    for (let j = i; j < Math.min(anzahl, i + stapelGroesse); j++) rows.push(zeile(j, r))
    const s = performance.now()
    stapel(rows)
    zeiten.push(performance.now() - s)
  }
  const gesamt = performance.now() - t0
  zeiten.sort((a, b) => a - b)
  db.pragma('wal_checkpoint(TRUNCATE)')
  db.close()
  process.stdout.write(
    JSON.stringify({
      stapel: stapelGroesse,
      gesamtMs: Math.round(gesamt),
      stapelMedianMs: +zeiten[Math.floor(zeiten.length / 2)].toFixed(1),
      stapelMaxMs: +zeiten.at(-1).toFixed(1)
    })
  )
}

function abfragen([datei]) {
  const Database = require('better-sqlite3')
  let t0 = performance.now()
  const db = new Database(datei, { readonly: true })
  const offen = performance.now() - t0
  const messen = (name, sql, params = []) => {
    const st = db.prepare(sql)
    t0 = performance.now()
    const rows = st.raw().all(...params)
    const ms = performance.now() - t0
    const plan = db
      .prepare(`EXPLAIN QUERY PLAN ${sql}`)
      .all(...params)
      .map((p) => p.detail)
      .join(' | ')
    return {
      name,
      zeilen: rows.length,
      ms: +ms.toFixed(1),
      tempSortierung: /TEMP B-TREE/.test(plan),
      plan
    }
  }
  const ergebnis = [
    messen(
      'Kennungen nach Aufnahmedatum (absteigend)',
      'SELECT id FROM images ORDER BY taken_at DESC, id DESC'
    ),
    messen('Kennungen nach Name', 'SELECT id FROM images ORDER BY name_sort, id'),
    messen(
      'Kennungen nach Ort A–Z, ohne Ort am Ende',
      'SELECT id FROM images ORDER BY place_sort IS NULL, place_sort, taken_at, id'
    ),
    messen(
      'Kennungen nach Ort A–Z (Index-Reihenfolge, NULL vorn)',
      'SELECT id FROM images ORDER BY place_sort, taken_at, id'
    ),
    messen(
      'Bewertung ≥ 4 nach Datum',
      'SELECT id FROM images WHERE rating >= 4 ORDER BY taken_at DESC, id DESC'
    ),
    messen('Stichwort „Urlaub“', "SELECT image_id FROM keywords WHERE keyword = 'Urlaub'"),
    messen(
      'Volltext „cafe“ (ohne Akzent)',
      "SELECT rowid FROM images_fts WHERE images_fts MATCH 'cafe'"
    ),
    messen(
      'Anzahl je Ort (Gruppen)',
      'SELECT place_sort, count(*) FROM images GROUP BY place_sort'
    ),
    messen(
      'Details für 200 sichtbare Kacheln',
      'SELECT * FROM images WHERE id BETWEEN 25000 AND 25199'
    )
  ]
  db.close()
  process.stdout.write(JSON.stringify({ oeffnenMs: +offen.toFixed(1), abfragen: ergebnis }))
}

function lauf(modus, args) {
  const r = spawnSync(
    require('electron'),
    [fileURLToPath(import.meta.url), modus, ...args.map(String)],
    {
      encoding: 'utf8',
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      timeout: 600_000
    }
  )
  if (r.status !== 0) throw new Error(r.stderr || r.error?.message)
  return JSON.parse(r.stdout)
}

function main() {
  const argv = process.argv.slice(2)
  if (argv[0] === '--einfuegen') return kind(argv.slice(1).map((a, i) => (i ? Number(a) : a)))
  if (argv[0] === '--abfragen') return abfragen(argv.slice(1))
  const anzahl = argv.includes('--zeilen') ? Number(argv[argv.indexOf('--zeilen') + 1]) : 50_000
  const dir = mkdtempSync(join(tmpdir(), 'galeria-labor-sqlite-'))
  try {
    const ergebnis = { zeilen: anzahl, einfuegen: [] }
    console.log(
      `Einfügen von ${anzahl.toLocaleString('de')} Zeilen (mit Stichwörtern und Volltext):`
    )
    let letzte
    for (const stapel of [250, 1000, 5000]) {
      letzte = join(dir, `index-${stapel}.db`)
      const r = lauf('--einfuegen', [letzte, anzahl, stapel])
      ergebnis.einfuegen.push(r)
      console.log(
        `  Stapel ${String(stapel).padStart(4)}: gesamt ${r.gesamtMs} ms, je Stapel Median ${r.stapelMedianMs} ms, höchstens ${r.stapelMaxMs} ms`
      )
    }
    ergebnis.groesseMb = +(statSync(letzte).size / 1e6).toFixed(1)
    console.log(`  Datei: ${ergebnis.groesseMb} MB`)
    const q = lauf('--abfragen', [letzte])
    ergebnis.oeffnenMs = q.oeffnenMs
    ergebnis.abfragen = q.abfragen
    console.log(`\nÖffnen nach Neustart: ${q.oeffnenMs} ms`)
    for (const a of q.abfragen) {
      console.log(
        `  ${a.name.padEnd(55)} ${String(a.ms).padStart(6)} ms  ${String(a.zeilen).padStart(6)} Zeilen${a.tempSortierung ? '  ⚠ sortiert ohne Index' : ''}`
      )
    }
    const datei = join(tmpdir(), 'galeria-labor-sqlite.json')
    writeFileSync(datei, JSON.stringify(ergebnis, null, 2))
    console.log(`\nJSON: ${datei}`)
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
}

main()
