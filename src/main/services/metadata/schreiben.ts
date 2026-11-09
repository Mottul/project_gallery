// Metadaten schreiben aus Sicht des main (Phase 3, Skill metadaten-schreiben): prüft die Freigabe,
// hält die alten Werte im Journal fest, plant die Sicherung und reicht den Auftrag an den Bilddienst
// weiter; der schreibt und prüft nach (bilddienst/schreiben.ts). Aufträge laufen nacheinander, so
// sieht jeder den Stand, den der vorige hinterlassen hat. Eine Sicherung je Datei, im Ordner „privat“
// keine, Frist 30 Tage (entschieden 30.10.2026). Ins Log nur Kennungen und Codes (Schicht D).
// Für die Mehrfachauswahl (3.3) gibt es dieselben Schritte je Datei (`dateiAendern`, `dateienLesen`,
// `zeileZuruecknehmen`): Der Auftrag in mehrfach.ts reiht sie einzeln ein, so kommen andere Aufträge
// dazwischen dran, und Abbrechen hält nach der laufenden Datei an.

import { rm, rmdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { STICHWORT_MAX } from '@shared/grundfelder'
import {
  alteWerte,
  pruefeMetaAenderung,
  schreibbar,
  tagsFuer,
  werteAus,
  WERTE_TAGS,
  type MetaAenderung,
  type MetaWerte,
  type SchreibBericht,
  type TagWert
} from '@shared/metaFields'
import { aenderungFuer, type DateiErgebnis, type MehrfachAenderung } from '@shared/metaMehrfach'
import type { ImageInfo } from '@shared/types'
import { zwischenName } from '@shared/scanRegeln'
import { bilddienst } from '../bilddienst/client'
import type { AnzeigeDatei, SchreibErgebnis } from '../bilddienst/protokoll'
import type { DB } from '../db'
import * as repo from '../library/repo'
import { logLine } from '../log'
import { sicherungsOrdner } from '../lokaleDaten'
import { freierPlatz, platzHinweis } from './platz'

const TAG_MS = 86_400_000
/** So lange bleiben Sicherungen und Journal-Zeilen */
export const SICHERUNG_TAGE = 30
/** So lange wartet „erneut versuchen“ höchstens auf den Abgleich der Dateien */
const ABGLEICH_WARTEN_MS = 30_000

export interface Umgebung {
  db: () => DB
  /** Die Datei ist geschrieben: Index, Vorschaubild und Oberfläche nachziehen */
  geschrieben: (id: number, ergebnis: Extract<SchreibErgebnis, { ok: true }>) => Promise<void>
  /** Die Datei passt nicht mehr zum Index: sie im Index abgleichen */
  abgleichen: (folderId: number, relPfad: string) => void
  /** Bis die Abgleiche dieser Ordner durch sind (höchstens `ms`) */
  abgleichAbwarten: (ordner: readonly number[], ms: number) => Promise<void>
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
  ['KEIN_EXIFTOOL', 'ExifTool fehlt.'],
  ['UNLESBAR', 'Die Metadaten der Datei ließen sich nicht lesen.']
])
const grundZu = (code: string): string =>
  GRUENDE.get(code) ?? 'Die Datei ließ sich nicht schreiben – sie bleibt, wie sie ist.'
/** In der Mehrfachauswahl steht der Konflikt als Status da – der Hinweis sagt, was geschah */
const KONFLIKT = 'Inzwischen außerhalb geändert – übersprungen.'

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

const dateiVon = (z: repo.VorschauZeile): AnzeigeDatei => ({
  pfad: join(z.ordner, ...z.rel_path.split('/')),
  ordner: z.ordner,
  size: z.size,
  mtime: z.mtime
})

interface EinErgebnis {
  journal?: number
  grund?: string
  /** warum nicht (GEAENDERT, VERWEIGERT, SEITHER …) */
  code?: string
  /** geschrieben: Sicherung jetzt angelegt, schon vorhanden oder keine (privat) */
  sicherung?: 'neu' | 'vorhanden' | 'keine'
}

async function eineDatei(
  z: repo.VorschauZeile,
  action: string,
  tags: readonly TagWert[],
  vorherFest?: readonly TagWert[]
): Promise<EinErgebnis> {
  const { db, geschrieben, abgleichen } = env()
  const datei = dateiVon(z)
  const jetzt = Date.now()
  let journal: number | null = null
  try {
    const vorher =
      vorherFest ?? alteWerte(tags, (await bilddienst.tagsLesen(datei, tags.map(ohneWert))) ?? {})
    // nach dem Warten frisch: Der Ordner kann inzwischen „nur lesen“ oder „privat“ sein
    const [frisch] = repo.vorschauZeilen(db(), [z.id])
    const nein = frisch ? verweigert(frisch) : 'Die Datei gibt es nicht mehr.'
    if (!frisch || nein) return { grund: nein as string, code: frisch ? 'VERWEIGERT' : 'ENOENT' }
    journal = repo.journalAnlegen(db(), {
      at: jetzt,
      action,
      imageId: z.id,
      vorher,
      nachher: tags,
      zwischen: 'offen'
    })
    const zwischen = zwischenName(datei.pfad, journal)
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
    return {
      journal,
      sicherung: sicherung ? 'neu' : frisch.mode === 'privat' ? 'keine' : 'vorhanden'
    }
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code ?? 'SCHREIBFEHLER'
    logLine(`[metadaten] Bild ${z.id} nicht geschrieben: ${code}`)
    if (UNKLAR.has(code)) return { grund: grundZu(code), code }
    if (journal !== null) repo.journalVerwerfen(db(), journal)
    if (code === 'GEAENDERT') abgleichen(z.folder_id, z.rel_path)
    return { grund: grundZu(code), code }
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

/** Das Ergebnis eines Schritts als Status der Mehrfachauswahl */
function alsStatus(z: repo.VorschauZeile, r: EinErgebnis): DateiErgebnis {
  if (r.journal !== undefined) return { id: z.id, status: 'geschrieben', sicherung: r.sicherung }
  const grund = r.grund ?? grundZu('SCHREIBFEHLER')
  if (r.code === 'GEAENDERT') return { id: z.id, status: 'konflikt', name: z.name, grund: KONFLIKT }
  if (r.code === 'SEITHER') return { id: z.id, status: 'konflikt', name: z.name, grund }
  if (r.code === 'VERWEIGERT') return { id: z.id, status: 'abgelehnt', name: z.name, grund }
  return { id: z.id, status: 'fehler', name: z.name, grund }
}

/** Die bearbeitbaren Felder einer Datei, frisch gelesen; nimmt die Warteschlange mit. */
export function metaLesen(id: number): Promise<{ werte: MetaWerte } | { grund: string }> {
  return nacheinander(async () => {
    const [z] = repo.vorschauZeilen(env().db(), [id])
    if (!z) return { grund: 'Die Datei gibt es nicht mehr.' }
    try {
      const r = await bilddienst.tagsLesen(dateiVon(z), [...WERTE_TAGS])
      if (!r) return { grund: grundZu('SCHREIBFEHLER') }
      return { werte: werteAus(r) }
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code ?? 'UNBEKANNT'
      if (code === 'GEAENDERT') env().abgleichen(z.folder_id, z.rel_path)
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

/** Eine Journal-Zeile zurücknehmen – nur, wenn die Datei noch so ist, wie der Auftrag sie hinterließ. */
async function zuruecknehmenEine(
  id: number
): Promise<{ z: repo.VorschauZeile | null; imageId: number; r: EinErgebnis } | null> {
  const { db } = env()
  const j = repo.journalHolen(db(), id)
  if (!j || j.undone_at !== null) return null
  const [z] = repo.vorschauZeilen(db(), [j.image_id])
  if (!z) return { z: null, imageId: j.image_id, r: { grund: grundZu('ENOENT'), code: 'ENOENT' } }
  const nein = verweigert(z)
  const seither = z.size !== j.size_nach || z.mtime !== j.mtime_nach
  const r = nein
    ? { grund: nein, code: 'VERWEIGERT' }
    : seither
      ? { grund: 'Die Datei wurde seither geändert – nicht zurückgenommen.', code: 'SEITHER' }
      : await eineDatei(z, 'rueckgaengig', j.vorher, j.nachher)
  if (r.journal !== undefined) repo.journalZurueckgenommen(db(), id, Date.now())
  return { z, imageId: j.image_id, r }
}

/**
 * Journal-Zeilen zurücknehmen: die alten Werte über denselben Weg schreiben, in umgekehrter
 * Reihenfolge. Nur, wenn die Datei noch so ist, wie der Auftrag sie hinterließ.
 */
export function metaRueckgaengig(journal: readonly number[]): Promise<SchreibBericht<ImageInfo>> {
  return nacheinander(async () => {
    const ergebnisse: { z: repo.VorschauZeile; r: EinErgebnis }[] = []
    for (const id of [...journal].reverse()) {
      const e = await zuruecknehmenEine(id)
      if (e?.z) ergebnisse.push({ z: e.z, r: e.r })
    }
    return bericht(ergebnisse)
  })
}

// ── Mehrfachauswahl (3.3): je Datei ein Schritt der Warteschlange ─────────────────────────────

/**
 * Eine Datei der Mehrfachauswahl ändern: frisch lesen, daraus ihre Änderung bilden (nur, was sich
 * dort ändert; Stichwörter dazu/weg aus ihrer eigenen Liste), dann der Weg wie oben. Hat die Datei
 * schon alles so, bleibt sie unberührt – keine Sicherung, kein neues Änderungsdatum.
 */
export function dateiAendern(
  id: number,
  m: MehrfachAenderung
): Promise<{ ergebnis: DateiErgebnis; journal?: number }> {
  return nacheinander(async () => {
    const [z] = repo.vorschauZeilen(env().db(), [id])
    if (!z) return { ergebnis: { id, status: 'fehler', grund: grundZu('ENOENT') } }
    const nein = verweigert(z)
    if (nein) return { ergebnis: { id, status: 'abgelehnt', name: z.name, grund: nein } }
    let ist: Record<string, unknown> | null
    try {
      ist = await bilddienst.tagsLesen(dateiVon(z), [...WERTE_TAGS])
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code ?? 'UNBEKANNT'
      logLine(`[metadaten] Bild ${z.id} nicht gelesen: ${code}`)
      if (code === 'GEAENDERT') env().abgleichen(z.folder_id, z.rel_path)
      return { ergebnis: alsStatus(z, { grund: grundZu(code), code }) }
    }
    if (!ist) return { ergebnis: alsStatus(z, { grund: grundZu('UNLESBAR'), code: 'UNLESBAR' }) }
    const a = aenderungFuer(werteAus(ist), m)
    if (!a) return { ergebnis: { id, status: 'unveraendert' } }
    // was aus der Datei kommt, muss dieselbe Prüfung bestehen wie eine Eingabe
    if (!pruefeMetaAenderung(a)) {
      const zuViele = (a.stichwoerter?.length ?? 0) > STICHWORT_MAX
      const grund = zuViele
        ? `Mehr als ${STICHWORT_MAX} Stichwörter – nicht geschrieben.`
        : 'Ein Stichwort der Datei lässt sich nicht übernehmen (zu lang oder mit „;“).'
      return { ergebnis: { id, status: 'fehler', name: z.name, grund } }
    }
    const tags = tagsFuer(a, z.format as string)
    const r = await eineDatei(z, 'metadaten', tags, alteWerte(tags, ist))
    return { ergebnis: alsStatus(z, r), journal: r.journal }
  })
}

/**
 * Viele Dateien für die gemischten Werte lesen (ein Schritt für einen Teil der Auswahl). Nur
 * beschreibbare fließen ein – die Ansicht zeigt, was sich ändern lässt; die übrigen kommen mit Grund.
 */
export function dateienLesen(
  ids: readonly number[]
): Promise<{ ergebnisse: DateiErgebnis[]; werte: MetaWerte[] }> {
  return nacheinander(async () => {
    const zeilen = new Map(repo.vorschauZeilen(env().db(), ids).map((z) => [z.id, z]))
    const ergebnisse: DateiErgebnis[] = []
    const werte: MetaWerte[] = []
    const lesen: repo.VorschauZeile[] = []
    for (const id of ids) {
      const z = zeilen.get(id)
      const nein = z ? verweigert(z) : grundZu('ENOENT')
      if (!z) ergebnisse.push({ id, status: 'fehler', grund: nein as string })
      else if (nein) ergebnisse.push({ id, status: 'abgelehnt', name: z.name, grund: nein })
      else lesen.push(z)
    }
    if (!lesen.length) return { ergebnisse, werte }
    try {
      const r = await bilddienst.tagsLesenViele(lesen.map(dateiVon), [...WERTE_TAGS])
      lesen.forEach((z, i) => {
        const e = r[i]
        if (e?.werte) {
          werte.push(werteAus(e.werte))
          ergebnisse.push({ id: z.id, status: 'gelesen' })
          return
        }
        const code = e?.code ?? 'UNLESBAR'
        if (code === 'GEAENDERT') env().abgleichen(z.folder_id, z.rel_path)
        ergebnisse.push(alsStatus(z, { grund: grundZu(code), code }))
      })
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code ?? 'UNBEKANNT'
      logLine(`[metadaten] ${lesen.length} Dateien nicht gelesen: ${code}`)
      for (const z of lesen) ergebnisse.push(alsStatus(z, { grund: grundZu(code), code }))
    }
    return { ergebnisse, werte }
  })
}

/** Eine Journal-Zeile zurücknehmen (ein Schritt); null = gibt es nicht oder schon zurückgenommen. */
export function zeileZuruecknehmen(journal: number): Promise<DateiErgebnis | null> {
  return nacheinander(async () => {
    const e = await zuruecknehmenEine(journal)
    if (!e) return null
    if (!e.z) return { id: e.imageId, status: 'fehler', grund: e.r.grund }
    return alsStatus(e.z, e.r)
  })
}

/**
 * Reicht der Platz für die Sicherungen dieser Bilder? null = ja (oder nicht messbar); sonst der
 * Hinweis. Gezählt wird, was eine Sicherung bekäme: beschreibbar, nicht „privat“, noch keine.
 */
export async function platzFuerSicherungen(ids: readonly number[]): Promise<string | null> {
  const { db } = env()
  const vorhanden = repo.mitSicherung(db(), ids)
  const noetig = repo
    .vorschauZeilen(db(), ids)
    .filter((z) => !verweigert(z) && z.mode !== 'privat' && !vorhanden.has(z.id))
    .reduce((s, z) => s + z.size, 0)
  if (!noetig) return null
  return platzHinweis(noetig, await freierPlatz(sicherungsOrdner()))
}

/** „Neu lesen und erneut versuchen“: diese Dateien im Index abgleichen und darauf warten. */
export async function abgleichFuer(ids: readonly number[]): Promise<void> {
  const zeilen = repo.vorschauZeilen(env().db(), ids)
  for (const z of zeilen) env().abgleichen(z.folder_id, z.rel_path)
  await env().abgleichAbwarten([...new Set(zeilen.map((z) => z.folder_id))], ABGLEICH_WARTEN_MS)
}

// ── Aufräumen ─────────────────────────────────────────────────────────────────────────────────

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
