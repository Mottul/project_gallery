// Regeln des Scans – rein, getestet in scanRegeln.test.ts; angewendet vom Bilddienst
// (services/bilddienst/scan.ts) und beim Abgleich im main (services/library/).

import { formatAusEndung } from './bildFormate'

/**
 * Ordner, die nie eingelesen werden (Skill bibliothek-index, „Scan“): Papierkorb und
 * Systemordner, versteckte Ordner (Punkt vorn), Systemkram von NAS-Geräten, Programmdaten im
 * Benutzerprofil (AppData – enthält auch Index und Cache der Galerie) und Entwicklerordner.
 */
const ORDNER_NIE = new Set([
  '$recycle.bin',
  'system volume information',
  'appdata',
  'node_modules',
  '@eadir', // Synology
  '#recycle',
  '#snapshot'
])

export function ordnerAusgeschlossen(name: string): boolean {
  const n = name.toLowerCase()
  return n.startsWith('.') || n.startsWith('$') || ORDNER_NIE.has(n)
}

/**
 * Dateien, die nie in die Galerie kommen, obwohl die Endung passt: versteckte (Punkt vorn – auch
 * die Zwischennamen des Stapels `.*.galerie-tmp-*` und Metadaten-Dateien von macOS `._x.jpg`) und
 * Sperrdateien von Office (`~$`).
 */
export function dateiAusgeschlossen(name: string): boolean {
  return name.startsWith('.') || name.startsWith('~$')
}

/** Gehört diese Datei in die Galerie? */
export function dateiAufnehmen(name: string): boolean {
  return !dateiAusgeschlossen(name) && formatAusEndung(name) !== null
}

/**
 * Pfade, die beim Abgleich nicht als „fehlt“ gelten dürfen: Liegt eine Datei in einem Ordner,
 * den der Scan nicht lesen konnte (Rechte, gesperrt), ist sie nur nicht erreichbar, nicht weg.
 * `relKey` und `unlesbar` als Vergleichsschlüssel (ordnerPruefen.pfadSchluessel).
 */
export function unterUnlesbarem(relKey: string, unlesbar: readonly string[]): boolean {
  return unlesbar.some((u) => relKey === u || relKey.startsWith(u + '/'))
}
