// Liste/Details der Galerie: virtualisierte Tabelle mit kleinem Vorschaubild, wählbaren Spalten
// (gemerkt) und Sortieren per Klick auf die Spaltenüberschrift; Auswahl wie im Raster.
import { useVirtualizer } from '@tanstack/react-virtual'
import { ArrowDownWideNarrow, ArrowUpNarrowWide, Columns3 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { ansichtAendern } from '@renderer/lib/ansicht'
import { auswahlAlle, auswahlKlick, auswahlLeeren, useAuswahl } from '@renderer/lib/auswahl'
import { datumText, groesseText, zahl } from '@renderer/lib/format'
import { cn } from '@renderer/lib/utils'
import type { SortFeld, Sortierung } from '@shared/sortFilter'
import type { ImageInfo } from '@shared/types'
import { Vorschaubild } from './Vorschaubild'

const ZEILE = 40

interface Spalte {
  key: string
  label: string
  breite: string
  sortiert?: SortFeld
  rechts?: boolean
  wert: (b: ImageInfo) => string
}

const SPALTEN: readonly Spalte[] = [
  {
    key: 'name',
    label: 'Name',
    breite: 'minmax(12rem,2fr)',
    sortiert: 'name',
    wert: (b) => b.name
  },
  {
    key: 'aufnahme',
    label: 'Aufgenommen',
    breite: '9.5rem',
    sortiert: 'aufnahme',
    wert: (b) => datumText(b.takenAt) + (b.takenSource.startsWith('datei-') ? ' (Datei)' : '')
  },
  {
    key: 'geaendert',
    label: 'Geändert',
    breite: '9rem',
    sortiert: 'geaendert',
    wert: (b) =>
      new Date(b.mtime).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })
  },
  {
    key: 'kamera',
    label: 'Kamera',
    breite: 'minmax(8rem,1fr)',
    wert: (b) => [b.cameraMake, b.cameraModel].filter(Boolean).join(' ') || '–'
  },
  {
    key: 'masse',
    label: 'Maße',
    breite: '7.5rem',
    wert: (b) => (b.width && b.height ? `${zahl.format(b.width)} × ${zahl.format(b.height)}` : '–')
  },
  {
    key: 'groesse',
    label: 'Größe',
    breite: '6rem',
    sortiert: 'groesse',
    rechts: true,
    wert: (b) => groesseText(b.size)
  },
  {
    key: 'format',
    label: 'Format',
    breite: '5rem',
    sortiert: 'typ',
    wert: (b) => (b.format ?? b.ext).toUpperCase()
  }
]
const STANDARD_SPALTEN = ['name', 'aufnahme', 'kamera', 'masse', 'groesse', 'format']
const SPALTEN_KEY = 'galerie.spalten'

function gemerkteSpalten(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(SPALTEN_KEY) ?? 'null') as unknown
    if (Array.isArray(v)) {
      const gueltig = v.filter((k) => SPALTEN.some((s) => s.key === k)) as string[]
      if (gueltig.includes('name')) return gueltig
    }
  } catch {
    // localStorage nicht verfügbar
  }
  return STANDARD_SPALTEN
}

function Spaltenwahl({
  sichtbar,
  onChange
}: {
  sichtbar: string[]
  onChange: (s: string[]) => void
}): JSX.Element {
  const [offen, setOffen] = useState(false)
  return (
    <div className="relative">
      <button
        type="button"
        aria-haspopup="true"
        aria-expanded={offen}
        onClick={() => setOffen((o) => !o)}
        className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Columns3 className="size-3.5" aria-hidden />
        Spalten
      </button>
      {offen && (
        <fieldset
          className="absolute right-0 top-8 z-20 w-48 rounded-md border bg-card p-2 shadow-lg"
          onKeyDown={(e) => e.key === 'Escape' && setOffen(false)}
        >
          <legend className="sr-only">Sichtbare Spalten</legend>
          {SPALTEN.map((s) => (
            <label key={s.key} className="flex items-center gap-2 rounded px-1.5 py-1 text-sm">
              <input
                type="checkbox"
                checked={sichtbar.includes(s.key)}
                disabled={s.key === 'name'}
                onChange={(e) =>
                  onChange(
                    SPALTEN.map((x) => x.key).filter((k) =>
                      k === s.key ? e.target.checked : sichtbar.includes(k)
                    )
                  )
                }
                className="accent-[rgb(var(--akzent-linie))]"
              />
              {s.label}
            </label>
          ))}
        </fieldset>
      )}
    </div>
  )
}

export function Liste({
  ids,
  details,
  sortierung,
  onSichtbar
}: {
  ids: number[]
  details: {
    get: (id: number) => ImageInfo | undefined
    anfordern: (ids: readonly number[]) => void
  }
  sortierung: Sortierung
  onSichtbar: (ids: readonly number[]) => void
}): JSX.Element {
  const auswahl = useAuswahl()
  const scrollRef = useRef<HTMLDivElement>(null)
  const [sichtbar, setSichtbar] = useState(gemerkteSpalten)
  const spalten = SPALTEN.filter((s) => sichtbar.includes(s.key))
  const raster = `3.5rem ${spalten.map((s) => s.breite).join(' ')}`

  const virt = useVirtualizer({
    count: ids.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ZEILE,
    overscan: 8
  })
  const items = virt.getVirtualItems()
  const von = items[0]?.index ?? 0
  const bis = (items.at(-1)?.index ?? -1) + 1
  useEffect(() => {
    const s = ids.slice(von, bis)
    details.anfordern(s)
    onSichtbar([...s, ...ids.slice(bis, bis + (bis - von))])
  }, [ids, von, bis, details, onSichtbar])

  function spaltenAendern(s: string[]): void {
    setSichtbar(s)
    try {
      localStorage.setItem(SPALTEN_KEY, JSON.stringify(s))
    } catch {
      // nur für diese Sitzung
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex justify-end px-4 pt-1">
        <Spaltenwahl sichtbar={sichtbar} onChange={spaltenAendern} />
      </div>
      <div
        ref={scrollRef}
        role="grid"
        aria-label="Bilder"
        aria-multiselectable="true"
        aria-rowcount={ids.length + 1}
        tabIndex={0}
        className="min-h-0 flex-1 select-none overflow-auto outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        onKeyDown={(e) => {
          if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
            e.preventDefault()
            auswahlAlle(ids)
          } else if (e.key === 'Escape') auswahlLeeren()
        }}
      >
        <div
          role="row"
          aria-rowindex={1}
          className="sticky top-0 z-10 grid items-center border-b bg-background px-4 text-xs text-muted-foreground"
          style={{ gridTemplateColumns: raster, height: ZEILE - 8 }}
        >
          {/* sichtbar leere Zelle, damit das Raster der Spalten stimmt; der Text nur für Screenreader */}
          <span role="columnheader">
            <span className="sr-only">Vorschau</span>
          </span>
          {spalten.map((s) => {
            const aktiv = s.sortiert === sortierung.feld
            const richtung = aktiv
              ? sortierung.richtung === 'auf'
                ? 'ascending'
                : 'descending'
              : 'none'
            return (
              <span
                key={s.key}
                role="columnheader"
                aria-sort={s.sortiert ? richtung : undefined}
                className={cn('px-2', s.rechts && 'text-right')}
              >
                {s.sortiert ? (
                  <button
                    type="button"
                    onClick={() =>
                      ansichtAendern({
                        sortierung: {
                          feld: s.sortiert as SortFeld,
                          richtung: aktiv && sortierung.richtung === 'auf' ? 'ab' : 'auf'
                        }
                      })
                    }
                    className="inline-flex items-center gap-1 font-medium hover:text-foreground"
                  >
                    {s.label}
                    {aktiv &&
                      (sortierung.richtung === 'auf' ? (
                        <ArrowUpNarrowWide className="size-3" aria-hidden />
                      ) : (
                        <ArrowDownWideNarrow className="size-3" aria-hidden />
                      ))}
                  </button>
                ) : (
                  <span className="font-medium">{s.label}</span>
                )}
              </span>
            )
          })}
        </div>
        <div className="relative w-full" style={{ height: virt.getTotalSize() }}>
          {items.map((z) => {
            const id = ids[z.index]
            const b = details.get(id)
            const gewaehlt = auswahl.has(id)
            return (
              <div
                key={id}
                role="row"
                aria-rowindex={z.index + 2}
                aria-selected={gewaehlt}
                data-id={id}
                className={cn(
                  'absolute inset-x-0 grid items-center border-b border-border/50 px-4 text-sm',
                  gewaehlt ? 'bg-primary-line/15' : 'hover:bg-muted/40'
                )}
                style={{ top: z.start, height: ZEILE, gridTemplateColumns: raster }}
                onClick={(e) =>
                  auswahlKlick(ids, z.index, { strg: e.ctrlKey || e.metaKey, umschalt: e.shiftKey })
                }
              >
                <span role="gridcell" className="py-1">
                  <Vorschaubild key={b?.mtime} bild={b} groesse={32} className="rounded-sm" />
                </span>
                {spalten.map((s) => (
                  <span
                    key={s.key}
                    role="gridcell"
                    className={cn('truncate px-2', s.rechts && 'text-right tabular-nums')}
                    title={b && s.key === 'name' ? b.name : undefined}
                  >
                    {b ? s.wert(b) : ''}
                  </span>
                ))}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
