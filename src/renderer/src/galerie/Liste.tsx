// Liste/Details der Galerie: virtualisierte Tabelle mit kleinem Vorschaubild, wählbaren Spalten
// (gemerkt) und Sortieren per Klick auf die Spaltenüberschrift; Auswahl wie im Raster,
// Gruppen-Überschriften (2.3) als eigene Zeilen.
import { useVirtualizer } from '@tanstack/react-virtual'
import { ArrowDownWideNarrow, ArrowUpNarrowWide, Columns3 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { ansichtAendern } from '@renderer/lib/ansicht'
import {
  auswahlAlle,
  auswahlKlick,
  auswahlLeeren,
  ersteGewaehlte,
  useAuswahl
} from '@renderer/lib/auswahl'
import { datumText, groesseText, zahl } from '@renderer/lib/format'
import { cn } from '@renderer/lib/utils'
import { zeilenBilden } from '@renderer/lib/zeilen'
import type { Gruppe } from '@shared/gruppen'
import type { SortFeld, Sortierung } from '@shared/sortFilter'
import type { ImageInfo } from '@shared/types'
import { Vorschaubild } from './Vorschaubild'

const ZEILE = 40
/** Höhe einer Gruppen-Überschrift */
const KOPF = 36

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
    sortiert: 'kamera',
    wert: (b) => [b.cameraMake, b.cameraModel].filter(Boolean).join(' ') || '–'
  },
  {
    key: 'ort',
    label: 'Ort',
    breite: 'minmax(8rem,1fr)',
    sortiert: 'ort',
    wert: (b) => (b.place ? [b.place.name, b.place.country].filter(Boolean).join(', ') : '–')
  },
  {
    key: 'masse',
    label: 'Maße',
    breite: '7.5rem',
    sortiert: 'aufloesung',
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
  gruppen,
  details,
  sortierung,
  onSichtbar,
  onOeffnen
}: {
  ids: number[]
  /** Gruppen-Überschriften (leer = keine) */
  gruppen: readonly Gruppe[]
  details: {
    get: (id: number) => ImageInfo | undefined
    anfordern: (ids: readonly number[]) => void
  }
  sortierung: Sortierung
  onSichtbar: (ids: readonly number[]) => void
  onOeffnen: (index: number) => void
}): JSX.Element {
  const auswahl = useAuswahl()
  const scrollRef = useRef<HTMLDivElement>(null)
  const [sichtbar, setSichtbar] = useState(gemerkteSpalten)
  const spalten = SPALTEN.filter((s) => sichtbar.includes(s.key))
  const raster = `3.5rem ${spalten.map((s) => s.breite).join(' ')}`

  const zeilen = useMemo(() => zeilenBilden(ids.length, gruppen, 1), [ids, gruppen])
  const virt = useVirtualizer({
    count: zeilen.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (i) => (zeilen[i]?.art === 'kopf' ? KOPF : ZEILE),
    overscan: 8
  })
  useEffect(() => {
    virt.measure()
  }, [virt, zeilen])
  const items = virt.getVirtualItems()
  const von = zeilen[items[0]?.index ?? 0]?.von ?? 0
  const letzte = zeilen[items.at(-1)?.index ?? -1]
  const bis = letzte ? (letzte.art === 'bilder' ? letzte.bis : letzte.von) : 0
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
        aria-rowcount={zeilen.length + 1}
        tabIndex={0}
        className="min-h-0 flex-1 select-none overflow-auto outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        onKeyDown={(e) => {
          if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
            e.preventDefault()
            auswahlAlle(ids)
          } else if (e.key === 'Escape') auswahlLeeren()
          else if (e.key === 'Enter') {
            const i = ersteGewaehlte(ids)
            if (i >= 0) onOeffnen(i)
          }
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
            const zeile = zeilen[z.index]
            if (zeile.art === 'kopf') {
              return (
                <div
                  key={`kopf-${zeile.von}`}
                  role="row"
                  aria-rowindex={z.index + 2}
                  data-gruppe={zeile.titel}
                  className="absolute inset-x-0 flex items-end border-b px-4 pb-1.5"
                  style={{ top: z.start, height: KOPF }}
                >
                  <span
                    role="gridcell"
                    aria-colspan={spalten.length + 1}
                    className="flex min-w-0 items-baseline gap-2"
                  >
                    <span className="truncate text-sm font-semibold">{zeile.titel}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {zeile.anzahl === 1 ? '1 Bild' : `${zahl.format(zeile.anzahl)} Bilder`}
                    </span>
                  </span>
                </div>
              )
            }
            const index = zeile.von
            const id = ids[index]
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
                  auswahlKlick(ids, index, { strg: e.ctrlKey || e.metaKey, umschalt: e.shiftKey })
                }
                onDoubleClick={() => onOeffnen(index)}
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
