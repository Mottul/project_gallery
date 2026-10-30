// Metadaten schreiben aus Sicht des main (Phase 3, Skill metadaten-schreiben): prüft die Freigabe,
// hält die alten Werte im Journal fest, plant die Sicherung und reicht den Auftrag an den Bilddienst
// weiter; der schreibt und prüft nach (bilddienst/schreiben.ts). Aufträge laufen nacheinander, so
// sieht jeder den Stand, den der vorige hinterlassen hat. Eine Sicherung je Datei, im Ordner „privat“
// keine, Frist 30 Tage (entschieden 30.10.2026). Ins Log nur Kennungen und Codes (Schicht D).

import { rm, rmdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import {
  alteWerte,
  schreibbar,
  tagsFuer,
  werteAus,
  WERTE_TAGS,
  type MetaAenderung,
  type MetaWerte,
  type SchreibBericht,
  type TagWert
} from '@shared/metaFields'
import type { ImageInfo } from '@shared/types'
import { zwischenName } from '@shared/scanRegeln'
import { bilddienst } from '../bilddienst/client'
import type { SchreibErgebnis } from '../bilddienst/protokoll'
import type { DB } from '../db'
import * as repo from '../library/repo'
import { logLine } from '../log'
import { sicherungsOrdner } from '../lokaleDaten'

const TAG_MS = 86_400_000
/** So lange bleiben Sicherungen und Journal-Zeilen */
export const SICHERUNG_TAGE = 30

export interface Umgebung {
  db: () => DB
  /** Die Datei ist geschrieben: Index, Vorschaubild und Oberfläche nachziehen */
  geschrieben: (id: number, ergebnis: Extract<SchreibErgebnis, { ok: true }>) => Promise<void>
  /** Die Datei passt nicht mehr zum Index: den Ordner abgleichen */
  abgleichen: (folderId: number) => void
  details: (ids: readonly number[]) => ImageInfo[]
}

let umgebung: Umgebung | null = null

export function schreibenEinrichten(u: Umgebung): void {
  umgebung = u
}

function env(): Umgebung {
  if (!umgebung) throw new Error('Schreiben nicht eingerichtet')
  return umgebung
}

/** Was der Nutzer zu einem Code liest */
const GRUENDE = new Map<string, string>([
  [
    'GEAENDERT',
    'Die Datei wurde von außen geändert. Sie wird neu eingelesen, bitte noch einmal versuchen.'
  ],
  ['ENOENT', 'Die Datei gibt es nicht mehr.'],
  ['SCHREIBGESCHUETZT', 'Die Datei ist schreibgeschützt.'],
  ['GESPERRT', 'Ein anderes Programm hat die Datei gerade geöffnet.'],
  ['AUSSERHALB', 'Die Datei liegt außerhalb des Ordners.'],
  ['ZEITLIMIT', 'Der Ordner antwortet nicht.'],
  ['DIENST_BEENDET', 'Das Schreiben wurde unterbrochen – bitte die Datei prüfen.'],
  ['ABGEBROCHEN', 'Das Schreiben wurde unterbrochen – bitte die Datei prüfen.'],
  ['SICHERUNG', 'Die Sicherung ließ sich nicht anlegen – die Datei bleibt, wie sie ist.'],
  ['ABWEICHUNG', 'Die Werte standen danach nicht richtig in der Datei – sie bleibt, wie sie ist.'],
  ['PIXEL', 'Die Bilddaten hätten sich geändert – die Datei bleibt, wie sie ist.'],
  ['KEIN_EXIFTOOL', 'ExifTool fehlt.']
])
const grundZu = (code: string): string =>
  GRUENDE.get(code) ?? 'Die Datei ließ sich nicht schreiben – sie bleibt, wie sie ist.'

let kette: Promise<unknown> = Promise.resolve()

/** Aufträge nacheinander: Ein Fehler in einem hält den nächsten nicht auf. */
function nacheinander<T>(f: () => Promise<T>): Promise<T> {
  const lauf = kette.then(f, f)
  kette = lauf.catch(() => undefined)
  return lauf
}

/** Warum diese Datei nicht geschrieben werden darf; null = sie darf. */
function verweigert(z: repo.VorschauZeile): string | null {
  if (z.mode === 'nur-lesen') return 'Der Ordner steht auf „nur lesen“.'
  if (z.status !== 'ok') return 'Die Datei ist defekt.'
  if (z.format === null) return 'Die Metadaten der Datei werden noch gelesen.'
  if (!schreibbar(z.format))
    return `In ${z.format.toUpperCase()}-Dateien lässt sich nichts schreiben.`
  return null
}

/** Pfad der Sicherung, wenn für dieses Bild eine fällig ist; Name wie im Ordner des Nutzers. */
function sicherungPlanen(db: DB, z: repo.VorschauZeile, jetzt: number): string | null {
  if (z.mode === 'privat' || repo.sicherungVorhanden(db, z.id)) return null
  const tag = new Date(jetzt).toISOString().slice(0, 10)
  return join(sicherungsOrdner(), tag, `${z.id}-${z.mtime}-${z.name}`)
}

interface EinErgebnis {
  journal?: number
  grund?: string
}

async function eineDatei(
  z: repo.VorschauZeile,
  action: string,
  tags: readonly TagWert[],
  vorherFest?: readonly TagWert[]
): Promise<EinErgebnis> {
  const { db, geschrieben, abgleichen } = env()
  const pfad = join(z.ordner, ...z.rel_path.split('/'))
  const datei = { pfad, ordner: z.ordner, size: z.size, mtime: z.mtime }
  const jetzt = Date.now()
  let journal: number | null = null
  try {
    const vorher =
      vorherFest ?? alteWerte(tags, (await bilddienst.tagsLesen(datei, tags.map(ohneWert))) ?? {})
    // nach dem Warten frisch: Der Ordner kann inzwischen „nur lesen“ oder „privat“ sein
    const [frisch] = repo.vorschauZeilen(db(), [z.id])
    const nein = frisch ? verweigert(frisch) : 'Die Datei gibt es nicht mehr.'
    if (!frisch || nein) return { grund: nein as string }
    journal = repo.journalAnlegen(db(), {
      at: jetzt,
      action,
      imageId: z.id,
      vorher,
      nachher: tags,
      zwischen: 'offen'
    })
    const zwischen = zwischenName(pfad, journal)
    repo.journalZwischen(db(), journal, zwischen)
    const sicherung = sicherungPlanen(db(), frisch, jetzt)
    const r = await bilddienst.schreiben({ datei, tags: [...tags], sicherung, zwischen })
    if (!r.ok) throw Object.assign(new Error(r.code), { code: r.code })
    repo.journalFertig(db(), journal, r.size, r.mtime)
    if (sicherung) {
      repo.sicherungEintragen(db(), {
        imageId: z.id,
        folderId: z.folder_id,
        pfad: sicherung,
        at: jetzt
      })
    }
    await geschrieben(z.id, r)
    logLine(`[metadaten] Bild ${z.id} geschrieben (${tags.length} Tags)`)
    return { journal }
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code ?? 'SCHREIBFEHLER'
    logLine(`[metadaten] Bild ${z.id} nicht geschrieben: ${code}`)
    if (UNKLAR.has(code)) return { grund: grundZu(code) }
    if (journal !== null) repo.journalVerwerfen(db(), journal)
    if (code === 'GEAENDERT') abgleichen(z.folder_id)
    return { grund: grundZu(code) }
  }
}

/**
 * Ob geschrieben wurde, ist offen: Der Dienst ist weg oder die App wird beendet. Die Journal-Zeile
 * bleibt offen, der nächste Start räumt die Nachbardatei weg. Beim Beenden ist der Index schon zu.
 */
const UNKLAR = new Set(['ABGEBROCHEN', 'DIENST_BEENDET', 'ZEITLIMIT'])

/** Fürs Lesen zählt nur der Tag-Name */
const ohneWert = ({ tag }: TagWert): TagWert => ({ tag, wert: null })

function bericht(
  ergebnisse: readonly { z: repo.VorschauZeile; r: EinErgebnis }[]
): SchreibBericht<ImageInfo> {
  const ok = ergebnisse.filter((e) => e.r.journal !== undefined)
  return {
    geschrieben: env().details(ok.map((e) => e.z.id)),
    fehler: ergebnisse
      .filter((e) => e.r.grund !== undefined)
      .map((e) => ({ id: e.z.id, name: e.z.name, grund: e.r.grund as string })),
    journal: ok.map((e) => e.r.journal as number)
  }
}

/** Die bearbeitbaren Felder einer Datei, frisch gelesen; nimmt die Warteschlange mit. */
export function metaLesen(id: number): Promise<{ werte: MetaWerte } | { grund: string }> {
  return nacheinander(async () => {
    const [z] = repo.vorschauZeilen(env().db(), [id])
    if (!z) return { grund: 'Die Datei gibt es nicht mehr.' }
    const pfad = join(z.ordner, ...z.rel_path.split('/'))
    const datei = { pfad, ordner: z.ordner, size: z.size, mtime: z.mtime }
    try {
      const r = await bilddienst.tagsLesen(datei, [...WERTE_TAGS])
      if (!r) return { grund: grundZu('SCHREIBFEHLER') }
      return { werte: werteAus(r) }
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code ?? 'UNBEKANNT'
      if (code === 'GEAENDERT') env().abgleichen(z.folder_id)
      return { grund: grundZu(code) }
    }
  })
}

/** Metadaten dieser Bilder ändern; jede Datei für sich, ein Fehler hält den Rest nicht auf. */
export function metaAendern(
  ids: readonly number[],
  a: MetaAenderung
): Promise<SchreibBericht<ImageInfo>> {
  return nacheinander(async () => {
    const ergebnisse: { z: repo.VorschauZeile; r: EinErgebnis }[] = []
    for (const id of ids) {
      // je Datei frisch aus dem Index: Der vorige Auftrag kann sie geändert haben
      const [z] = repo.vorschauZeilen(env().db(), [id])
      if (!z) continue
      const grund = verweigert(z)
      const r = grund ? { grund } : await eineDatei(z, 'metadaten', tagsFuer(a, z.format as string))
      ergebnisse.push({ z, r })
    }
    return bericht(ergebnisse)
  })
}

/**
 * Journal-Zeilen zurücknehmen: die alten Werte über denselben Weg schreiben, in umgekehrter
 * Reihenfolge. Nur, wenn die Datei noch so ist, wie der Auftrag sie hinterließ.
 */
export function metaRueckgaengig(journal: readonly number[]): Promise<SchreibBericht<ImageInfo>> {
  return nacheinander(async () => {
    const { db } = env()
    const ergebnisse: { z: repo.VorschauZeile; r: EinErgebnis }[] = []
    for (const id of [...journal].reverse()) {
      const j = repo.journalHolen(db(), id)
      if (!j || j.undone_at !== null) continue
      const [z] = repo.vorschauZeilen(db(), [j.image_id])
      if (!z) continue
      let grund = verweigert(z)
      if (!grund && (z.size !== j.size_nach || z.mtime !== j.mtime_nach)) {
        grund = 'Die Datei wurde seither geändert.'
      }
      const r = grund ? { grund } : await eineDatei(z, 'rueckgaengig', j.vorher, j.nachher)
      if (r.journal !== undefined) repo.journalZurueckgenommen(db(), id, Date.now())
      ergebnisse.push({ z, r })
    }
    return bericht(ergebnisse)
  })
}

/** Dateien der Sicherungen löschen, dann ihre Zeilen; leere Tagesordner gehen mit. */
async function sicherungenWeg(s: readonly { id: number; pfad: string }[]): Promise<void> {
  const tage = new Set(s.map((x) => dirname(x.pfad)))
  await Promise.all(s.map((x) => rm(x.pfad, { force: true }).catch(() => {})))
  for (const t of tage) await rmdir(t).catch(() => {})
  if (s.length)
    repo.sicherungenLoeschen(
      env().db(),
      s.map((x) => x.id)
    )
}

/**
 * Beim Start: Nachbardateien eines Absturzes wegräumen, abgelaufene Sicherungen und alte
 * Journal-Zeilen löschen. Eine offene Zeile lässt sich nicht mehr zuordnen und gilt nicht.
 */
export async function schreibenAufraeumen(jetzt = Date.now()): Promise<void> {
  const { db } = env()
  const offen = repo.journalOffene(db())
  if (offen.length) {
    bilddienst.zwischenWeg(offen.map((o) => o.zwischen))
    for (const o of offen) repo.journalVerwerfen(db(), o.id)
    logLine(`[metadaten] ${offen.length} unterbrochene Aufträge aufgeräumt`)
  }
  const frist = jetzt - SICHERUNG_TAGE * TAG_MS
  await sicherungenWeg(repo.sicherungenAelterAls(db(), frist))
  repo.journalAelterAls(db(), frist)
}

/** Ordner entfernt oder „privat“ geworden: Von seinen Bildern bleibt keine Kopie zurück. */
export function sicherungenDesOrdnersWeg(folderId: number): Promise<void> {
  return sicherungenWeg(repo.sicherungenVonOrdner(env().db(), folderId))
}
