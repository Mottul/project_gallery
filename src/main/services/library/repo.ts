// Zugriffe der Bibliothek auf den Index – nur SQL, ohne Electron; getestet in repo.test.ts mit
// echter better-sqlite3. Aufrufer ist library.ts (main, einziger Schreiber).
//
// Abgleich statt Neuaufbau (Skill bibliothek-index): Jeder Scan bekommt eine Nummer (scan_seq).
// Jede gefundene Datei wird mit dieser Nummer eingetragen bzw. aktualisiert; was am Ende eines
// VOLLSTÄNDIGEN Scans eine ältere Nummer trägt, fehlt – außer es liegt unter einem Pfad, den der
// Scan nicht lesen konnte (dann ist es nur gerade nicht erreichbar). Ein abgebrochener Scan
// markiert nichts.

import { pfadSchluessel } from '@shared/ordnerPruefen'
import { unterUnlesbarem } from '@shared/scanRegeln'
import { nameSortKey } from '@shared/sortKey'
import type { FolderMode } from '@shared/types'
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
 */
export function stapelSchreiben(
  db: DB,
  folderId: number,
  seq: number,
  dateien: readonly GefundeneDatei[],
  windows: boolean
): void {
  const st = db.prepare(`
    INSERT INTO images (folder_id, rel_path, rel_key, name, name_sort, ext, size, mtime, btime, seen_scan)
    VALUES (@folderId, @rel, @relKey, @name, @nameSort, @ext, @size, @mtime, @btime, @seq)
    ON CONFLICT (folder_id, rel_key) DO UPDATE SET
      rel_path     = excluded.rel_path,
      name         = excluded.name,
      name_sort    = excluded.name_sort,
      ext          = excluded.ext,
      seen_scan    = excluded.seen_scan,
      meta_read_at = CASE WHEN size != excluded.size OR mtime != excluded.mtime THEN NULL ELSE meta_read_at END,
      thumb_state  = CASE WHEN size != excluded.size OR mtime != excluded.mtime THEN NULL ELSE thumb_state END,
      status       = CASE WHEN size != excluded.size OR mtime != excluded.mtime OR status = 'fehlt'
                          THEN 'ok' ELSE status END,
      size         = excluded.size,
      mtime        = excluded.mtime,
      btime        = excluded.btime
  `)
  db.transaction(() => {
    for (const d of dateien) {
      const punkt = d.name.lastIndexOf('.')
      st.run({
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
    }
  })()
}

/**
 * Vollständigen Scan abschließen: Nicht gesehene Dateien gelten als fehlend – außer unter
 * `unlesbar` (relative Pfade, die der Scan nicht lesen konnte). Liefert die Zahl neu fehlender.
 */
export function scanAbschliessen(
  db: DB,
  folderId: number,
  seq: number,
  unlesbar: readonly string[],
  windows: boolean,
  jetzt: number
): number {
  const unlesbarKeys = unlesbar.map((u) => pfadSchluessel(u, windows))
  const kandidaten = db
    .prepare(
      "SELECT id, rel_key FROM images WHERE folder_id = ? AND seen_scan < ? AND status != 'fehlt'"
    )
    .all(folderId, seq) as { id: number; rel_key: string }[]
  const fehlend = kandidaten.filter((k) => !unterUnlesbarem(k.rel_key, unlesbarKeys))
  const markieren = db.prepare("UPDATE images SET status = 'fehlt' WHERE id = ?")
  db.transaction(() => {
    for (const f of fehlend) markieren.run(f.id)
    db.prepare('UPDATE folders SET last_scan = ?, unreadable = ? WHERE id = ?').run(
      jetzt,
      unlesbar.length,
      folderId
    )
  })()
  return fehlend.length
}
