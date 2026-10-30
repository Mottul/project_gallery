// Filter und Suche der Galerie (Phase 2.4): Zustand nur für diese Sitzung und über alle Ordner –
// ein Filter gilt, bis er zurückgesetzt oder die App neu gestartet wird (entschieden 30.10.2026);
// so fehlen nach dem Start nie unbemerkt Bilder. Dauerhaft merkt nur „Ansicht speichern“ (2.4b).
// `filterNeu` und `filterChips` sind rein, getestet in filter.test.ts.

import { create } from 'zustand'
import { farblabelText, type BildFilter } from '@shared/bildFilter'
import { gruppenTitel } from '@shared/gruppen'
import { tagText } from './format'

/** Kriterium setzen: undefined, leerer Text und leere Liste nehmen es weg. */
export function filterNeu(alt: BildFilter, patch: Partial<BildFilter>): BildFilter {
  const neu: Record<string, unknown> = { ...alt, ...patch }
  for (const [k, w] of Object.entries(neu)) {
    if (w === undefined || w === '' || (Array.isArray(w) && w.length === 0)) delete neu[k]
  }
  const f = neu as BildFilter
  // ein Zeitraum „rückwärts“ wäre ungültig: das gerade Geänderte gilt, das andere Ende fällt weg
  if (f.von && f.bis && f.von > f.bis) {
    if (patch.von) delete f.bis
    else delete f.von
  }
  return f
}

const AUSRICHTUNG: Record<NonNullable<BildFilter['ausrichtung']>, string> = {
  hoch: 'Hochformat',
  quer: 'Querformat',
  quadrat: 'Quadratisch'
}

export const ausrichtungText = (a: NonNullable<BildFilter['ausrichtung']>): string => AUSRICHTUNG[a]

/** Ein aktives Kriterium als Chip: Text und was zum Entfernen zu setzen ist. */
export interface Chip {
  schluessel: string
  text: string
  weg: Partial<BildFilter>
}

/** Aktive Kriterien als Chips – die Suche nicht, sie steht schon im Suchfeld. */
export function filterChips(f: BildFilter): Chip[] {
  const out: Chip[] = []
  if (f.von) out.push({ schluessel: 'von', text: `Ab ${tagText(f.von)}`, weg: { von: undefined } })
  if (f.bis) out.push({ schluessel: 'bis', text: `Bis ${tagText(f.bis)}`, weg: { bis: undefined } })
  if (f.bewertung !== undefined) {
    out.push({
      schluessel: 'bewertung',
      text: `Bewertung ≥ ${f.bewertung}`,
      weg: { bewertung: undefined }
    })
  }
  const liste = (
    feld: 'farben' | 'kameras' | 'orte' | 'stichwoerter' | 'formate',
    text: (w: string) => string
  ): void => {
    const l = f[feld] ?? []
    for (const w of l) {
      out.push({
        schluessel: `${feld}:${w}`,
        text: text(w),
        weg: { [feld]: l.filter((x) => x !== w) }
      })
    }
  }
  liste('farben', farblabelText)
  liste('kameras', (w) => w)
  liste('orte', (w) => gruppenTitel('ort', w))
  liste('stichwoerter', (w) => w)
  liste('formate', (w) => w.toUpperCase())
  if (f.ausrichtung) {
    out.push({
      schluessel: 'ausrichtung',
      text: ausrichtungText(f.ausrichtung),
      weg: { ausrichtung: undefined }
    })
  }
  if (f.standort) {
    out.push({
      schluessel: 'standort',
      text: f.standort === 'mit' ? 'Mit Standort' : 'Ohne Standort',
      weg: { standort: undefined }
    })
  }
  return out
}

const useStore = create<{ filter: BildFilter; offen: boolean }>(() => ({
  filter: {},
  offen: false
}))

export const useBildFilter = (): BildFilter => useStore((s) => s.filter)
export const useFilterOffen = (): boolean => useStore((s) => s.offen)

export const filterLeisteUmschalten = (): void => useStore.setState((s) => ({ offen: !s.offen }))
export const filterAendern = (patch: Partial<BildFilter>): void =>
  useStore.setState((s) => ({ filter: filterNeu(s.filter, patch) }))
export const filterZuruecksetzen = (): void => useStore.setState({ filter: {} })
/** Eine gespeicherte Ansicht bringt ihren ganzen Filter mit. */
export const filterSetzen = (filter: BildFilter): void => useStore.setState({ filter })
export const filterLesen = (): BildFilter => useStore.getState().filter
