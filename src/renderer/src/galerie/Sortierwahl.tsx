// Auswahl der Sortierung: Feld und Richtung. Gruppen und weitere Felder (Ort, Kamera, Bewertung)
// kommen mit Phase 2 (docs/PLAN.md, „Sortieren, Filtern, Gruppieren, Suchen“).
import { ArrowDownWideNarrow, ArrowUpNarrowWide } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { sortierungSetzen, useSortierung } from '@renderer/lib/bildliste'
import type { SortFeld } from '@shared/sortFilter'

export const FELD_TEXT: Record<SortFeld, string> = {
  aufnahme: 'Aufnahmedatum',
  name: 'Name',
  geaendert: 'Änderungsdatum',
  groesse: 'Dateigröße',
  typ: 'Dateityp'
}

export function Sortierwahl(): JSX.Element {
  const s = useSortierung()
  const ab = s.richtung === 'ab'
  return (
    <div className="flex items-center gap-1.5">
      <label htmlFor="sortierung" className="text-xs text-muted-foreground">
        Sortieren nach
      </label>
      <select
        id="sortierung"
        value={s.feld}
        onChange={(e) => sortierungSetzen({ ...s, feld: e.target.value as SortFeld })}
        className="h-8 rounded-md border border-border bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70"
      >
        {(Object.keys(FELD_TEXT) as SortFeld[]).map((f) => (
          <option key={f} value={f}>
            {FELD_TEXT[f]}
          </option>
        ))}
      </select>
      <Button
        variant="ghost"
        size="icon"
        className="size-8"
        aria-label="Absteigend"
        aria-pressed={ab}
        title={ab ? 'Absteigend – klicken für aufsteigend' : 'Aufsteigend – klicken für absteigend'}
        onClick={() => sortierungSetzen({ ...s, richtung: ab ? 'auf' : 'ab' })}
      >
        {ab ? (
          <ArrowDownWideNarrow className="size-4" aria-hidden />
        ) : (
          <ArrowUpNarrowWide className="size-4" aria-hidden />
        )}
      </Button>
    </div>
  )
}
