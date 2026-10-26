// Ansicht der Galerie: gewählter Knoten im Ordnerbaum und je Bibliotheksordner Ansicht (Kacheln/
// Liste), Kachelgröße und Sortierung – Bedienzustand in localStorage, nicht in settings.json
// (docs/PLAN.md: „Ansicht, Größe und Sortierung je Ordner gemerkt“). Alles Gelesene wird geprüft;
// fehlt localStorage, gilt der Stand nur für diese Sitzung.

import { create } from 'zustand'
import {
  pruefeOrdnerFilter,
  pruefeSortierung,
  STANDARD_SORTIERUNG,
  type OrdnerFilter,
  type Sortierung
} from '@shared/sortFilter'

export type AnsichtArt = 'kacheln' | 'liste'

export interface Ansicht {
  art: AnsichtArt
  /** Kantenlänge der Kacheln in px */
  groesse: number
  sortierung: Sortierung
}

export const GROESSE_MIN = 80
export const GROESSE_MAX = 320
const STANDARD: Ansicht = { art: 'kacheln', groesse: 160, sortierung: STANDARD_SORTIERUNG }

/** Knoten im Ordnerbaum: null = alle Bilder */
export type Knoten = OrdnerFilter | null

const ANSICHTEN_KEY = 'galerie.ansichten'
const KNOTEN_KEY = 'galerie.knoten'

function lesen(key: string): unknown {
  try {
    const roh = localStorage.getItem(key)
    return roh ? JSON.parse(roh) : null
  } catch {
    return null
  }
}

function schreiben(key: string, wert: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(wert))
  } catch {
    // localStorage nicht verfügbar -> nur für diese Sitzung
  }
}

export function begrenzeGroesse(n: number): number {
  return Math.min(GROESSE_MAX, Math.max(GROESSE_MIN, Math.round(n)))
}

function pruefeAnsicht(v: unknown): Ansicht | null {
  if (!v || typeof v !== 'object') return null
  const { art, groesse, sortierung } = v as Record<string, unknown>
  const s = pruefeSortierung(sortierung)
  if ((art !== 'kacheln' && art !== 'liste') || typeof groesse !== 'number' || !s) return null
  return { art, groesse: begrenzeGroesse(groesse), sortierung: s }
}

function gemerkteAnsichten(): Map<string, Ansicht> {
  const roh = lesen(ANSICHTEN_KEY)
  const out = new Map<string, Ansicht>()
  if (roh && typeof roh === 'object' && !Array.isArray(roh)) {
    for (const [k, v] of Object.entries(roh)) {
      const a = pruefeAnsicht(v)
      if (a && /^(alle|o\d+)$/.test(k)) out.set(k, a)
    }
  }
  return out
}

/** Schlüssel je Bibliotheksordner (Unterordner teilen die Ansicht ihres Ordners). */
const ansichtSchluessel = (k: Knoten): string => (k ? `o${k.ordner}` : 'alle')

const useStore = create<{ knoten: Knoten; ansichten: Map<string, Ansicht> }>(() => ({
  knoten: pruefeOrdnerFilter(lesen(KNOTEN_KEY)),
  ansichten: gemerkteAnsichten()
}))

export function useKnoten(): Knoten {
  return useStore((s) => s.knoten)
}

export function knotenWaehlen(knoten: Knoten): void {
  useStore.setState({ knoten })
  schreiben(KNOTEN_KEY, knoten)
}

/** Ansicht des gewählten Knotens (für einen neuen Ordner: die Vorgabe). */
export function useAnsicht(): Ansicht {
  return useStore((s) => s.ansichten.get(ansichtSchluessel(s.knoten)) ?? STANDARD)
}

export function ansichtAendern(patch: Partial<Ansicht>): void {
  const { knoten, ansichten } = useStore.getState()
  const k = ansichtSchluessel(knoten)
  const neu = new Map(ansichten)
  const alt = ansichten.get(k) ?? STANDARD
  neu.set(k, {
    ...alt,
    ...patch,
    groesse: begrenzeGroesse(patch.groesse ?? alt.groesse)
  })
  useStore.setState({ ansichten: neu })
  schreiben(ANSICHTEN_KEY, Object.fromEntries(neu))
}
