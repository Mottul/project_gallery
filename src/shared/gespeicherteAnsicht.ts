// Gespeicherte Ansichten (Phase 2.4b; entschieden 30.10.2026: mit Ordner, Abschnitt in der
// Seitenleiste): das gerade Gezeigte unter einem Namen – Knoten, Darstellung, Sortierung, Gruppen,
// Filter samt Suche. Sie liegen im Index, weil ihr Ordner dort lebt: Wird er entfernt, gehen sie
// mit (Fremdschlüssel). Rein, getestet in gespeicherteAnsicht.test.ts. Geprüft wird beim Speichern
// (IPC) und beim Lesen (die Zeile kann von einer anderen Version stammen).

import { pruefeBildFilter, type BildFilter } from './bildFilter'
import { pruefeGruppierung, type Gruppierung } from './gruppen'
import {
  pruefeOrdnerFilter,
  pruefeSortierung,
  type OrdnerFilter,
  type Sortierung
} from './sortFilter'

export type AnsichtArt = 'kacheln' | 'blocksatz' | 'liste'
export const ANSICHT_ARTEN: readonly AnsichtArt[] = ['kacheln', 'blocksatz', 'liste']

/** Kantenlänge der Kacheln bzw. Zeilenhöhe im Blocksatz in px */
export const GROESSE_MIN = 80
export const GROESSE_MAX = 320

export const ANSICHT_NAME_MAX = 80
/** Höchstens so viele gespeicherte Ansichten */
export const ANSICHTEN_MAX = 200

/** Was eine gespeicherte Ansicht festhält; knoten = null: alle Bilder */
export interface AnsichtStand {
  knoten: OrdnerFilter | null
  art: AnsichtArt
  groesse: number
  sortierung: Sortierung
  gruppierung: Gruppierung
  filter: BildFilter
}

export interface GespeicherteAnsicht extends AnsichtStand {
  id: number
  name: string
}

/** vorhanden = Name schon vergeben und nicht zum Ersetzen freigegeben; voll = ANSICHTEN_MAX erreicht */
export type AnsichtSpeichernErgebnis =
  { status: 'gespeichert'; id: number } | { status: 'vorhanden' } | { status: 'voll' }

/** Name ohne Rand-Leerzeichen; null = leer, zu lang oder mit Steuerzeichen. */
export function pruefeAnsichtName(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const name = v.trim().normalize('NFC')
  if (!name || name.length > ANSICHT_NAME_MAX || /\p{Cc}/u.test(name)) return null
  return name
}

/** Gleicher Name auch bei anderer Schreibweise („Urlaub“ = „urlaub“). */
export const nameSchluessel = (name: string): string =>
  name.normalize('NFC').toLocaleLowerCase('de')

export function pruefeAnsichtStand(v: unknown): AnsichtStand | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  const { knoten, art, groesse, sortierung, gruppierung, filter } = v as Record<string, unknown>
  const k = knoten === null ? null : pruefeOrdnerFilter(knoten)
  if (knoten !== null && !k) return null
  if (!ANSICHT_ARTEN.includes(art as AnsichtArt)) return null
  if (typeof groesse !== 'number' || !(groesse >= GROESSE_MIN && groesse <= GROESSE_MAX)) {
    return null
  }
  const s = pruefeSortierung(sortierung)
  const g = pruefeGruppierung(gruppierung)
  const f = pruefeBildFilter(filter)
  if (!s || !g || !f) return null
  return { knoten: k, art: art as AnsichtArt, groesse, sortierung: s, gruppierung: g, filter: f }
}

/** Filter vergleichbar machen: Reihenfolge der Kriterien und der Werte zählt nicht. */
function filterText(f: BildFilter): string {
  const teile = Object.entries(f).map(([k, w]): [string, unknown] => [
    k,
    Array.isArray(w) ? [...w].sort() : w
  ])
  return JSON.stringify(teile.sort(([a], [b]) => (a < b ? -1 : 1)))
}

/** Zeigt beides dasselbe? Die Größe zählt nicht – sie ändert nicht, was zu sehen ist. */
export function standGleich(a: AnsichtStand, b: AnsichtStand): boolean {
  return (
    a.knoten?.ordner === b.knoten?.ordner &&
    a.knoten?.pfad === b.knoten?.pfad &&
    a.art === b.art &&
    a.gruppierung === b.gruppierung &&
    a.sortierung.feld === b.sortierung.feld &&
    a.sortierung.richtung === b.sortierung.richtung &&
    filterText(a.filter) === filterText(b.filter)
  )
}
