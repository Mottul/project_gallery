// Zugriffe der Bibliothek auf den Index – nur SQL, ohne Electron; getestet in repo.test.ts mit
// echter better-sqlite3. Aufrufer ist library.ts (main, einziger Schreiber).
//
// Abgleich statt Neuaufbau (Skill bibliothek-index): Jeder Scan bekommt eine Nummer (scan_seq).
// Jede gefundene Datei wird mit dieser Nummer eingetragen bzw. aktualisiert; was am Ende eines
// VOLLSTÄNDIGEN Scans eine ältere Nummer trägt, fehlt – außer es liegt unter einem Pfad, den der
// Scan nicht lesen konnte (dann ist es nur gerade nicht erreichbar). Ein abgebrochener Scan
// markiert nichts. Ein Teil-Scan (nach dem Überwachen) bekommt ebenso eine Nummer; abgeglichen
// wird dann nur unter den gemeldeten Pfaden. Verschobene und umbenannte Dateien erkennt der
// Abschluss beider (gleiche Endung, Größe und Änderungszeit, eindeutig): Die alte Zeile übernimmt
// den neuen Pfad und behält Kennung, Metadaten und Vorschaubild.

import {
  farblabelText,
  filterAktiv,
  filterBedingung,
  type BildFilter,
  type Facetten,
  type FilterWert
} from '@shared/bildFilter'
import { dateiDatum } from '@shared/dates'
import {
  ANSICHTEN_MAX,
  nameSchluessel,
  pruefeAnsichtStand,
  type AnsichtSpeichernErgebnis,
  type AnsichtStand,
  type GespeicherteAnsicht
} from '@shared/gespeicherteAnsicht'
import type { Grundfelder } from '@shared/grundfelder'
import { pfadSchluessel } from '@shared/ordnerPruefen'
import { unterUnlesbarem } from '@shared/scanRegeln'
import { orderBy, unterordnerBereich, type OrdnerFilter, type Sortierung } from '@shared/sortFilter'
import {
  gruppenAus,
  gruppenAusdruck,
  gruppenTitel,
  type Gruppe,
  type GruppenArt,
  type ZeitStufe
} from '@shared/gruppen'
import { nameSortKey } from '@shared/sortKey'
import type { FolderMode, ImageInfo } from '@shared/types'
import type { DB } from '../db'

/** Was der Scan je Datei liefert (bilddienst/scan.ts). */
export interface GefundeneDatei {
  /** relativ zum Ordner, „/“ als Trenner */
  rel: string
  name: string
  size: number
  /** Änderungszeit in ms (ganzzahlig) */
  mtime: number
  /** Erstellzeit in ms oder null */
  btime: number | null
}

export interface OrdnerZeile {
  id: number
  path: string
  path_key: string
  mode: FolderMode
  added_at: number
  last_scan: number | null
  scan_seq: number
  unreadable: number
}

export function ordnerListe(db: DB): OrdnerZeile[] {
  return db.prepare('SELECT * FROM folders ORDER BY path_key').all() as OrdnerZeile[]
}

export function ordnerHolen(db: DB, id: number): OrdnerZeile | undefined {
  return db.prepare('SELECT * FROM folders WHERE id = ?').get(id) as OrdnerZeile | undefined
}

/** Vorhandene und fehlende Dateien je Ordner. */
export function zaehlen(db: DB): Map<number, { count: number; missing: number }> {
  const rows = db
    .prepare(
      `SELECT folder_id,
              sum(status != 'fehlt') AS count,
              sum(status = 'fehlt')  AS missing
         FROM images GROUP BY folder_id`
    )
    .all() as { folder_id: number; count: number; missing: number }[]
  return new Map(rows.map((r) => [r.folder_id, { count: r.count, missing: r.missing }]))
}

export function ordnerAnlegen(db: DB, pfad: string, windows: boolean, jetzt: number): number {
  const r = db
    .prepare('INSERT INTO folders (path, path_key, added_at) VALUES (?, ?, ?)')
    .run(pfad, pfadSchluessel(pfad, windows), jetzt)
  return Number(r.lastInsertRowid)
}

/** Ordner samt aller Index-Zeilen entfernen (ON DELETE CASCADE). */
export function ordnerEntfernen(db: DB, id: number): boolean {
  return db.prepare('DELETE FROM folders WHERE id = ?').run(id).changes > 0
}

export function modusSetzen(db: DB, id: number, mode: FolderMode): boolean {
  return db.prepare('UPDATE folders SET mode = ? WHERE id = ?').run(mode, id).changes > 0
}

/** Neuen Scan beginnen: liefert seine Nummer. */
export function scanBeginnen(db: DB, id: number): number {
  const r = db
    .prepare('UPDATE folders SET scan_seq = scan_seq + 1 WHERE id = ? RETURNING scan_seq')
    .get(id) as { scan_seq: number } | undefined
  if (!r) throw new Error(`Ordner ${id} gibt es nicht`)
  return r.scan_seq
}

/**
 * Einen Stapel gefundener Dateien eintragen – in EINER Transaktion. Neue Dateien kommen hinzu;
 * vorhandene werden als gesehen markiert; hat sich Größe oder Änderungszeit geändert, gelten ihre
 * Metadaten und ihr Vorschaubild als veraltet (NULL – werden neu gelesen). Eine wieder
 * aufgetauchte Datei ist wieder „ok“; „defekt“ bleibt, solange sie sich nicht geändert hat.
 * Eine nur in der Schreibweise umbenannte Datei (Windows) behält ihre Zeile.
 *
 * Unveränderte Dateien (gleicher Pfad, Größe, Zeiten, nicht „fehlt“) werden nur als gesehen
 * markiert – ein UPDATE für den ganzen Stapel statt eines UPSERT je Zeile. Gemessen im Index mit
 * 50.000 Zeilen (1.6): 2 statt 47 ms je Stapel von 250, ein ganzer Abgleich ohne Änderungen
 * 0,5 statt 7 s im main. Liefert die Zahl der geschriebenen (neuen oder geänderten) Zeilen.
 */
export function stapelSchreiben(
  db: DB,
  folderId: number,
  seq: number,
  dateien: readonly GefundeneDatei[],
  windows: boolean
): number {
  // Aufnahmedatum vorläufig aus den Dateizeiten (dates.ts), bis ExifTool gelesen hat – ein
  // Datum aus den Metadaten wird dabei nie überschrieben
  const st = db.prepare(`
    INSERT INTO images (folder_id, rel_path, rel_key, name, name_sort, ext, size, mtime, btime,
                        taken_at, taken_source, seen_scan)
    VALUES (@folderId, @rel, @relKey, @name, @nameSort, @ext, @size, @mtime, @btime,
            @takenAt, @takenSource, @seq)
    ON CONFLICT (folder_id, rel_key) DO UPDATE SET
      rel_path     = excluded.rel_path,
      name         = excluded.name,
      name_sort    = excluded.name_sort,
      ext          = excluded.ext,
      seen_scan    = excluded.seen_scan,
      meta_read_at = CASE WHEN size != excluded.size OR mtime != excluded.mtime THEN NULL ELSE meta_read_at END,
      thumb_state  = CASE WHEN size != excluded.size OR mtime != excluded.mtime THEN NULL ELSE thumb_state END,
      missing_since = CASE WHEN status = 'fehlt' THEN NULL ELSE missing_since END,
      status       = CASE WHEN size != excluded.size OR mtime != excluded.mtime OR status = 'fehlt'
                          THEN 'ok' ELSE status END,
      taken_offset = CASE WHEN taken_source IS NULL OR taken_source LIKE 'datei-%'
                          THEN NULL ELSE taken_offset END,
      taken_at     = CASE WHEN taken_source IS NULL OR taken_source LIKE 'datei-%'
                          THEN excluded.taken_at ELSE taken_at END,
      taken_source = CASE WHEN taken_source IS NULL OR taken_source LIKE 'datei-%'
                          THEN excluded.taken_source ELSE taken_source END,
      size         = excluded.size,
      mtime        = excluded.mtime,
      btime        = excluded.btime
  `)
  const vorhanden = db.prepare(`
    SELECT id, rel_key, rel_path, size, mtime, btime, status FROM images
     WHERE folder_id = ? AND rel_key IN (SELECT value FROM json_each(?))
  `)
  const gesehen = db.prepare(
    'UPDATE images SET seen_scan = ? WHERE id IN (SELECT value FROM json_each(?))'
  )
  return db.transaction(() => {
    const schluessel = dateien.map((d) => pfadSchluessel(d.rel, windows))
    const alt = new Map(
      (
        vorhanden.all(folderId, JSON.stringify(schluessel)) as {
          id: number
          rel_key: string
          rel_path: string
          size: number
          mtime: number
          btime: number | null
          status: string
        }[]
      ).map((z) => [z.rel_key, z])
    )
    const gleich: number[] = []
    dateien.forEach((d, i) => {
      const z = alt.get(schluessel[i])
      if (
        z &&
        z.status !== 'fehlt' &&
        z.rel_path === d.rel &&
        z.size === d.size &&
        z.mtime === d.mtime &&
        z.btime === d.btime
      ) {
        gleich.push(z.id)
        return
      }
      const punkt = d.name.lastIndexOf('.')
      const datum = dateiDatum(d.btime, d.mtime)
      st.run({
        takenAt: datum.lokal,
        takenSource: datum.quelle,
        folderId,
        rel: d.rel,
        relKey: pfadSchluessel(d.rel, windows),
        name: d.name,
        nameSort: nameSortKey(d.name),
        ext: punkt > 0 ? d.name.slice(punkt + 1).toLowerCase() : '',
        size: d.size,
        mtime: d.mtime,
        btime: d.btime,
        seq
      })
    })
    if (gleich.length) gesehen.run(seq, JSON.stringify(gleich))
    return dateien.length - gleich.length
  })()
}

/** Höchste Kennung im Index – vor einem Scan gemerkt: Was danach dazukommt, ist neu. */
export function hoechsteKennung(db: DB): number {
  return db.prepare('SELECT coalesce(max(id), 0) FROM images').pluck().get() as number
}

export interface Abschluss {
  /** neu als fehlend markiert */
  fehlend: number
  /** als verschoben oder umbenannt erkannt (alte Zeile mit neuem Pfad) */
  verschoben: number
  /** Kennungen neuer Zeilen, die dabei wegfielen – ihre Vorschaubilder verwerfen */
  verworfen: number[]
}

interface Kandidat {
  id: number
  rel_key: string
  ext: string
  size: number
  mtime: number
}

/**
 * Nicht gesehene Zeilen abschließen: Was unter einem unlesbaren Pfad liegt, bleibt; sonst gilt es
 * als fehlend – es sei denn, es taucht in diesem Scan an anderer Stelle wieder auf (verschoben,
 * umbenannt). Dazu passt eine neue Zeile dieses Scans (Kennung > `neuAb`) zu genau einer
 * verschwundenen oder schon fehlenden Zeile des Ordners mit gleicher Endung, Größe und
 * Änderungszeit – und umgekehrt. Dann übernimmt die alte Zeile den neuen Pfad (Kennung,
 * Metadaten, Vorschaubild bleiben), die neue fällt weg.
 */
function abschliessen(
  db: DB,
  folderId: number,
  seq: number,
  kandidaten: readonly Kandidat[],
  unlesbar: readonly string[],
  windows: boolean,
  neuAb: number
): Abschluss {
  const unlesbarKeys = unlesbar.map((u) => pfadSchluessel(u, windows))
  const verschwunden = kandidaten.filter((k) => !unterUnlesbarem(k.rel_key, unlesbarKeys))
  const neu = db
    .prepare(
      `SELECT id, rel_path, rel_key, name, name_sort, ext, size, mtime FROM images
        WHERE folder_id = ? AND seen_scan = ? AND id > ?`
    )
    .all(folderId, seq, neuAb) as (Kandidat & {
    rel_path: string
    name: string
    name_sort: string
  })[]
  const schon = neu.length
    ? (db
        .prepare(
          "SELECT id, rel_key, ext, size, mtime FROM images WHERE folder_id = ? AND status = 'fehlt'"
        )
        .all(folderId) as Kandidat[])
    : []
  const zeichen = (k: Kandidat): string => `${k.ext}|${k.size}|${k.mtime}`
  const zaehlen = (liste: readonly Kandidat[]): Map<string, Kandidat[]> => {
    const m = new Map<string, Kandidat[]>()
    for (const k of liste) m.set(zeichen(k), [...(m.get(zeichen(k)) ?? []), k])
    return m
  }
  const alt = zaehlen([...verschwunden, ...schon])
  const paare: [Kandidat, (typeof neu)[number]][] = []
  for (const [z, n] of zaehlen(neu)) {
    const a = alt.get(z)
    if (n.length === 1 && a?.length === 1) paare.push([a[0], n[0] as (typeof neu)[number]])
  }
  const uebernommen = new Set(paare.map(([a]) => a.id))
  const fehlend = verschwunden.filter((k) => !uebernommen.has(k.id))

  const loeschen = db.prepare('DELETE FROM images WHERE id = ?')
  const umziehen = db.prepare(`
    UPDATE images SET rel_path = @rel_path, rel_key = @rel_key, name = @name,
                      name_sort = @name_sort, seen_scan = @seq,
                      missing_since = NULL,
                      status = CASE WHEN status = 'fehlt' THEN 'ok' ELSE status END
     WHERE id = @id
  `)
  // seit wann sie fehlt: nach 30 Tagen fällt sie weg (fehlendeAelterAls)
  const jetzt = Date.now()
  const markieren = db.prepare("UPDATE images SET status = 'fehlt', missing_since = ? WHERE id = ?")
  db.transaction(() => {
    for (const [a, n] of paare) {
      // erst die neue Zeile weg – rel_key ist je Ordner eindeutig
      loeschen.run(n.id)
      umziehen.run({
        id: a.id,
        rel_path: n.rel_path,
        rel_key: n.rel_key,
        name: n.name,
        name_sort: n.name_sort,
        seq
      })
    }
    for (const f of fehlend) markieren.run(jetzt, f.id)
  })()
  return {
    fehlend: fehlend.length,
    verschoben: paare.length,
    verworfen: paare.map(([, n]) => n.id)
  }
}

/**
 * Vollständigen Scan abschließen: Nicht gesehene Dateien gelten als fehlend – außer unter
 * `unlesbar` (relative Pfade, die der Scan nicht lesen konnte) und außer verschobenen
 * (`neuAb`: höchste Kennung vor dem Scan; ohne Angabe keine Erkennung).
 */
export function scanAbschliessen(
  db: DB,
  folderId: number,
  seq: number,
  unlesbar: readonly string[],
  windows: boolean,
  jetzt: number,
  neuAb = Number.MAX_SAFE_INTEGER
): Abschluss {
  const kandidaten = db
    .prepare(
      `SELECT id, rel_key, ext, size, mtime FROM images
        WHERE folder_id = ? AND seen_scan < ? AND status != 'fehlt'`
    )
    .all(folderId, seq) as Kandidat[]
  const r = abschliessen(db, folderId, seq, kandidaten, unlesbar, windows, neuAb)
  db.prepare('UPDATE folders SET last_scan = ?, unreadable = ? WHERE id = ?').run(
    jetzt,
    unlesbar.length,
    folderId
  )
  return r
}

/**
 * Teil-Scan abschließen (nach dem Überwachen): wie oben, aber nur unter den gemeldeten `pfade`n
 * (relativ, „/“; eine Datei oder ein Ordner samt allem darunter) und genau an den `dateien`
 * (als geändert gemeldet – nichts darunter). Ändert `last_scan` nicht.
 */
export function teilAbschliessen(
  db: DB,
  folderId: number,
  seq: number,
  pfade: readonly string[],
  dateien: readonly string[],
  unlesbar: readonly string[],
  windows: boolean,
  neuAb = Number.MAX_SAFE_INTEGER
): Abschluss {
  const st = db.prepare(
    `SELECT id, rel_key, ext, size, mtime FROM images
      WHERE folder_id = @folderId AND seen_scan < @seq AND status != 'fehlt'
        AND (rel_key = @k OR (rel_key >= @von AND rel_key < @bis))`
  )
  const kandidaten = new Map<number, Kandidat>()
  for (const p of pfade) {
    const k = pfadSchluessel(p, windows)
    const [von, bis] = unterordnerBereich(k)
    for (const z of st.all({ folderId, seq, k, von, bis }) as Kandidat[]) kandidaten.set(z.id, z)
  }
  // nur die Datei: ein leerer Bereich (von = bis) lässt allein `rel_key = k` gelten
  for (const d of dateien) {
    const k = pfadSchluessel(d, windows)
    for (const z of st.all({ folderId, seq, k, von: k, bis: k }) as Kandidat[])
      kandidaten.set(z.id, z)
  }
  return abschliessen(db, folderId, seq, [...kandidaten.values()], unlesbar, windows, neuAb)
}

// ── Metadaten (Grundfelder, ab 1.2) ───────────────────────────────────────────────────────────

/** Datei, deren Grundfelder noch fehlen – mit allem, was zum Lesen und Zurückschreiben nötig ist. */
export interface MetaOffen {
  id: number
  folder_id: number
  /** Ordnerpfad (absolut) */
  ordner: string
  /** relativ zum Ordner, „/“ als Trenner */
  rel_path: string
  size: number
  mtime: number
  btime: number | null
}

/**
 * Die nächsten Dateien ohne gelesene Metadaten (Teilindex images_meta_offen), in Reihenfolge der
 * Kennung. Fehlende Dateien und Ordner in `ohneOrdner` (gerade nicht erreichbar) bleiben liegen.
 */
export function metaOffen(db: DB, limit: number, ohneOrdner: readonly number[] = []): MetaOffen[] {
  return db
    .prepare(
      `SELECT i.id, i.folder_id, f.path AS ordner, i.rel_path, i.size, i.mtime, i.btime
         FROM images i JOIN folders f ON f.id = i.folder_id
        WHERE i.meta_read_at IS NULL AND i.status != 'fehlt'
          AND i.folder_id NOT IN (SELECT value FROM json_each(?))
        ORDER BY i.id LIMIT ?`
    )
    .all(JSON.stringify(ohneOrdner), limit) as MetaOffen[]
}

/** Zahl der Dateien ohne gelesene Metadaten (für die Statusleiste). */
export function metaOffenAnzahl(db: DB, ohneOrdner: readonly number[] = []): number {
  return (
    db
      .prepare(
        `SELECT count(*) AS n FROM images
          WHERE meta_read_at IS NULL AND status != 'fehlt'
            AND folder_id NOT IN (SELECT value FROM json_each(?))`
      )
      .get(JSON.stringify(ohneOrdner)) as { n: number }
  ).n
}

/**
 * Gelesene Grundfelder eintragen – in EINER Transaktion. Geschrieben wird nur, wenn Größe und
 * Änderungszeit noch die beim Lesen sind: Hat ein Scan die Datei inzwischen als geändert
 * eingetragen, gehört das Ergebnis zur alten Fassung und wird verworfen (sie wird neu gelesen).
 * Liefert die Zahl der geschriebenen Zeilen.
 */
/** Ort einer Datei (2.2): Ort-Feld der Metadaten oder nächster Ort aus GPS */
export interface OrtWert {
  name: string
  land: string | null
  quelle: 'metadaten' | 'gps'
}

/** Sortierschlüssel „Ort A–Z, dann Land“ (gleichnamige Orte verschiedener Länder getrennt) */
export function ortSchluessel(o: OrtWert): string {
  return `${nameSortKey(o.name)}\u0001${nameSortKey(o.land ?? '')}`
}

export function metaSchreiben(
  db: DB,
  zeilen: readonly {
    id: number
    size: number
    mtime: number
    felder: Grundfelder
    ort?: OrtWert | null
  }[],
  jetzt: number
): number {
  const st = db.prepare(`
    UPDATE images SET
      width = @breite, height = @hoehe, orientation = @ausrichtung, format = @format,
      camera_make = @kameraHersteller, camera_model = @kameraModell, lens = @objektiv,
      aperture = @blende, exposure = @belichtung, iso = @iso, focal = @brennweite,
      gps_lat = @gpsBreite, gps_lon = @gpsLaenge, gps_alt = @gpsHoehe,
      rating = @bewertung, color_label = @farblabel, title = @titel, description = @beschreibung,
      place_name = @ortName, place_country = @ortLand, place_source = @ortQuelle,
      place_sort = @ortSort, place_missing = @ortFehlt,
      taken_at = @takenAt, taken_offset = @takenOffset, taken_source = @takenSource,
      meta_read_at = @jetzt
    WHERE id = @id AND size = @size AND mtime = @mtime
  `)
  const stichwoerterWeg = db.prepare('DELETE FROM keywords WHERE image_id = ?')
  const stichwort = db.prepare('INSERT OR IGNORE INTO keywords (image_id, keyword) VALUES (?, ?)')
  let n = 0
  db.transaction(() => {
    for (const z of zeilen) {
      const f = z.felder
      const geaendert = st.run({
        id: z.id,
        size: z.size,
        mtime: z.mtime,
        breite: f.breite,
        hoehe: f.hoehe,
        ausrichtung: f.ausrichtung,
        format: f.format,
        kameraHersteller: f.kameraHersteller,
        kameraModell: f.kameraModell,
        objektiv: f.objektiv,
        blende: f.blende,
        belichtung: f.belichtung,
        iso: f.iso,
        brennweite: f.brennweite,
        gpsBreite: f.gps?.breite ?? null,
        gpsLaenge: f.gps?.laenge ?? null,
        gpsHoehe: f.gps?.hoehe ?? null,
        bewertung: f.bewertung,
        farblabel: f.farblabel,
        titel: f.titel,
        beschreibung: f.beschreibung,
        ortName: z.ort?.name ?? null,
        ortLand: z.ort?.land ?? null,
        ortQuelle: z.ort?.quelle ?? null,
        ortSort: z.ort ? ortSchluessel(z.ort) : null,
        ortFehlt: z.ort ? 0 : 1,
        takenAt: f.aufnahme.lokal,
        takenOffset: f.aufnahme.offset,
        takenSource: f.aufnahme.quelle,
        jetzt
      }).changes
      if (!geaendert) continue
      n += geaendert
      stichwoerterWeg.run(z.id)
      for (const w of f.stichwoerter) stichwort.run(z.id, w)
    }
  })()
  return n
}

// ── Abfragen für die Oberfläche ───────────────────────────────────────────────────────────────

/**
 * Geordnete Kennungen aller vorhandenen Dateien (Skill bibliothek-index, „Abfragen“): einmal je
 * Sortierung, Details holt der Renderer nur für den sichtbaren Ausschnitt.
 */
export function kennungen(
  db: DB,
  sortierung: Sortierung,
  filter?: OrdnerFilter,
  windows = process.platform === 'win32'
): number[] {
  return abfragen(db, sortierung, filter, windows, null).map((z) => z.id)
}

/** Eine Abfrage der Galerie: Sortierung, Knoten, Gruppen, Blocksatz, Filter und Suche. */
export interface Anfrage {
  sortierung: Sortierung
  ordner?: OrdnerFilter
  gruppe?: { art: GruppenArt; stufe: ZeitStufe } | null
  mitSeiten?: boolean
  /** geprüft (`pruefeBildFilter`) */
  bildFilter?: BildFilter
}

/**
 * Kennungen samt Gruppen (2.3), Seitenverhältnissen (2.3b) und – bei aktivem Filter (2.4) – der
 * Zahl der Bilder im Knoten ohne Filter („12 von 340“).
 */
export function abfrageAnsicht(
  db: DB,
  a: Anfrage,
  windows = process.platform === 'win32'
): { ids: number[]; gruppen: Gruppe[]; seiten?: number[]; gesamt?: number } {
  const { art, stufe } = a.gruppe ?? { art: null, stufe: 'monat' as const }
  const r = kennungenMitGruppen(
    db,
    a.sortierung,
    a.ordner,
    art,
    stufe,
    windows,
    a.mitSeiten,
    a.bildFilter
  )
  if (!filterAktiv(a.bildFilter)) return r
  const knoten = knotenBedingung(a.ordner, windows)
  const gesamt = db
    .prepare(`SELECT count(*) FROM images WHERE ${knoten.sql}`)
    .pluck()
    .get(...knoten.werte) as number
  return { ...r, gesamt }
}

/**
 * Wie `kennungen`, dazu die Gruppen (2.3) aus demselben Durchlauf – Liste und Gruppen passen so
 * immer zusammen. Der Schlüssel kommt aus einem festen Ausdruck (gruppen.ts).
 */
export function kennungenMitGruppen(
  db: DB,
  sortierung: Sortierung,
  filter: OrdnerFilter | undefined,
  art: GruppenArt | null,
  stufe: ZeitStufe,
  windows = process.platform === 'win32',
  mitSeiten = false,
  bildFilter?: BildFilter
): { ids: number[]; gruppen: Gruppe[]; seiten?: number[] } {
  const zeilen = abfragen(
    db,
    sortierung,
    filter,
    windows,
    art ? gruppenAusdruck(art, stufe) : null,
    mitSeiten,
    bildFilter
  )
  return {
    ids: zeilen.map((z) => z.id),
    gruppen: art
      ? gruppenAus(
          art,
          zeilen.map((z) => z.g)
        )
      : [],
    ...(mitSeiten ? { seiten: zeilen.map((z) => seitenVerhaeltnis(z.w, z.h)) } : {})
  }
}

/** Breite durch Höhe (aufgerichtet), auf 1/1000 gerundet; 0 = unbekannt (noch nicht gelesen, defekt). */
export function seitenVerhaeltnis(w: number | null, h: number | null): number {
  return w && h && w > 0 && h > 0 ? Math.round((w / h) * 1000) / 1000 : 0
}

interface AbfrageZeile {
  id: number
  g: unknown
  w: number | null
  h: number | null
}

/**
 * Bedingung für den gewählten Knoten: alle vorhandenen Bilder, ein Ordner oder ein Unterordner
 * (Bereich auf dem Vergleichsschlüssel – nutzt den Index folder_id, rel_key; ohne Groß/Klein).
 */
function knotenBedingung(
  filter: OrdnerFilter | undefined,
  windows: boolean
): { sql: string; werte: (string | number)[] } {
  if (!filter) return { sql: "status != 'fehlt'", werte: [] }
  if (!filter.pfad) return { sql: "status != 'fehlt' AND folder_id = ?", werte: [filter.ordner] }
  const [von, bis] = unterordnerBereich(pfadSchluessel(filter.pfad, windows))
  return {
    sql: "status != 'fehlt' AND folder_id = ? AND rel_key >= ? AND rel_key < ?",
    werte: [filter.ordner, von, bis]
  }
}

/** Knoten und (geprüfter) Bild-Filter zusammen – Werte nur als Parameter. */
function bedingung(
  filter: OrdnerFilter | undefined,
  windows: boolean,
  bildFilter: BildFilter | undefined
): { sql: string; werte: (string | number)[] } {
  const k = knotenBedingung(filter, windows)
  const f = bildFilter ? filterBedingung(bildFilter) : { sql: '', werte: [] }
  return f.sql ? { sql: `${k.sql} AND ${f.sql}`, werte: [...k.werte, ...f.werte] } : k
}

/**
 * Geordnete Zeilen (Kennung, wahlweise Gruppen-Schlüssel und Maße für den Blocksatz) – ganz, je
 * Ordner oder Unterordner, wahlweise gefiltert (2.4).
 */
function abfragen(
  db: DB,
  sortierung: Sortierung,
  filter: OrdnerFilter | undefined,
  windows: boolean,
  gruppe: string | null,
  mitSeiten = false,
  bildFilter?: BildFilter
): AbfrageZeile[] {
  const spalten = [
    'id',
    gruppe ? `${gruppe} AS g` : 'NULL AS g',
    mitSeiten ? 'width AS w, height AS h' : 'NULL AS w, NULL AS h'
  ].join(', ')
  const b = bedingung(filter, windows, bildFilter)
  return db
    .prepare(`SELECT ${spalten} FROM images WHERE ${b.sql} ORDER BY ${orderBy(sortierung)}`)
    .all(...b.werte) as AbfrageZeile[]
}

/** Höchstens so viele Werte je Auswahlliste der Filterleiste */
const FACETTEN_MAX = 2000

/**
 * Was es im Knoten gibt (ohne Filter): Kameras, Orte, Stichwörter, Formate, Farblabel mit
 * Anzahl, A–Z; dazu der früheste und späteste Aufnahmetag.
 */
export function facetten(
  db: DB,
  filter?: OrdnerFilter,
  windows = process.platform === 'win32'
): Facetten {
  const k = knotenBedingung(filter, windows)
  const liste = (ausdruck: string, titel: (w: string) => string): FilterWert[] =>
    (
      db
        .prepare(
          `SELECT ${ausdruck} AS wert, count(*) AS anzahl FROM images
            WHERE ${k.sql} AND ${ausdruck} IS NOT NULL AND ${ausdruck} != ''
            GROUP BY wert ORDER BY wert COLLATE NOCASE LIMIT ${FACETTEN_MAX}`
        )
        .all(...k.werte) as { wert: string; anzahl: number }[]
    ).map((z) => ({ wert: z.wert, titel: titel(z.wert), anzahl: z.anzahl }))
  const stichwoerter = (
    db
      .prepare(
        `SELECT keyword AS wert, count(*) AS anzahl FROM keywords
          WHERE image_id IN (SELECT id FROM images WHERE ${k.sql})
          GROUP BY keyword ORDER BY keyword COLLATE NOCASE LIMIT ${FACETTEN_MAX}`
      )
      .all(...k.werte) as { wert: string; anzahl: number }[]
  ).map((z) => ({ ...z, titel: z.wert }))
  const zeitraum = db
    .prepare(
      `SELECT substr(min(taken_at), 1, 10) AS von, substr(max(taken_at), 1, 10) AS bis
         FROM images WHERE ${k.sql}`
    )
    .get(...k.werte) as { von: string | null; bis: string | null }
  return {
    kameras: liste(gruppenAusdruck('kamera', 'monat'), (w) => w),
    orte: liste(gruppenAusdruck('ort', 'monat'), (w) => gruppenTitel('ort', w)),
    stichwoerter,
    formate: liste('coalesce(format, ext)', (w) => w.toUpperCase()),
    farben: liste('color_label', farblabelText),
    zeitraum
  }
}

/** Unterordner je Bibliotheksordner mit der Zahl ihrer (direkten) Dateien – für den Ordnerbaum. */
export function verzeichnisse(db: DB): { folder_id: number; pfad: string; anzahl: number }[] {
  return db
    .prepare(
      `SELECT folder_id,
              substr(rel_path, 1, length(rel_path) - length(name) - 1) AS pfad,
              count(*) AS anzahl
         FROM images WHERE status != 'fehlt'
        GROUP BY folder_id, pfad ORDER BY folder_id, pfad`
    )
    .all() as { folder_id: number; pfad: string; anzahl: number }[]
}

/** Summe der Dateigrößen (Statusleiste: Auswahl); unbekannte Kennungen zählen nicht. */
export function groesseSumme(db: DB, ids: readonly number[]): number {
  return (
    db
      .prepare(
        'SELECT coalesce(sum(size), 0) AS s FROM images WHERE id IN (SELECT value FROM json_each(?))'
      )
      .get(JSON.stringify(ids)) as { s: number }
  ).s
}

/** Höchstens so viele Details je Anfrage (sichtbarer Ausschnitt plus Vorrat) */
export const DETAILS_MAX = 1000

interface DetailZeile {
  id: number
  folder_id: number
  name: string
  ext: string
  format: string | null
  size: number
  mtime: number
  width: number | null
  height: number | null
  orientation: number | null
  taken_at: string
  taken_offset: string | null
  taken_source: ImageInfo['takenSource']
  camera_make: string | null
  camera_model: string | null
  status: ImageInfo['status']
  meta_read_at: number | null
  color: string | null
  lens: string | null
  aperture: number | null
  exposure: number | null
  iso: number | null
  focal: number | null
  gps_lat: number | null
  gps_lon: number | null
  gps_alt: number | null
  rating: number | null
  color_label: string | null
  title: string | null
  description: string | null
  place_name: string | null
  place_country: string | null
  place_source: 'metadaten' | 'gps' | null
}

/** Details zu Kennungen, in der Reihenfolge der Anfrage; unbekannte fehlen in der Antwort. */
export function details(db: DB, ids: readonly number[]): ImageInfo[] {
  if (ids.length > DETAILS_MAX) throw new Error(`Höchstens ${DETAILS_MAX} Kennungen je Anfrage`)
  const rows = db
    .prepare(
      `SELECT id, folder_id, name, ext, format, size, mtime, width, height, orientation,
              taken_at, taken_offset, taken_source, camera_make, camera_model, status, meta_read_at,
              color, lens, aperture, exposure, iso, focal, gps_lat, gps_lon, gps_alt, rating,
              color_label, title, description, place_name, place_country, place_source
         FROM images WHERE id IN (SELECT value FROM json_each(?))`
    )
    .all(JSON.stringify(ids)) as DetailZeile[]
  const nachId = new Map(rows.map((r) => [r.id, r]))
  const woerter = new Map<number, string[]>()
  for (const w of db
    .prepare(
      `SELECT image_id, keyword FROM keywords WHERE image_id IN (SELECT value FROM json_each(?))
        ORDER BY image_id, keyword`
    )
    .all(JSON.stringify(ids)) as { image_id: number; keyword: string }[]) {
    woerter.set(w.image_id, [...(woerter.get(w.image_id) ?? []), w.keyword])
  }
  return ids.flatMap((id) => {
    const r = nachId.get(id)
    if (!r) return []
    return [
      {
        id: r.id,
        folderId: r.folder_id,
        name: r.name,
        ext: r.ext,
        format: r.format,
        size: r.size,
        mtime: r.mtime,
        width: r.width,
        height: r.height,
        orientation: r.orientation,
        takenAt: r.taken_at,
        takenOffset: r.taken_offset,
        takenSource: r.taken_source,
        cameraMake: r.camera_make,
        cameraModel: r.camera_model,
        status: r.status,
        metaRead: r.meta_read_at !== null,
        color: r.color,
        lens: r.lens,
        aperture: r.aperture,
        exposure: r.exposure,
        iso: r.iso,
        focal: r.focal,
        gps:
          r.gps_lat !== null && r.gps_lon !== null
            ? { lat: r.gps_lat, lon: r.gps_lon, alt: r.gps_alt }
            : null,
        rating: r.rating,
        colorLabel: r.color_label,
        title: r.title,
        description: r.description,
        keywords: woerter.get(r.id) ?? [],
        place:
          r.place_name && r.place_source
            ? { name: r.place_name, country: r.place_country, source: r.place_source }
            : null
      }
    ]
  })
}

// ── Vorschaubilder (ab 1.3) ───────────────────────────────────────────────────────────────────

/** Zustand des Vorschaubilds: 'ok' = im Cache; sonst nicht wieder versuchen, bis die Datei sich ändert */
export type VorschauZustand = 'ok' | 'defekt' | 'zu-gross' | 'abgelehnt' | 'kein-werkzeug'

/** Was zum Erzeugen und Ausliefern einer Vorschau nötig ist. */
export interface VorschauZeile {
  id: number
  folder_id: number
  /** Ordnerpfad (absolut) */
  ordner: string
  mode: FolderMode
  rel_path: string
  name: string
  ext: string
  format: string | null
  size: number
  mtime: number
  status: 'ok' | 'fehlt' | 'defekt'
  thumb_state: VorschauZustand | null
}

const VORSCHAU_SPALTEN = `i.id, i.folder_id, f.path AS ordner, f.mode, i.rel_path, i.name, i.ext,
  i.format, i.size, i.mtime, i.status, i.thumb_state`

/**
 * Die nächsten Dateien ohne Vorschaubild (Teilindex images_thumb_offen) nach `nachId` – so
 * kommt eine Datei, die gerade nicht ging (gesperrt, Zeitlimit), erst in der nächsten Runde
 * wieder. Ohne fehlende Dateien, ohne Ordner „privat“ (nie auf die Platte) und ohne `ohneOrdner`.
 */
export function vorschauOffen(
  db: DB,
  limit: number,
  nachId = 0,
  ohneOrdner: readonly number[] = []
): VorschauZeile[] {
  return db
    .prepare(
      `SELECT ${VORSCHAU_SPALTEN}
         FROM images i JOIN folders f ON f.id = i.folder_id
        WHERE i.thumb_state IS NULL AND i.status != 'fehlt' AND f.mode != 'privat'
          AND i.id > ? AND i.folder_id NOT IN (SELECT value FROM json_each(?))
        ORDER BY i.id LIMIT ?`
    )
    .all(nachId, JSON.stringify(ohneOrdner), limit) as VorschauZeile[]
}

/**
 * Offene Vorschaubilder unter diesen Kennungen (der sichtbare Ausschnitt, in seiner Reihenfolge),
 * ohne „privat“ und ohne fehlende Dateien.
 */
export function vorschauOffenUnter(db: DB, ids: readonly number[]): VorschauZeile[] {
  const zeilen = db
    .prepare(
      `SELECT ${VORSCHAU_SPALTEN}
         FROM images i JOIN folders f ON f.id = i.folder_id
        WHERE i.id IN (SELECT value FROM json_each(?))
          AND i.thumb_state IS NULL AND i.status != 'fehlt' AND f.mode != 'privat'`
    )
    .all(JSON.stringify(ids)) as VorschauZeile[]
  const rang = new Map(ids.map((id, i) => [id, i]))
  return zeilen.sort((a, b) => (rang.get(a.id) ?? 0) - (rang.get(b.id) ?? 0))
}

/** Zahl der Dateien, deren Vorschaubild noch entsteht (für die Statusleiste). */
export function vorschauOffenAnzahl(db: DB, ohneOrdner: readonly number[] = []): number {
  return (
    db
      .prepare(
        `SELECT count(*) AS n FROM images i JOIN folders f ON f.id = i.folder_id
          WHERE i.thumb_state IS NULL AND i.status != 'fehlt' AND f.mode != 'privat'
            AND i.folder_id NOT IN (SELECT value FROM json_each(?))`
      )
      .get(JSON.stringify(ohneOrdner)) as { n: number }
  ).n
}

/** Zeilen zu Kennungen (jeder Zustand, auch „privat“), ohne fehlende Dateien. */
export function vorschauZeilen(db: DB, ids: readonly number[]): VorschauZeile[] {
  return db
    .prepare(
      `SELECT ${VORSCHAU_SPALTEN}
         FROM images i JOIN folders f ON f.id = i.folder_id
        WHERE i.id IN (SELECT value FROM json_each(?)) AND i.status != 'fehlt'`
    )
    .all(JSON.stringify(ids)) as VorschauZeile[]
}

/**
 * Ergebnisse eintragen – in EINER Transaktion, nur wenn Größe und Änderungszeit noch stimmen
 * (sonst gehört das Ergebnis zur alten Fassung). `defekt` setzt auch den Status der Datei.
 * Liefert die Kennungen, die geschrieben wurden.
 */
export function vorschauSchreiben(
  db: DB,
  zeilen: readonly {
    id: number
    size: number
    mtime: number
    zustand: VorschauZustand | null
    farbe: string | null
  }[]
): Set<number> {
  const st = db.prepare(`
    UPDATE images SET
      thumb_state = @zustand,
      color       = COALESCE(@farbe, color),
      status      = CASE WHEN @zustand = 'defekt' THEN 'defekt' ELSE status END
    WHERE id = @id AND size = @size AND mtime = @mtime
  `)
  const geschrieben = new Set<number>()
  db.transaction(() => {
    for (const z of zeilen) {
      const r = st.run({
        id: z.id,
        size: z.size,
        mtime: z.mtime,
        zustand: z.zustand,
        farbe: z.farbe
      })
      if (r.changes) geschrieben.add(z.id)
    }
  })()
  return geschrieben
}

/** Kennungen aller Dateien eines Ordners (vor dem Entfernen: ihre Cache-Dateien löschen). */
export function ordnerKennungen(db: DB, folderId: number): number[] {
  return db
    .prepare('SELECT id FROM images WHERE folder_id = ? ORDER BY id')
    .pluck()
    .all(folderId) as number[]
}

/** Alle fertigen Vorschaubilder als offen markieren (neuer Schlüssel: der Cache ist leer). */
export function vorschauAlleOffen(db: DB): number {
  return db.prepare("UPDATE images SET thumb_state = NULL WHERE thumb_state = 'ok'").run().changes
}

/** Kleiner Schlüssel-Wert-Speicher im Index (Stand der Ortsdaten …). */
export function kvLesen(db: DB, key: string): string | null {
  return (db.prepare('SELECT value FROM kv WHERE key = ?').pluck().get(key) as string) ?? null
}

export function kvSchreiben(db: DB, key: string, value: string): void {
  db.prepare(
    'INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value'
  ).run(key, value)
}

/**
 * Neue Ortsdaten: Dateien mit Koordinaten, deren Ort aus GPS kam (oder noch keinen hat), zum
 * Nachlesen vormerken – dabei wird der Ort neu bestimmt. Ein Ort aus dem Ort-Feld bleibt.
 */
export function orteNeuBestimmen(db: DB): number {
  return db
    .prepare(
      `UPDATE images SET meta_read_at = NULL
        WHERE gps_lat IS NOT NULL AND status != 'fehlt'
          AND (place_source IS NULL OR place_source = 'gps')`
    )
    .run().changes
}

/**
 * Kennungen fehlender Dateien – eines Ordners (Menü „Fehlende entfernen“) bzw. aller, die seit
 * mindestens `vor` (ms seit 1970) fehlen (automatisch nach 30 Tagen). Das Entfernen samt
 * Vorschaubildern macht library.ts (bilderEntfernen + Cache).
 */
export function fehlende(db: DB, auswahl: { ordner: number } | { vor: number }): number[] {
  return (
    'ordner' in auswahl
      ? db
          .prepare("SELECT id FROM images WHERE folder_id = ? AND status = 'fehlt' ORDER BY id")
          .pluck()
          .all(auswahl.ordner)
      : db
          .prepare(
            "SELECT id FROM images WHERE status = 'fehlt' AND missing_since <= ? ORDER BY id"
          )
          .pluck()
          .all(auswahl.vor)
  ) as number[]
}

/** Index-Zeilen von Dateien entfernen, die es nicht mehr gibt (Papierkorb); liefert die Zahl. */
export function bilderEntfernen(db: DB, ids: readonly number[]): number {
  return db
    .prepare('DELETE FROM images WHERE id IN (SELECT value FROM json_each(?))')
    .run(JSON.stringify(ids)).changes
}

/** Vorschaubilder eines Ordners als offen markieren (Wechsel nach/aus „privat“). */
export function vorschauZuruecksetzen(db: DB, folderId: number): void {
  db.prepare("UPDATE images SET thumb_state = NULL WHERE folder_id = ? AND thumb_state = 'ok'").run(
    folderId
  )
}

// ── Gespeicherte Ansichten (2.4b) ─────────────────────────────────────────────────────────────

const NAMEN = new Intl.Collator('de', { sensitivity: 'base', numeric: true })

/** Alle Ansichten nach Name; eine Zeile, die die Prüfung nicht besteht, fällt weg (fremde Version). */
export function ansichten(db: DB): GespeicherteAnsicht[] {
  const zeilen = db.prepare('SELECT id, name, folder_id, pfad, stand FROM ansichten').all() as {
    id: number
    name: string
    folder_id: number | null
    pfad: string
    stand: string
  }[]
  const out: GespeicherteAnsicht[] = []
  for (const z of zeilen) {
    let roh: unknown
    try {
      roh = JSON.parse(z.stand)
    } catch {
      continue
    }
    const knoten = z.folder_id === null ? null : { ordner: z.folder_id, pfad: z.pfad }
    const stand = pruefeAnsichtStand({ ...(roh as object), knoten })
    if (stand) out.push({ ...stand, id: z.id, name: z.name })
  }
  return out.sort((a, b) => NAMEN.compare(a.name, b.name))
}

/** Neu anlegen oder – nur mit `ersetzen` – eine Ansicht gleichen Namens ersetzen. */
export function ansichtSpeichern(
  db: DB,
  name: string,
  { knoten, ...rest }: AnsichtStand,
  ersetzen: boolean
): AnsichtSpeichernErgebnis {
  const key = nameSchluessel(name)
  const felder = [name, knoten?.ordner ?? null, knoten?.pfad ?? '', JSON.stringify(rest)]
  return db.transaction((): AnsichtSpeichernErgebnis => {
    const alt = db.prepare('SELECT id FROM ansichten WHERE name_key = ?').get(key) as
      { id: number } | undefined
    if (alt) {
      if (!ersetzen) return { status: 'vorhanden' }
      db.prepare(
        'UPDATE ansichten SET name = ?, folder_id = ?, pfad = ?, stand = ? WHERE id = ?'
      ).run(...felder, alt.id)
      return { status: 'gespeichert', id: alt.id }
    }
    const n = db.prepare('SELECT count(*) FROM ansichten').pluck().get() as number
    if (n >= ANSICHTEN_MAX) return { status: 'voll' }
    const r = db
      .prepare(
        'INSERT INTO ansichten (name, folder_id, pfad, stand, name_key) VALUES (?, ?, ?, ?, ?)'
      )
      .run(...felder, key)
    return { status: 'gespeichert', id: Number(r.lastInsertRowid) }
  })()
}

export function ansichtName(db: DB, id: number): string | null {
  const name = db.prepare('SELECT name FROM ansichten WHERE id = ?').pluck().get(id)
  return (name as string | undefined) ?? null
}

export function ansichtLoeschen(db: DB, id: number): boolean {
  return db.prepare('DELETE FROM ansichten WHERE id = ?').run(id).changes > 0
}
