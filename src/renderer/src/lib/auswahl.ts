// Auswahl in Raster und Liste – wie im Explorer: Klick wählt eines, Strg schaltet um, Umschalt
// wählt den Bereich ab dem Anker (mit Strg dazu), Strg+A alles, Esc nichts, Rahmen ziehen. Gemerkt
// werden Kennungen (nie Positionen): Nach dem Umsortieren bleibt die Auswahl dieselbe.

import { create } from 'zustand'

const useStore = create<{ ausgewaehlt: ReadonlySet<number>; anker: number | null }>(() => ({
  ausgewaehlt: new Set(),
  anker: null
}))

export function useAuswahl(): ReadonlySet<number> {
  return useStore((s) => s.ausgewaehlt)
}

export function istAusgewaehlt(id: number): boolean {
  return useStore.getState().ausgewaehlt.has(id)
}

/** Klick auf das Bild an Stelle `index` der aktuellen Reihenfolge `ids`. */
export function auswahlKlick(
  ids: readonly number[],
  index: number,
  { strg, umschalt }: { strg: boolean; umschalt: boolean }
): void {
  const id = ids[index]
  if (id === undefined) return
  const { ausgewaehlt, anker } = useStore.getState()
  const ankerIndex = anker === null ? -1 : ids.indexOf(anker)
  if (umschalt && ankerIndex >= 0) {
    const [von, bis] = ankerIndex < index ? [ankerIndex, index] : [index, ankerIndex]
    const neu = new Set(strg ? ausgewaehlt : [])
    for (let i = von; i <= bis; i++) neu.add(ids[i])
    useStore.setState({ ausgewaehlt: neu })
    return
  }
  if (strg) {
    const neu = new Set(ausgewaehlt)
    if (neu.has(id)) neu.delete(id)
    else neu.add(id)
    useStore.setState({ ausgewaehlt: neu, anker: id })
    return
  }
  useStore.setState({ ausgewaehlt: new Set([id]), anker: id })
}

export function auswahlAlle(ids: readonly number[]): void {
  useStore.setState({ ausgewaehlt: new Set(ids) })
}

export function auswahlLeeren(): void {
  useStore.setState({ ausgewaehlt: new Set(), anker: null })
}

/** Rahmen: diese Kennungen; mit Strg zur vorigen Auswahl dazu. */
export function auswahlRahmen(ids: Iterable<number>, vorher: ReadonlySet<number> | null): void {
  useStore.setState({ ausgewaehlt: new Set([...(vorher ?? []), ...ids]) })
}

/** Nach neuer Liste (Filter, Abgleich): nur behalten, was es noch gibt. */
export function auswahlAbgleichen(ids: readonly number[]): void {
  const { ausgewaehlt, anker } = useStore.getState()
  if (!ausgewaehlt.size) return
  const da = new Set(ids)
  const bleibt = [...ausgewaehlt].filter((i) => da.has(i))
  if (bleibt.length === ausgewaehlt.size) return
  useStore.setState({
    ausgewaehlt: new Set(bleibt),
    anker: anker !== null && da.has(anker) ? anker : null
  })
}
