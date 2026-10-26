// Eingaben aus dem Renderer prüfen – rein, getestet in eingaben.test.ts. Auch der eigene Renderer
// gilt als fremde Eingabe (Skill ipc-kanal): Ungültiges ist ein Fehler, nie still „korrigiert“.

import { pruefeSortierung, type Sortierung } from './sortFilter'
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

export function pruefeOrdnerModus(v: unknown): FolderMode {
  if (typeof v !== 'string' || !(FOLDER_MODES as readonly string[]).includes(v)) {
    throw new Error('Ungültiger Ordner-Modus')
  }
  return v as FolderMode
}
