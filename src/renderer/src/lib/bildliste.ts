// Daten für Raster und Liste: die geordneten Kennungen des gewählten Knotens (einmal je
// Sortierung, Filter, Änderung der Bibliothek) und Details nur für das Sichtbare – nie 100.000
// Objekte über IPC (Skill bibliothek-index, „Abfragen“). Ändert sich die Bibliothek (Einlesen,
// Metadaten, Vorschaubilder), wird höchstens einmal je Sekunde neu gefragt.

import { useCallback, useEffect, useRef, useState } from 'react'
import { create } from 'zustand'
import { filterAktiv, type BildFilter, type Facetten } from '@shared/bildFilter'
import type { Gruppe, Gruppierung } from '@shared/gruppen'
import type { Sortierung } from '@shared/sortFilter'
import type { ImageInfo, LibraryDirs, LibraryState } from '@shared/types'
import type { Knoten } from './ansicht'
import { api } from './api'
import { errorText } from './utils'

const NEU_FRAGEN_MS = 1000
/** Höchstens so viele Details je Anfrage (wie DETAILS_MAX im main) */
const DETAILS_STAPEL = 1000

/**
 * Schlüssel, der sich ändert, wenn sich an der Liste der Bilder etwas getan haben kann. Der Stand
 * der Vorschaubilder gehört nicht dazu: Er läuft bei großen Bibliotheken viele Minuten, und die
 * ganze Abfrage je Sekunde (samt Gruppen und Ordnerbaum) hielte den main unnötig auf (Abnahme 2.4).
 */
function inhaltsSchluessel(lib: LibraryState | null): string {
  if (!lib) return ''
  return [
    lib.total,
    lib.metaPending,
    lib.revision,
    ...lib.folders.map((f) => `${f.id}:${f.count}:${f.found}:${f.missing}:${f.mode}`)
  ].join('|')
}

/**
 * Wie useEffect auf `schluessel`, aber höchstens einmal je Sekunde – außer `sofort` hat sich
 * geändert (Sortierung, Filter: das will der Nutzer gleich sehen).
 */
function useGedrosselt(fn: () => void, schluessel: string, sofort: string, aktiv: boolean): void {
  const letzte = useRef(0)
  const vorigesSofort = useRef(sofort)
  const fnRef = useRef(fn)
  fnRef.current = fn
  useEffect(() => {
    if (!aktiv) return
    const jetztSofort = vorigesSofort.current !== sofort
    vorigesSofort.current = sofort
    const warten = jetztSofort ? 0 : Math.max(0, letzte.current + NEU_FRAGEN_MS - Date.now())
    const t = setTimeout(() => {
      letzte.current = Date.now()
      fnRef.current()
    }, warten)
    return () => clearTimeout(t)
  }, [schluessel, sofort, aktiv])
}

export interface Kennungen {
  ids: number[]
  /** Gruppen-Überschriften (leer = keine) */
  gruppen: Gruppe[]
  /** Blocksatz: Seitenverhältnis je Kennung (nur angefragt) */
  seiten?: number[]
  /** bei aktivem Filter: Bilder im Knoten ohne Filter */
  gesamt?: number
  /** zählt jede neue Antwort – Details älterer Stände gelten als veraltet */
  stand: number
  fehler: string | null
}

/** Geordnete Kennungen des Knotens samt Gruppen; null, solange sie das erste Mal laden. */
export function useKennungen(
  lib: LibraryState | null,
  knoten: Knoten,
  sortierung: Sortierung,
  gruppierung: Gruppierung,
  mitSeiten = false,
  bildFilter?: BildFilter
): Kennungen | null {
  const [k, setK] = useState<Kennungen | null>(null)
  const anfrage = useRef(0)
  const stand = useRef(0)
  const sofort = JSON.stringify([knoten, sortierung, gruppierung, mitSeiten, bildFilter])
  useGedrosselt(
    () => {
      const nr = ++anfrage.current
      api.library
        .queryGroups(
          sortierung,
          knoten ?? undefined,
          gruppierung,
          mitSeiten,
          filterAktiv(bildFilter) ? bildFilter : undefined
        )
        .then(
          (r) => ({ ...r, fehler: null }),
          (err) => ({ ids: [] as number[], gruppen: [] as Gruppe[], fehler: errorText(err) })
        )
        .then((r) => {
          // eine neuere Anfrage hat Vorrang
          if (nr === anfrage.current) setK({ ...r, stand: ++stand.current })
        })
    },
    inhaltsSchluessel(lib),
    sofort,
    lib !== null
  )
  // neue Vorschaubilder ändern nur Details (Farbe, „defekt“): dieselbe Liste, neuer Stand
  useGedrosselt(
    () => setK((alt) => alt && { ...alt, stand: ++stand.current }),
    String(lib?.thumbPending ?? 0),
    '',
    lib !== null
  )
  return k
}

/**
 * Details zwischengespeichert: `anfordern` holt, was im sichtbaren Bereich fehlt oder zu einem
 * älteren Stand gehört; bis dahin bleibt das Alte stehen (kein Flackern beim Einlesen).
 */
export function useDetails(stand: number): {
  get: (id: number) => ImageInfo | undefined
  anfordern: (ids: readonly number[]) => void
  setzen: (infos: readonly ImageInfo[]) => void
} {
  const cache = useRef(new Map<number, { info: ImageInfo; stand: number }>())
  const unterwegs = useRef(new Set<number>())
  const [, setTick] = useState(0)
  const standRef = useRef(stand)
  standRef.current = stand

  const anfordern = useCallback((ids: readonly number[]) => {
    const fehlt = ids.filter(
      (id) => !unterwegs.current.has(id) && cache.current.get(id)?.stand !== standRef.current
    )
    for (let i = 0; i < fehlt.length; i += DETAILS_STAPEL) {
      const teil = fehlt.slice(i, i + DETAILS_STAPEL)
      const s = standRef.current
      for (const id of teil) unterwegs.current.add(id)
      api.library
        .details(teil)
        .then((infos) => {
          for (const info of infos) cache.current.set(info.id, { info, stand: s })
          setTick((t) => t + 1)
        })
        .catch(() => undefined)
        .finally(() => {
          for (const id of teil) unterwegs.current.delete(id)
        })
    }
  }, [])

  const get = useCallback((id: number) => cache.current.get(id)?.info, [])
  /** Frische Details aus einem Schreibauftrag: gleich zeigen, nicht auf den Takt warten */
  const setzen = useCallback((infos: readonly ImageInfo[]) => {
    for (const info of infos) cache.current.set(info.id, { info, stand: standRef.current })
    setTick((t) => t + 1)
  }, [])
  return { get, anfordern, setzen }
}

/** Auswahllisten der Filterleiste – nur solange sie offen ist (gedrosselt neu bei Änderungen). */
export function useFacetten(
  lib: LibraryState | null,
  knoten: Knoten,
  aktiv: boolean
): Facetten | null {
  const [f, setF] = useState<Facetten | null>(null)
  const anfrage = useRef(0)
  useGedrosselt(
    () => {
      const nr = ++anfrage.current
      // eine neuere Anfrage hat Vorrang (anderer Knoten)
      api.library.facets(knoten ?? undefined).then(
        (w) => nr === anfrage.current && setF(w),
        () => nr === anfrage.current && setF(null)
      )
    },
    inhaltsSchluessel(lib),
    JSON.stringify([knoten, aktiv]),
    lib !== null && aktiv
  )
  return f
}

/** Ordnerbaum-Daten: Unterordner je Bibliotheksordner (gedrosselt neu bei Änderungen). */
export function useVerzeichnisse(lib: LibraryState | null): LibraryDirs[] {
  const [dirs, setDirs] = useState<LibraryDirs[]>([])
  useGedrosselt(
    () => {
      api.library.dirs().then(setDirs, () => undefined)
    },
    inhaltsSchluessel(lib),
    '',
    lib !== null
  )
  return dirs
}

/** Summe der Dateigrößen einer Auswahl (kurz verzögert, die Auswahl ändert sich beim Ziehen). */
export function useAuswahlGroesse(auswahl: ReadonlySet<number>): number | null {
  const [summe, setSumme] = useState<number | null>(null)
  useEffect(() => {
    if (!auswahl.size) {
      setSumme(null)
      return
    }
    let gilt = true
    const t = setTimeout(() => {
      api.library.size([...auswahl]).then(
        (s) => gilt && setSumme(s),
        () => gilt && setSumme(null)
      )
    }, 150)
    return () => {
      gilt = false
      clearTimeout(t)
    }
  }, [auswahl])
  return summe
}

/** Wie viele Bilder die Galerie gerade zeigt (gewählter Knoten) – für die Statusleiste. */
const useAngezeigtStore = create<{ anzahl: number | null }>(() => ({ anzahl: null }))
export const angezeigtMelden = (anzahl: number | null): void =>
  useAngezeigtStore.setState({ anzahl })
export const useAngezeigt = (): number | null => useAngezeigtStore((s) => s.anzahl)

/** Sichtbare Kennungen an den main melden (Vorschau-Vorrang), gedrosselt. */
export function useSichtbarMelden(): (ids: readonly number[]) => void {
  const letzte = useRef('')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    []
  )
  return useCallback((ids: readonly number[]) => {
    const s = ids.join(',')
    if (s === letzte.current) return
    letzte.current = s
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => api.library.visible(ids.slice(0, 1000)), 200)
  }, [])
}
