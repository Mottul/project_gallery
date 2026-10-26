// Vorschaubilder im main: Warteschlange und Abruf mit Vorrang. Ein Abruf über thumb:// (das Bild
// ist gerade sichtbar) kommt vor allem anderen dran; im Hintergrund entsteht der Rest, Stapel für
// Stapel in der Reihenfolge der Kennung (Skill bibliothek-index, „Vorschaubilder“). Der Index
// (thumb_state, color) wird nur hier geschrieben; erzeugt wird im Bilddienst.
//
// Ordner „privat“: nichts auf der Platte – der Bilddienst gibt die Vorschau zurück, sie liegt nur
// im Arbeitsspeicher (cache/vorschauCache.ts) und entsteht nur auf Abruf.

import { join } from 'node:path'
import type { Stufe } from '@shared/vorschau'
import { bilddienst } from '../bilddienst/client'
import {
  vorschauParallel,
  type VorschauDatei,
  type VorschauErgebnis
} from '../bilddienst/protokoll'
import {
  speicherAblegen,
  speicherLesen,
  speicherVerwerfen,
  vorschauDateienLoeschen,
  vorschauLesen
} from '../cache/vorschauCache'
import type { DB } from '../db'
import { logLine } from '../log'
import * as repo from './repo'

/** Was die Warteschlange von library.ts braucht (dort liegen Index und Zustand). */
export interface Umgebung {
  db(): DB
  melden(sofort?: boolean): void
  nichtErreichbar(): number[]
  beendet(): boolean
}

let u: Umgebung | null = null

export function vorschauenEinrichten(umgebung: Umgebung): void {
  u = umgebung
}

/** Fehlercodes des Bilddienstes, nach denen es erst eine geänderte Datei wieder versucht. */
const BLEIBEND = new Map<string, repo.VorschauZustand>([
  ['DEFEKT', 'defekt'],
  ['ZU_GROSS', 'zu-gross'],
  ['AUSSERHALB', 'abgelehnt'],
  ['KEINE_DATEI', 'abgelehnt'],
  ['KEIN_FFMPEG', 'kein-werkzeug']
])
/** So lange wartet ein Abruf höchstens auf sein Vorschaubild */
const ABRUF_MS = 60_000

/** Zuletzt gemeldeter sichtbarer Ausschnitt (samt nächster Seite) – kommt vor dem übrigen Hintergrund */
let ausschnitt: number[] = []

/** Die Seite meldet, was sichtbar ist (gedrosselt); ersetzt den vorigen Ausschnitt. */
export function vorschauAusschnitt(ids: readonly number[]): void {
  ausschnitt = [...ids]
  vorschauenAnstossen()
}

/** Wartende Abrufe je Kennung – kommen vor dem Hintergrund dran */
const vorrang = new Map<number, ((ok: boolean) => void)[]>()
/** Abstürze des Bilddienstes je Datei; beim zweiten gilt sie als defekt */
const abstuerze = new Map<number, number>()
let laeuft = false
let nochmal = false

function freigeben(id: number, ok: boolean): void {
  const wartende = vorrang.get(id)
  vorrang.delete(id)
  for (const w of wartende ?? []) w(ok)
}

/** Beim Beenden: jeder wartende Abruf bekommt „nicht vorhanden“. */
export function vorschauenBeenden(): void {
  for (const id of [...vorrang.keys()]) freigeben(id, false)
}

export function vorschauenAnstossen(): void {
  if (!u || u.beendet()) return
  if (laeuft) {
    nochmal = true
    return
  }
  void arbeiten()
}

async function arbeiten(): Promise<void> {
  laeuft = true
  try {
    do {
      nochmal = false
      await runde()
    } while (nochmal && u && !u.beendet())
  } catch (err) {
    logLine('[vorschau] Fehler in der Warteschlange:', String(err))
  } finally {
    laeuft = false
    if (!u || u.beendet()) vorschauenBeenden()
    else {
      u.melden()
      // während der letzten Runde dazugekommen (Abruf nach dem Ende der Schleife)
      if (vorrang.size) vorschauenAnstossen()
    }
  }
}

/**
 * Eine Runde: erst alle Abrufe, dann der Hintergrund ab `nachId` – eine Datei, die gerade nicht
 * ging (gesperrt, Zeitlimit, Absturz), kommt erst in der nächsten Runde wieder.
 */
async function runde(): Promise<void> {
  const t0 = Date.now()
  const n = vorschauParallel()
  let nachId = 0
  /** in dieser Runde schon versucht (Ausschnitt): eine gerade gesperrte Datei nicht im Kreis */
  const versucht = new Set<number>()
  let erzeugt = 0
  for (;;) {
    if (!u || u.beendet()) return
    let zeilen: repo.VorschauZeile[]
    if (vorrang.size) {
      const ids = [...vorrang.keys()].slice(0, n)
      zeilen = repo.vorschauZeilen(u.db(), ids)
      const da = new Set(zeilen.map((z) => z.id))
      for (const id of ids) if (!da.has(id)) freigeben(id, false)
      if (!zeilen.length) continue
    } else {
      // sichtbarer Ausschnitt vor dem übrigen Hintergrund (Skill bibliothek-index)
      const sichtbar = ausschnitt.length
        ? repo
            .vorschauOffenUnter(u.db(), ausschnitt)
            .filter((z) => !versucht.has(z.id))
            .slice(0, n)
        : []
      if (sichtbar.length) {
        zeilen = sichtbar
        for (const z of zeilen) versucht.add(z.id)
      } else {
        zeilen = repo.vorschauOffen(u.db(), n, nachId, u.nichtErreichbar())
        if (!zeilen.length) break
        nachId = zeilen[zeilen.length - 1].id
      }
    }
    erzeugt += await bearbeiten(zeilen)
    u?.melden(false)
    // an die Ereignisschleife abgeben, damit IPC und thumb:// dazwischen antworten
    await new Promise((r) => setImmediate(r))
  }
  if (erzeugt) logLine(`[vorschau] ${erzeugt} Vorschaubilder erzeugt, ${Date.now() - t0} ms`)
}

/**
 * Ein Auftrag an den Bilddienst. Stirbt er dabei oder hängt er, wird einzeln nachgefragt – so
 * trifft der Fehler nur die Datei, die ihn auslöst; stürzt er zum zweiten Mal an derselben
 * Datei ab, gilt sie als defekt (Skill bibliothek-index). null = aufhören (App wird beendet).
 */
async function erzeugen(dateien: VorschauDatei[]): Promise<VorschauErgebnis[] | null> {
  try {
    return await bilddienst.vorschau(dateien)
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code ?? 'UNBEKANNT'
    if (code === 'ABGEBROCHEN' || !u || u.beendet()) return null
    logLine(`[vorschau] Auftrag gescheitert (${code}, ${dateien.length} Dateien)`)
    if (dateien.length === 1) {
      const id = dateien[0].id
      const mal = (abstuerze.get(id) ?? 0) + 1
      abstuerze.set(id, mal)
      return [{ id, ok: false, code: mal >= 2 ? 'DEFEKT' : code }]
    }
    const einzeln: VorschauErgebnis[] = []
    for (const d of dateien) {
      const r = await erzeugen([d])
      if (!r) return null
      einzeln.push(...r)
    }
    return einzeln
  }
}

/** Stapel erzeugen und eintragen; liefert die Zahl der fertigen Vorschaubilder. */
async function bearbeiten(zeilen: repo.VorschauZeile[]): Promise<number> {
  const dateien: VorschauDatei[] = zeilen.map((z) => ({
    id: z.id,
    pfad: join(z.ordner, ...z.rel_path.split('/')),
    ordner: z.ordner,
    size: z.size,
    mtime: z.mtime,
    format: z.format ?? z.ext,
    ziel: z.mode === 'privat' ? 'speicher' : 'platte'
  }))
  const ergebnisse = await erzeugen(dateien)
  if (!ergebnisse || !u || u.beendet()) {
    for (const z of zeilen) freigeben(z.id, false)
    return 0
  }
  const nachId = new Map(ergebnisse.map((e) => [e.id, e]))
  const schreiben: Parameters<typeof repo.vorschauSchreiben>[1][number][] = []
  const codes = new Map<string, number>()
  for (const z of zeilen) {
    const e = nachId.get(z.id)
    if (!e) continue
    if (e.ok) {
      abstuerze.delete(z.id)
      if (e.gross && e.klein) {
        speicherAblegen(z.id, z.size, z.mtime, { gross: e.gross, klein: e.klein })
      }
      // „privat“ bleibt offen (nichts auf der Platte), bekommt aber seine Farbe
      const zustand = z.mode === 'privat' ? null : 'ok'
      schreiben.push({ id: z.id, size: z.size, mtime: z.mtime, zustand, farbe: e.farbe })
    } else {
      codes.set(e.code, (codes.get(e.code) ?? 0) + 1)
      const zustand = BLEIBEND.get(e.code)
      if (zustand) schreiben.push({ id: z.id, size: z.size, mtime: z.mtime, zustand, farbe: null })
    }
  }
  const geschrieben = repo.vorschauSchreiben(u.db(), schreiben)
  // Ergebnis auf der Platte, das nicht mehr gilt: Datei inzwischen geändert, Ordner entfernt
  // oder inzwischen „privat“ – die Cache-Dateien wieder weg
  const aufPlatte = dateien.filter((d) => d.ziel === 'platte' && nachId.get(d.id)?.ok)
  const jetzt = new Map(
    repo
      .vorschauZeilen(
        u.db(),
        aufPlatte.map((d) => d.id)
      )
      .map((z) => [z.id, z])
  )
  const verwerfen = aufPlatte
    .filter((d) => !geschrieben.has(d.id) || (jetzt.get(d.id)?.mode ?? 'privat') === 'privat')
    .map((d) => d.id)
  if (verwerfen.length) await vorschauDateienLoeschen(verwerfen)
  if (codes.size) {
    // nur Codes und Anzahl – keine Pfade, keine Namen (Log ohne Inhalte)
    logLine('[vorschau] nicht erzeugt:', [...codes].map(([c, n]) => `${c} ×${n}`).join(', '))
  }
  for (const z of zeilen) freigeben(z.id, Boolean(nachId.get(z.id)?.ok))
  return ergebnisse.filter((e) => e.ok).length - verwerfen.length
}

// ── Abruf (thumb://) ──────────────────────────────────────────────────────────────────────────

/** Vorschaubild mit Vorrang erzeugen lassen; true, wenn es danach da ist. */
function anfordern(id: number): Promise<boolean> {
  if (!u || u.beendet()) return Promise.resolve(false)
  return new Promise((resolve) => {
    vorrang.set(id, [...(vorrang.get(id) ?? []), resolve])
    // ohne Antwort aufgeben – die Erzeugung läuft weiter, der nächste Abruf findet sie
    setTimeout(() => resolve(false), ABRUF_MS).unref()
    vorschauenAnstossen()
  })
}

/**
 * Vorschaubild für thumb://: aus dem Cache (geprüft), bei „privat“ aus dem Arbeitsspeicher; fehlt
 * es, entsteht es sofort mit Vorrang. null = Kennung unbekannt (oder Datei fehlt); 'keins' = das
 * Bild ist bekannt, hat aber keine Vorschau (defekt, zu groß, gerade nicht lesbar).
 */
export async function vorschauHolen(
  id: number,
  stufe: Stufe
): Promise<Uint8Array | 'keins' | null> {
  if (!u || u.beendet()) return null
  const db = u.db()
  const holen = async (z: repo.VorschauZeile): Promise<Uint8Array | null> =>
    z.mode === 'privat'
      ? speicherLesen(z.id, stufe, z.size, z.mtime)
      : vorschauLesen(z.id, stufe, z.size, z.mtime)
  const [z] = repo.vorschauZeilen(db, [id])
  if (!z) return null
  const da = await holen(z)
  if (da) return da
  // nicht wieder versuchen, bis sich die Datei ändert
  if (z.thumb_state && z.thumb_state !== 'ok') return 'keins'
  if (!(await anfordern(id)) || !u || u.beendet()) return 'keins'
  const [neu] = repo.vorschauZeilen(u.db(), [id])
  return (neu && (await holen(neu))) ?? 'keins'
}

// ── Ordner ────────────────────────────────────────────────────────────────────────────────────

/** Ordner entfernt: Cache-Dateien und Arbeitsspeicher seiner Bilder weg (Kennungen von vorher). */
export async function vorschauVerwerfen(ids: readonly number[]): Promise<void> {
  speicherVerwerfen(ids)
  await vorschauDateienLoeschen(ids)
}

/** Ordner wird „privat“: nichts mehr auf der Platte; ab jetzt nur noch im Arbeitsspeicher. */
export async function ordnerWirdPrivat(db: DB, folderId: number): Promise<void> {
  repo.vorschauZuruecksetzen(db, folderId)
  await vorschauDateienLoeschen(repo.ordnerKennungen(db, folderId))
}

/** Ordner ist nicht mehr „privat“: Arbeitsspeicher frei, der Hintergrund legt den Cache an. */
export function ordnerNichtMehrPrivat(db: DB, folderId: number): void {
  repo.vorschauZuruecksetzen(db, folderId)
  speicherVerwerfen(repo.ordnerKennungen(db, folderId))
  vorschauenAnstossen()
}
