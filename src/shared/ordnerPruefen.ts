// Pfade vergleichen und neue Bibliotheksordner prüfen – rein, getestet in ordnerPruefen.test.ts.
//
// Windows unterscheidet Groß/Klein nicht und kennt „\“ und „/“; ein Pfad kann außerdem in zwei
// Unicode-Formen ankommen (NFC/NFD). Für Vergleiche und eindeutige Schlüssel im Index (Ordner,
// relative Dateipfade) gibt es deshalb einen Vergleichsschlüssel. Angezeigt wird immer der
// ursprüngliche Pfad.

/** Vergleichsschlüssel: „/“ als Trenner, ohne Schluss-Trenner, NFC; unter Windows klein. */
export function pfadSchluessel(pfad: string, windows: boolean): string {
  let p = pfad.normalize('NFC').replace(/\\/g, '/')
  const unc = p.startsWith('//')
  p = p.replace(/\/{2,}/g, '/')
  if (unc) p = '/' + p
  // Schluss-Trenner weg, außer bei einer Wurzel („C:/“, „/“)
  if (p.length > 1 && p.endsWith('/') && !/^[a-z]:\/$/i.test(p)) p = p.slice(0, -1)
  return windows ? p.toLowerCase() : p
}

/** Liegt `innen` in `aussen` (oder ist gleich)? Beide als Vergleichsschlüssel. */
function liegtIn(innen: string, aussen: string): boolean {
  if (innen === aussen) return true
  const praefix = aussen.endsWith('/') ? aussen : aussen + '/'
  return innen.startsWith(praefix)
}

export type OrdnerKonflikt =
  | { art: 'gleich'; pfad: string }
  | { art: 'darin'; pfad: string }
  | { art: 'enthaelt'; pfad: string }
  | { art: 'app'; pfad: string }

/**
 * Darf `neu` in die Bibliothek? Nicht, wenn er schon drin ist, in einem Bibliotheksordner liegt
 * oder einen enthält (sonst stünde jedes Bild doppelt im Index), und nicht innerhalb der
 * Datenordner der App selbst (Index, Cache). Ein Ordner, der sie enthält – etwa das ganze
 * Benutzerprofil –, ist erlaubt: Der Scan lässt `AppData` aus (scanRegeln.ts).
 */
export function ordnerKonflikt(
  neu: string,
  vorhandene: readonly string[],
  appOrdner: readonly string[],
  windows: boolean
): OrdnerKonflikt | null {
  const n = pfadSchluessel(neu, windows)
  for (const pfad of appOrdner) {
    if (liegtIn(n, pfadSchluessel(pfad, windows))) return { art: 'app', pfad }
  }
  for (const pfad of vorhandene) {
    const v = pfadSchluessel(pfad, windows)
    if (n === v) return { art: 'gleich', pfad }
    if (liegtIn(n, v)) return { art: 'darin', pfad }
    if (liegtIn(v, n)) return { art: 'enthaelt', pfad }
  }
  return null
}

/** Meldung für den Nutzer zu einem Konflikt (Ordnernamen in Anführungszeichen). */
export function konfliktText(k: OrdnerKonflikt, name: (pfad: string) => string): string {
  switch (k.art) {
    case 'gleich':
      return 'Dieser Ordner ist schon in der Galerie.'
    case 'darin':
      return `Dieser Ordner liegt schon in „${name(k.pfad)}“, der zur Galerie gehört.`
    case 'enthaelt':
      return `Dieser Ordner enthält „${name(k.pfad)}“, der schon zur Galerie gehört – diesen zuerst entfernen.`
    case 'app':
      return 'In diesem Ordner liegen Daten der Galerie selbst – bitte einen anderen wählen.'
  }
}
