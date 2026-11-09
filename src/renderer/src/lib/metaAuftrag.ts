// Auftrag der Mehrfachauswahl (3.3) im Renderer: EIN Stand je Fenster, gefüttert vom Ereignis
// meta.onJob (Fortschritt gedrosselt aus dem main – die Wahrheit über „läuft“ kommt von dort, nicht
// vom letzten Klick). Der main lässt einen Auftrag zur Zeit zu; zugeordnet wird über die Kennung, die
// der Start zurückgibt. Meldungen, die vor dieser Antwort ankommen, werden so lange aufgehoben.

import { create } from 'zustand'
import type {
  AuftragArt,
  AuftragEnde,
  AuftragStand,
  AuftragStart,
  DateiErgebnis
} from '@shared/metaMehrfach'
import { api } from './api'
import { errorText } from './utils'

/** Wer den Auftrag startete: die Ansicht „Metadaten bearbeiten“ oder die Tasten im Raster */
export type Quelle = 'ansicht' | 'raster'

export interface Auftrag {
  /** null, bis die Antwort auf den Start da ist */
  auftrag: number | null
  art: AuftragArt
  quelle: Quelle
  /** wer ihn startete (eine geöffnete Ansicht) – deren Ende gehört nur ihr */
  inhaber: object | null
  /** was geschrieben wird, für den Hinweis im Raster („3 Sterne“) */
  text: string
  fertig: number
  gesamt: number
  /** Ergebnis je Datei (Kennung → Ergebnis), wie sie eintreffen */
  dateien: ReadonlyMap<number, DateiErgebnis>
  ende: AuftragEnde | null
}

export const LAEUFT_SCHON = 'Es läuft schon ein Auftrag – bitte warten oder ihn abbrechen.'

const useStore = create<{ a: Auftrag | null }>(() => ({ a: null }))

/** Meldungen, deren Start-Antwort noch aussteht (je Kennung) */
const frueh = new Map<number, AuftragStand[]>()
/** „Abbrechen“, während die Antwort auf den Start noch aussteht */
let anhaltenVorgemerkt = false

let abonniert = false
function abonnieren(): void {
  if (abonniert) return
  abonniert = true
  api.meta.onJob((s) => {
    const a = useStore.getState().a
    if (!a || a.ende) return
    if (a.auftrag === null) {
      // begrenzt, nur das Ende immer: Es bringt ohnehin alle Ergebnisse mit
      const liste = frueh.get(s.auftrag) ?? []
      if (liste.length < 1000 || s.ende) liste.push(s)
      frueh.set(s.auftrag, liste)
      return
    }
    anwenden(s)
  })
}

function anwenden(s: AuftragStand): void {
  const a = useStore.getState().a
  if (!a || a.auftrag !== s.auftrag || a.ende) return
  const neu = [...s.dateien, ...(s.ende?.dateien ?? [])]
  const dateien = neu.length ? new Map(a.dateien) : a.dateien
  for (const d of neu) (dateien as Map<number, DateiErgebnis>).set(d.id, d)
  useStore.setState({
    a: { ...a, fertig: s.fertig, gesamt: s.gesamt, dateien, ende: s.ende ?? null }
  })
}

/** Läuft gerade ein Auftrag (gestartet, noch ohne Ende)? */
export const auftragLaeuft = (): boolean => {
  const a = useStore.getState().a
  return a !== null && a.ende === null
}

/**
 * Einen Auftrag starten. Antwort des main: Kennung, Grund (z. B. kein Platz) oder „abgebrochen“
 * (Rückfrage verneint). Solange einer läuft, startet hier keiner.
 */
export async function auftragStarten(
  quelle: Quelle,
  art: AuftragArt,
  gesamt: number,
  text: string,
  start: () => Promise<AuftragStart>,
  inhaber: object | null = null
): Promise<AuftragStart> {
  abonnieren()
  if (auftragLaeuft()) return { grund: LAEUFT_SCHON }
  frueh.clear()
  anhaltenVorgemerkt = false
  const a: Auftrag = {
    auftrag: null,
    art,
    quelle,
    inhaber,
    text,
    fertig: 0,
    gesamt,
    dateien: new Map(),
    ende: null
  }
  useStore.setState({ a })
  let r: AuftragStart
  try {
    r = await start()
  } catch (err) {
    r = { grund: errorText(err) }
  }
  if (useStore.getState().a === a) {
    if ('auftrag' in r) {
      useStore.setState({ a: { ...a, auftrag: r.auftrag } })
      for (const s of frueh.get(r.auftrag) ?? []) anwenden(s)
      // „Abbrechen“ kam schon, bevor die Kennung da war
      if (anhaltenVorgemerkt) api.meta.cancel(r.auftrag)
    } else useStore.setState({ a: null })
  }
  anhaltenVorgemerkt = false
  frueh.clear()
  return r
}

/** Den laufenden Auftrag nach der laufenden Datei anhalten; mit `nur` nur, wenn er so einer ist. */
export function auftragAnhalten(nur?: { inhaber: object; art: AuftragArt }): void {
  const a = useStore.getState().a
  if (!a || a.ende) return
  if (nur && (a.inhaber !== nur.inhaber || a.art !== nur.art)) return
  if (a.auftrag === null) anhaltenVorgemerkt = true
  else api.meta.cancel(a.auftrag)
}

/** Einen beendeten Auftrag vergessen (Hinweis geschlossen). */
export function auftragVergessen(): void {
  if (!auftragLaeuft()) useStore.setState({ a: null })
}

export function useAuftrag(): Auftrag | null {
  abonnieren()
  return useStore((s) => s.a)
}
