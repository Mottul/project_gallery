// Sortierung und geordnete Bildliste im Renderer. Die Sortierung ist Bedienzustand (localStorage,
// nicht settings.json) – ab 1.4 je Ordner. Die Liste holt einmal je Sortierung die Kennungen und
// Details nur für den Anfang (vorläufige Tabelle; das virtualisierte Raster kommt mit 1.4).
// Ändert sich die Bibliothek (Einlesen, Metadaten), wird höchstens einmal je Sekunde neu gefragt.

import { useEffect, useRef, useState } from 'react'
import { create } from 'zustand'
import { pruefeSortierung, STANDARD_SORTIERUNG, type Sortierung } from '@shared/sortFilter'
import type { ImageInfo, LibraryState } from '@shared/types'
import { api } from './api'
import { errorText } from './utils'

const STORAGE_KEY = 'galerie.sortierung'
/** So viele Zeilen zeigt die vorläufige Tabelle */
export const LISTE_MAX = 500
const NEU_FRAGEN_MS = 1000

function gemerkt(): Sortierung {
  try {
    const roh = localStorage.getItem(STORAGE_KEY)
    return (roh && pruefeSortierung(JSON.parse(roh))) || STANDARD_SORTIERUNG
  } catch {
    return STANDARD_SORTIERUNG
  }
}

const useSortStore = create<{ sortierung: Sortierung }>(() => ({ sortierung: gemerkt() }))

export function useSortierung(): Sortierung {
  return useSortStore((s) => s.sortierung)
}

export function sortierungSetzen(s: Sortierung): void {
  useSortStore.setState({ sortierung: s })
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s))
  } catch {
    // localStorage nicht verfügbar -> nur für diese Sitzung
  }
}

export interface Bildliste {
  /** Kennungen aller Dateien in Reihenfolge */
  ids: number[]
  /** Details der ersten LISTE_MAX */
  bilder: ImageInfo[]
  fehler: string | null
}

/** Schlüssel, der sich ändert, wenn sich am Inhalt der Bibliothek etwas getan hat. */
function inhaltsSchluessel(lib: LibraryState | null): string {
  if (!lib) return ''
  return [
    lib.total,
    lib.metaPending,
    lib.thumbPending,
    ...lib.folders.map((f) => `${f.id}:${f.count}:${f.found}`)
  ]
    .map(String)
    .join('|')
}

/** Geordnete Liste für die aktuelle Sortierung; null, solange sie lädt. */
export function useBildliste(lib: LibraryState | null): Bildliste | null {
  const sortierung = useSortierung()
  const schluessel = inhaltsSchluessel(lib)
  const [liste, setListe] = useState<Bildliste | null>(null)
  const letzte = useRef(0)
  const anfrage = useRef(0)
  const vorigeSortierung = useRef(sortierung)

  useEffect(() => {
    if (!lib) return
    // Sortierwechsel sofort, Änderungen der Bibliothek gedrosselt
    const sofort = vorigeSortierung.current !== sortierung
    vorigeSortierung.current = sortierung
    const warten = sofort ? 0 : Math.max(0, letzte.current + NEU_FRAGEN_MS - Date.now())
    const timer = setTimeout(() => {
      const nr = ++anfrage.current
      letzte.current = Date.now()
      void (async () => {
        try {
          const ids = await api.library.query(sortierung)
          const bilder = await api.library.details(ids.slice(0, LISTE_MAX))
          // eine neuere Anfrage hat Vorrang
          if (nr === anfrage.current) setListe({ ids, bilder, fehler: null })
        } catch (err) {
          if (nr === anfrage.current) setListe({ ids: [], bilder: [], fehler: errorText(err) })
        }
      })()
    }, warten)
    return () => clearTimeout(timer)
    // lib selbst ändert sich bei jedem Ereignis; maßgeblich ist der Inhaltsschlüssel
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortierung, schluessel])

  return liste
}
