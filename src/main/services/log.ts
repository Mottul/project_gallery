// Einfacher Datei-Logger für den main-Prozess (aus der Mottulbox übernommen,
// project_mega/src/main/services/log.ts). Schreibt nach <userData>/galeria-debug.log – im
// gepackten Programm ist die Konsole sonst unsichtbar. Bewusst synchron und best effort (wirft nie).
//
// Schicht D (Skill bildschutz): ins Log nur Kennungen, Fehlercodes und Pfade, wo nötig – nie
// Bild-Metadaten (GPS, Titel, Beschreibung, Stichwörter).

import { app } from 'electron'
import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

let cachedPath: string | null = null

export function logFilePath(): string {
  if (!cachedPath) {
    const dir = app.getPath('userData')
    try {
      mkdirSync(dir, { recursive: true })
    } catch {
      /* ignore */
    }
    cachedPath = join(dir, 'galeria-debug.log')
  }
  return cachedPath
}

function fmt(p: unknown): string {
  if (typeof p === 'string') return p
  try {
    return JSON.stringify(p)
  } catch {
    return String(p)
  }
}

export function logLine(...parts: unknown[]): void {
  const line = `[${new Date().toISOString()}] ${parts.map(fmt).join(' ')}\n`
  try {
    appendFileSync(logFilePath(), line)
  } catch {
    /* ignore */
  }
  console.log('[galeria]', ...parts)
}
