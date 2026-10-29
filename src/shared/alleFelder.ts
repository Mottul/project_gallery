// „Alle Felder“ für das Info-Panel (2.1): die ExifTool-Ausgabe einer Datei (-json -G1 -s, lesbare
// Werte) als Liste – rein, getestet in alleFelder.test.ts. Die Werte stammen aus einer fremden
// Datei: Steuerzeichen weg, Längen und Anzahl begrenzt. Pfade gehen nicht mit (SourceFile,
// Ordner), ebenso wenig die Angaben über ExifTool selbst.

import type { MetaFeld } from './types'

/** Höchstens so viele Felder, je höchstens so lang */
export const FELDER_MAX = 3000
export const WERT_MAX = 1000

/** Nicht anzeigen: Pfade und ExifTool selbst */
const WEG = new Set(['SourceFile', 'System:Directory'])

function alsText(v: unknown): string | null {
  if (v === null || v === undefined) return null
  const roh =
    typeof v === 'string'
      ? v
      : typeof v === 'number' || typeof v === 'boolean'
        ? String(v)
        : Array.isArray(v)
          ? v.map((x) => (typeof x === 'object' ? JSON.stringify(x) : String(x))).join(', ')
          : JSON.stringify(v)
  const t = roh
    .replace(/[\p{Cc}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!t) return null
  return t.length > WERT_MAX ? t.slice(0, WERT_MAX - 1) + '…' : t
}

/** Ein Eintrag der ExifTool-JSON-Ausgabe („Gruppe:Name“ → Wert) als Feldliste. */
export function alleFelderAus(eintrag: unknown): MetaFeld[] {
  if (!eintrag || typeof eintrag !== 'object' || Array.isArray(eintrag)) return []
  const out: MetaFeld[] = []
  for (const [schluessel, wert] of Object.entries(eintrag as Record<string, unknown>)) {
    if (out.length >= FELDER_MAX) break
    if (WEG.has(schluessel) || schluessel.startsWith('ExifTool:')) continue
    const i = schluessel.indexOf(':')
    const gruppe = i > 0 ? schluessel.slice(0, i) : ''
    const name = i > 0 ? schluessel.slice(i + 1) : schluessel
    const text = alsText(wert)
    if (!name || text === null) continue
    out.push({ gruppe: gruppe.slice(0, 40), name: name.slice(0, 100), wert: text })
  }
  return out
}
