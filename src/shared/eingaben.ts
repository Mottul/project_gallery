// Eingaben aus dem Renderer prüfen – rein, getestet in eingaben.test.ts. Auch der eigene Renderer
// gilt als fremde Eingabe (Skill ipc-kanal): Ungültiges ist ein Fehler, nie still „korrigiert“.

import { pruefeBildFilter, type BildFilter } from './bildFilter'
import { pruefeAnsichtName, pruefeAnsichtStand, type AnsichtStand } from './gespeicherteAnsicht'
import { pruefeGruppierung, type Gruppierung } from './gruppen'
import { pruefeMetaAenderung, type MetaAenderung } from './metaFields'
import {
  pruefeOrdnerFilter,
  pruefeSortierung,
  type OrdnerFilter,
  type Sortierung
} from './sortFilter'
import { FOLDER_MODES, type FolderMode } from './types'

/** Kennung aus dem Index: ganze Zahl ab 1. */
export function pruefeKennung(v: unknown): number {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 1) {
    throw new Error('Ungültige Kennung')
  }
  return v
}

/** Liste von Kennungen, höchstens `max` (sichtbarer Ausschnitt, nie die ganze Bibliothek). */
export function pruefeKennungen(v: unknown, max: number): number[] {
  if (!Array.isArray(v) || v.length > max) throw new Error('Ungültige Kennungen')
  return v.map(pruefeKennung)
}

export function pruefeSortierungStreng(v: unknown): Sortierung {
  const s = pruefeSortierung(v)
  if (!s) throw new Error('Ungültige Sortierung')
  return s
}

export function pruefeGruppierungStreng(v: unknown): Gruppierung {
  const g = pruefeGruppierung(v)
  if (!g) throw new Error('Ungültige Gruppierung')
  return g
}

export function pruefeBildFilterStreng(v: unknown): BildFilter {
  const f = pruefeBildFilter(v)
  if (!f) throw new Error('Ungültiger Filter')
  return f
}

export function pruefeMetaAenderungStreng(v: unknown): MetaAenderung {
  const a = pruefeMetaAenderung(v)
  if (!a) throw new Error('Ungültige Änderung')
  return a
}

export function pruefeAnsichtNameStreng(v: unknown): string {
  const n = pruefeAnsichtName(v)
  if (n === null) throw new Error('Ungültiger Name der Ansicht')
  return n
}

export function pruefeAnsichtStandStreng(v: unknown): AnsichtStand {
  const s = pruefeAnsichtStand(v)
  if (!s) throw new Error('Ungültige Ansicht')
  return s
}

/** Ein Schalter aus dem Renderer: fehlt = aus, sonst nur true/false. */
export function pruefeSchalterStreng(v: unknown): boolean {
  if (v === undefined) return false
  if (typeof v !== 'boolean') throw new Error('Ungültiger Schalter')
  return v
}

export function pruefeOrdnerFilterStreng(v: unknown): OrdnerFilter {
  const f = pruefeOrdnerFilter(v)
  if (!f) throw new Error('Ungültiger Ordner-Filter')
  return f
}

/** Längster Pfad unter Windows (mit \\?\-Präfix) */
const PFAD_MAX = 32_767

/**
 * Pfade gezogener Ordner (kommen aus dem Preload, nie aus der Seite): Liste von Texten, höchstens
 * `max`, ohne Steuerzeichen. Ob sie absolut, erreichbar und Ordner sind, prüft der main.
 */
export function pruefePfade(v: unknown, max: number): string[] {
  if (!Array.isArray(v) || v.length > max) throw new Error('Ungültige Pfade')
  for (const p of v) {
    if (typeof p !== 'string' || p === '' || p.length > PFAD_MAX || /\p{Cc}/u.test(p)) {
      throw new Error('Ungültiger Pfad')
    }
  }
  return v as string[]
}

export function pruefeOrdnerModus(v: unknown): FolderMode {
  if (typeof v !== 'string' || !(FOLDER_MODES as readonly string[]).includes(v)) {
    throw new Error('Ungültiger Ordner-Modus')
  }
  return v as FolderMode
}
