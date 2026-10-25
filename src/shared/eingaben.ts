// Eingaben aus dem Renderer prüfen – rein, getestet in eingaben.test.ts. Auch der eigene Renderer
// gilt als fremde Eingabe (Skill ipc-kanal): Ungültiges ist ein Fehler, nie still „korrigiert“.

import { FOLDER_MODES, type FolderMode } from './types'

/** Kennung aus dem Index: ganze Zahl ab 1. */
export function pruefeKennung(v: unknown): number {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 1) {
    throw new Error('Ungültige Kennung')
  }
  return v
}

export function pruefeOrdnerModus(v: unknown): FolderMode {
  if (typeof v !== 'string' || !(FOLDER_MODES as readonly string[]).includes(v)) {
    throw new Error('Ungültiger Ordner-Modus')
  }
  return v as FolderMode
}
