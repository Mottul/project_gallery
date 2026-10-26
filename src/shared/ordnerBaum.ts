// Ordnerbaum aus den Verzeichnissen eines Bibliotheksordners – rein, getestet in
// ordnerBaum.test.ts. Anzahl je Knoten = Bilder darin und in allen Unterordnern; fehlende
// Zwischenstufen (ein Ordner nur mit Unterordnern) werden ergänzt; natürlich sortiert.

import type { LibraryDir } from './types'

export interface Zweig {
  name: string
  /** relativ zum Bibliotheksordner, „“ = der Ordner selbst */
  pfad: string
  /** Bilder hier und in allen Unterordnern */
  anzahl: number
  kinder: Zweig[]
}

const sortiere = new Intl.Collator('de-DE', { numeric: true, sensitivity: 'base' })

/** Baum aus den Verzeichnissen eines Ordners; fehlende Zwischenstufen werden ergänzt. */
export function baueBaum(dirs: readonly LibraryDir[]): Zweig {
  const wurzel: Zweig = { name: '', pfad: '', anzahl: 0, kinder: [] }
  const knoten = new Map<string, Zweig>([['', wurzel]])
  const holen = (pfad: string): Zweig => {
    const da = knoten.get(pfad)
    if (da) return da
    const i = pfad.lastIndexOf('/')
    const eltern = holen(i < 0 ? '' : pfad.slice(0, i))
    const neu: Zweig = { name: pfad.slice(i + 1), pfad, anzahl: 0, kinder: [] }
    eltern.kinder.push(neu)
    knoten.set(pfad, neu)
    return neu
  }
  const eigene = new Map<Zweig, number>()
  for (const d of dirs) eigene.set(holen(d.path), d.count)
  const summe = (z: Zweig): number => {
    z.kinder.sort((a, b) => sortiere.compare(a.name, b.name))
    z.anzahl = (eigene.get(z) ?? 0) + z.kinder.reduce((s, k) => s + summe(k), 0)
    return z.anzahl
  }
  summe(wurzel)
  return wurzel
}
