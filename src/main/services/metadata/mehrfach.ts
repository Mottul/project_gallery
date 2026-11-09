// Aufträge der Mehrfachauswahl (Phase 3.3; Skills metadaten-schreiben, ipc-kanal): gemischte Werte
// lesen, eine Änderung in viele Dateien schreiben, einen ganzen Auftrag zurücknehmen. Höchstens einer
// zur Zeit. Der Start antwortet sofort mit der Kennung; Fortschritt und Bericht kommen als Ereignis
// (`melden`, gedrosselt) – nie lange in einem invoke warten. Je Datei ein Schritt der Warteschlange
// (schreiben.ts): Andere Aufträge kommen dazwischen dran, Abbrechen hält nach der laufenden Datei an,
// Geschriebenes bleibt (je Datei atomar) und steht im Bericht. Vor dem Schreiben: Platz für die
// Sicherungen aller Dateien zusammen, bei der Schnellbewertung im Raster eine Rückfrage. Getestet in
// mehrfach.test.ts. Ins Log nur Kennungen und Anzahlen (Schicht D).

import { dialog, type BrowserWindow } from 'electron'
import type { MetaWerte } from '@shared/metaFields'
import {
  rueckfrageText,
  zusammenfassen,
  type AuftragArt,
  type AuftragEnde,
  type AuftragStand,
  type AuftragStart,
  type DateiErgebnis,
  type MehrfachAenderung,
  type MehrfachWerte,
  type SchreibOptionen
} from '@shared/metaMehrfach'
import { logLine } from '../log'
import {
  abgleichFuer,
  dateiAendern,
  dateienLesen,
  platzFuerSicherungen,
  zeileZuruecknehmen
} from './schreiben'

/** Höchstens so oft eine Meldung (die letzte kommt immer) */
const MELDEN_MS = 100
/** Dateien je Leseschritt: ExifTool liest sie in Teilen zu 50 auf dem ganzen Pool */
const LESE_TEIL = 200
export const BESCHAEFTIGT = 'Es läuft schon ein Auftrag – bitte warten oder ihn abbrechen.'

export type Melden = (stand: AuftragStand) => void

interface Lauf {
  auftrag: number
  art: AuftragArt
  abbruch: boolean
}

let laufend: Lauf | null = null
let naechster = 1
const nachEnde: (() => void)[] = []

/** Läuft gerade ein Auftrag, der schreibt? (Beenden der App fragt dann nach) */
export const schreibAuftragLaeuft = (): boolean => laufend !== null && laufend.art !== 'lesen'

/** Nach der laufenden Datei anhalten; ohne Kennung den laufenden Auftrag. */
export function auftragAbbrechen(auftrag?: number): void {
  if (laufend && (auftrag === undefined || laufend.auftrag === auftrag)) laufend.abbruch = true
}

/** `cb`, sobald kein Auftrag mehr läuft (sofort, wenn keiner läuft). */
export function wennKeinAuftrag(cb: () => void): void {
  if (laufend) nachEnde.push(cb)
  else cb()
}

/** Meldungen gedrosselt: neue Ergebnisse sammeln, höchstens alle MELDEN_MS schicken. */
class Fortschritt {
  fertig = 0
  private neu: DateiErgebnis[] = []
  private zuletzt = 0
  private uhr: NodeJS.Timeout | null = null

  constructor(
    private readonly lauf: Lauf,
    readonly gesamt: number,
    private readonly melden: Melden
  ) {}

  schritt(n: number, dateien: readonly DateiErgebnis[]): void {
    this.fertig += n
    for (const d of dateien) this.neu.push(d)
    this.uhr ??= setTimeout(() => this.senden(), Math.max(0, this.zuletzt + MELDEN_MS - Date.now()))
  }

  senden(ende?: AuftragEnde): void {
    if (this.uhr) clearTimeout(this.uhr)
    this.uhr = null
    this.zuletzt = Date.now()
    this.melden({
      auftrag: this.lauf.auftrag,
      art: this.lauf.art,
      fertig: this.fertig,
      gesamt: this.gesamt,
      dateien: this.neu.splice(0),
      ...(ende ? { ende } : {})
    })
  }
}

/** Was ein Auftrag bis zum Ende sammelt – auch, wenn er unterwegs scheitert */
interface Sammlung {
  dateien: DateiErgebnis[]
  journal: number[]
}

function starten(
  art: AuftragArt,
  gesamt: number,
  melden: Melden,
  arbeit: (lauf: Lauf, f: Fortschritt, s: Sammlung) => Promise<MehrfachWerte | void>
): AuftragStart {
  if (laufend) return { grund: BESCHAEFTIGT }
  const lauf: Lauf = { auftrag: naechster++, art, abbruch: false }
  laufend = lauf
  const f = new Fortschritt(lauf, gesamt, melden)
  const s: Sammlung = { dateien: [], journal: [] }
  const t0 = Date.now()
  // erst nach der Antwort auf den Start: Die Seite kennt die Kennung, bevor Meldungen kommen
  setImmediate(() => {
    void arbeit(lauf, f, s)
      .catch((err: NodeJS.ErrnoException) => {
        logLine(`[metadaten] Auftrag ${lauf.auftrag} gescheitert: ${err?.code ?? 'UNBEKANNT'}`)
        lauf.abbruch = true
      })
      .then((werte) => {
        const abgebrochen = lauf.abbruch && f.fertig < gesamt
        // frei, bevor das Ende gemeldet wird: Wer darauf den nächsten startet, wird nicht abgewiesen
        laufend = null
        f.senden({
          abgebrochen,
          dateien: s.dateien,
          journal: s.journal,
          ...(werte ? { werte } : {})
        })
        const zahl = (st: DateiErgebnis['status']): number =>
          s.dateien.filter((d) => d.status === st).length
        logLine(
          `[metadaten] Auftrag ${lauf.auftrag} (${art}): ${f.fertig} von ${gesamt} Dateien,`,
          `${zahl('geschrieben')} geschrieben, ${zahl('unveraendert')} unverändert,`,
          `${zahl('konflikt')} Konflikt, ${zahl('abgelehnt')} abgelehnt, ${zahl('fehler')} Fehler,`,
          `abgebrochen: ${abgebrochen ? 'ja' : 'nein'}, ${Date.now() - t0} ms`
        )
        for (const cb of nachEnde.splice(0)) cb()
      })
  })
  return { auftrag: lauf.auftrag }
}

const eindeutig = (ids: readonly number[]): number[] => [...new Set(ids)]

/** Gemischte Werte der Auswahl lesen (Ansicht „Metadaten bearbeiten“). */
export function lesenStarten(idsRoh: readonly number[], melden: Melden): AuftragStart {
  const ids = eindeutig(idsRoh)
  if (!ids.length) return { grund: 'Keine Bilder ausgewählt.' }
  return starten('lesen', ids.length, melden, async (lauf, f, s) => {
    const werte: MetaWerte[] = []
    for (let i = 0; i < ids.length && !lauf.abbruch; i += LESE_TEIL) {
      const teil = ids.slice(i, i + LESE_TEIL)
      const r = await dateienLesen(teil)
      for (const w of r.werte) werte.push(w)
      // gemeldet wird nur, was nicht einfloss – „gelesen“ wäre bei 10.000 Bildern nur Last
      const nicht = r.ergebnisse.filter((e) => e.status !== 'gelesen')
      for (const e of nicht) s.dateien.push(e)
      f.schritt(teil.length, nicht)
    }
    return zusammenfassen(werte)
  })
}

/**
 * Eine Änderung in alle diese Bilder schreiben. Mit `rueckfrage` fragt der main erst (Schnellbewertung
 * im Raster), mit `nochmal` gleicht er die Dateien vorher ab („Neu lesen und erneut versuchen“).
 */
export async function schreibenStarten(
  fenster: BrowserWindow | null,
  idsRoh: readonly number[],
  m: MehrfachAenderung,
  opt: SchreibOptionen,
  melden: Melden
): Promise<AuftragStart> {
  const ids = eindeutig(idsRoh)
  if (!ids.length) return { grund: 'Keine Bilder ausgewählt.' }
  if (laufend) return { grund: BESCHAEFTIGT }
  if (opt.rueckfrage) {
    const box = {
      type: 'question' as const,
      title: 'Metadaten schreiben',
      message: rueckfrageText(m, ids.length),
      detail:
        'Vorher bekommt jede Datei eine Sicherung (außer im Ordner „privat“). ' +
        '„Rückgängig“ nimmt danach alle auf einmal zurück.',
      buttons: ['Schreiben', 'Abbrechen'],
      defaultId: 0,
      cancelId: 1,
      noLink: true
    }
    const { response } = fenster
      ? await dialog.showMessageBox(fenster, box)
      : await dialog.showMessageBox(box)
    if (response !== 0) return { abgebrochen: true }
  }
  // alle Sicherungen zusammen müssen Platz haben, nicht nur die erste (Review-Checkliste)
  const platz = await platzFuerSicherungen(ids)
  if (platz) return { grund: platz }
  // nach den Rückfragen gilt der Stand von jetzt: Ein anderer Auftrag kann inzwischen laufen
  return starten('schreiben', ids.length, melden, async (lauf, f, s) => {
    if (opt.nochmal) await abgleichFuer(ids)
    for (const id of ids) {
      if (lauf.abbruch) break
      const { ergebnis, journal } = await dateiAendern(id, m)
      s.dateien.push(ergebnis)
      if (journal !== undefined) s.journal.push(journal)
      f.schritt(1, [ergebnis])
    }
  })
}

/** Einen ganzen Auftrag zurücknehmen (seine Journal-Zeilen, rückwärts). */
export function rueckgaengigStarten(journalRoh: readonly number[], melden: Melden): AuftragStart {
  const journal = eindeutig(journalRoh)
  if (!journal.length) return { grund: 'Nichts zurückzunehmen.' }
  return starten('rueckgaengig', journal.length, melden, async (lauf, f, s) => {
    for (const j of [...journal].reverse()) {
      if (lauf.abbruch) break
      const e = await zeileZuruecknehmen(j)
      if (e) s.dateien.push(e)
      f.schritt(1, e ? [e] : [])
    }
  })
}
