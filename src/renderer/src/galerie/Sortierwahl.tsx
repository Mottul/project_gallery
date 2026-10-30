// Auswahl der Sortierung (je Bibliotheksordner gemerkt): Feld und Richtung, dazu die Gruppen, die
// der Sortierung folgen (docs/PLAN.md, „Sortieren, Filtern, Gruppieren, Suchen“): nach Datum mit
// Stufe Tag/Monat/Jahr, nach Ort, Kamera … an/aus, nach Name, Größe, ISO … keine.
import { ArrowDownWideNarrow, ArrowUpNarrowWide, Rows3 } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { ansichtAendern, useAnsicht } from '@renderer/lib/ansicht'
import { cn } from '@renderer/lib/utils'
import { GRUPPIERUNGEN, gruppenArt, hatStufen, type Gruppierung } from '@shared/gruppen'
import type { SortFeld } from '@shared/sortFilter'

export const FELD_TEXT: Record<SortFeld, string> = {
  aufnahme: 'Aufnahmedatum',
  name: 'Name',
  geaendert: 'Änderungsdatum',
  groesse: 'Dateigröße',
  typ: 'Dateityp',
  ort: 'Ort (A–Z)',
  kamera: 'Kamera',
  objektiv: 'Objektiv',
  bewertung: 'Bewertung',
  iso: 'ISO',
  blende: 'Blende',
  belichtung: 'Belichtungszeit',
  brennweite: 'Brennweite',
  aufloesung: 'Auflösung',
  ordner: 'Ordner'
}

const STUFE_TEXT: Record<Gruppierung, string> = {
  aus: 'Keine',
  tag: 'Tag',
  monat: 'Monat',
  jahr: 'Jahr'
}

export const AUSWAHL =
  'h-8 rounded-md border border-border bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70'

export function Sortierwahl(): JSX.Element {
  const s = useAnsicht().sortierung
  const ab = s.richtung === 'ab'
  return (
    <div className="flex items-center gap-1.5">
      <label htmlFor="sortierung" className="text-xs text-muted-foreground">
        Sortieren<span className="sr-only"> nach</span>
      </label>
      <select
        id="sortierung"
        value={s.feld}
        onChange={(e) => ansichtAendern({ sortierung: { ...s, feld: e.target.value as SortFeld } })}
        className={AUSWAHL}
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
        onClick={() => ansichtAendern({ sortierung: { ...s, richtung: ab ? 'auf' : 'ab' } })}
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

/** Gruppen-Überschriften; ohne Gruppen zur Sortierung (Name, Größe …) gar nicht da. */
export function Gruppenwahl(): JSX.Element | null {
  const { sortierung, gruppierung } = useAnsicht()
  const art = gruppenArt(sortierung.feld)
  if (!art) return null
  if (hatStufen(art)) {
    return (
      <div className="flex items-center gap-1.5">
        <label htmlFor="gruppen" className="text-xs text-muted-foreground">
          Gruppen
        </label>
        <select
          id="gruppen"
          value={gruppierung}
          onChange={(e) => ansichtAendern({ gruppierung: e.target.value as Gruppierung })}
          className={AUSWAHL}
        >
          {GRUPPIERUNGEN.map((g) => (
            <option key={g} value={g}>
              {STUFE_TEXT[g]}
            </option>
          ))}
        </select>
      </div>
    )
  }
  const an = gruppierung !== 'aus'
  return (
    <Button
      variant="ghost"
      size="sm"
      aria-pressed={an}
      title={an ? 'Gruppen ausblenden' : 'Gruppen zeigen'}
      className={cn('h-8 gap-1.5', an ? 'bg-muted text-foreground' : 'text-muted-foreground')}
      onClick={() => ansichtAendern({ gruppierung: an ? 'aus' : 'monat' })}
    >
      <Rows3 className="size-3.5" aria-hidden />
      Gruppen
    </Button>
  )
}
