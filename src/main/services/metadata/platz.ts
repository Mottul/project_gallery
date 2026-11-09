// Platz für Sicherungen (Phase 3.3; Review-Checkliste „Grenzen in Summe prüfen“): Jede Datei bekommt
// vor der ersten Änderung eine Kopie – bei einer großen Auswahl summiert sich das. Vor einem Auftrag
// misst der main am Ordner der Sicherungen (lokaler Datenordner der App, nie ein Nutzerordner); gibt
// es ihn noch nicht, am nächsten vorhandenen darüber. Getestet in platz.test.ts.

import { statfs } from 'node:fs/promises'
import { dirname } from 'node:path'

/** So viel bleibt frei: Windows, ExifTools Nachbardatei und der Index brauchen auch Platz */
export const PLATZ_RESERVE = 1024 ** 3

/** Freie Bytes auf dem Laufwerk dieses Pfads; null = nicht feststellbar (dann nicht blockieren). */
export async function freierPlatz(pfad: string): Promise<number | null> {
  let p = pfad
  for (;;) {
    try {
      const s = await statfs(p)
      return Number(s.bavail) * Number(s.bsize)
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      const oben = dirname(p)
      if ((code !== 'ENOENT' && code !== 'ENOTDIR') || oben === p) return null
      p = oben
    }
  }
}

const dezimal = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 })

/** „1,2 GB“ (1024er-Schritte wie im Explorer) */
export function groesseText(bytes: number): string {
  const einheiten = ['Byte', 'KB', 'MB', 'GB', 'TB']
  let v = Math.max(0, bytes)
  let i = 0
  while (v >= 1024 && i < einheiten.length - 1) {
    v /= 1024
    i++
  }
  return `${dezimal.format(v)} ${einheiten[i]}`
}

/** null = es passt; sonst der Hinweis für den Nutzer */
export function platzHinweis(noetig: number, frei: number | null): string | null {
  if (frei === null || noetig === 0 || frei - PLATZ_RESERVE >= noetig) return null
  return (
    `Für die Sicherungen fehlt Platz: Sie brauchen ${groesseText(noetig)}, frei sind ` +
    `${groesseText(Math.max(0, frei - PLATZ_RESERVE))} (1 GB bleibt für Windows). ` +
    'Bitte weniger Bilder auswählen oder Platz schaffen.'
  )
}
