// Suche und Filter der Galerie (Phase 2.4; entschieden 30.10.2026: Suchfeld in der Werkzeugleiste,
// der Knopf „Filter“ klappt darunter die Leiste auf; aktive Filter als Chips, „12 von 340 Bildern“).
// Die Auswahllisten kommen aus dem Index (`library.facets`), der Zustand aus `lib/filter.ts`.
import { ChevronDown, Search, SlidersHorizontal, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Button } from '@renderer/components/ui/button'
import {
  ausrichtungText,
  filterAendern,
  filterChips,
  filterLeisteUmschalten,
  filterZuruecksetzen,
  useBildFilter,
  useFilterOffen
} from '@renderer/lib/filter'
import { zahl } from '@renderer/lib/format'
import { cn } from '@renderer/lib/utils'
import {
  filterAktiv,
  SUCHE_MAX,
  type BildFilter,
  type Facetten,
  type FilterWert,
  type ListenFeld
} from '@shared/bildFilter'
import { AnsichtSpeichern } from './Ansichten'
import { AUSWAHL } from './Sortierwahl'

/** Tippen abwarten, bevor gesucht wird (ms) */
const SUCHE_WARTEN_MS = 250
/** Ab so vielen Einträgen hat eine Auswahlliste ein eigenes Suchfeld */
const LISTE_MIT_SUCHE = 8
/** Höchstens so viele Einträge im DOM; der Rest über die Suche in der Liste */
const LISTE_GEZEIGT = 300
/** Breite der aufgeklappten Liste in px (w-64) und Abstand zum Fensterrand */
const LISTE_BREITE = 256
const FENSTER_RAND = 8

export function Suchfeld(): JSX.Element {
  const suche = useBildFilter().suche ?? ''
  const [text, setText] = useState(suche)
  // von außen geändert (Zurücksetzen) – Leerzeichen am Ende des Getippten nicht wegnehmen
  useEffect(() => {
    setText((t) => (t.trim() === suche ? t : suche))
  }, [suche])
  useEffect(() => {
    if (text.trim() === suche) return
    const t = setTimeout(() => filterAendern({ suche: text.trim() }), SUCHE_WARTEN_MS)
    return () => clearTimeout(t)
  }, [text, suche])
  return (
    <div className="relative">
      <Search
        className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
        aria-hidden
      />
      <input
        type="search"
        aria-label="Bilder suchen"
        placeholder="Suchen …"
        title="Name, Titel, Beschreibung, Stichwörter, Ort"
        maxLength={SUCHE_MAX}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && text) {
            e.stopPropagation()
            setText('')
            filterAendern({ suche: '' })
          }
        }}
        className={cn(AUSWAHL, 'w-32 pl-7')}
      />
    </div>
  )
}

export function FilterKnopf(): JSX.Element {
  const offen = useFilterOffen()
  const f = useBildFilter()
  const anzahl = filterChips(f).length
  return (
    <Button
      variant="ghost"
      size="sm"
      aria-expanded={offen}
      aria-label={anzahl ? `Filter (${anzahl} aktiv)` : 'Filter'}
      className={cn(
        'h-8 gap-1.5',
        offen || anzahl ? 'bg-muted text-foreground' : 'text-muted-foreground'
      )}
      onClick={filterLeisteUmschalten}
    >
      <SlidersHorizontal className="size-3.5" aria-hidden />
      Filter
      {anzahl > 0 && <span aria-hidden>({anzahl})</span>}
    </Button>
  )
}

/** Aufklappbare Liste mit Häkchen; mehrere Werte eines Kriteriums gelten mit „oder“. */
function Auswahlliste({
  titel,
  feld,
  werte
}: {
  titel: string
  feld: ListenFeld
  werte: readonly FilterWert[]
}): JSX.Element {
  const gewaehlt = useBildFilter()[feld] ?? []
  const [offen, setOffen] = useState(false)
  const [suche, setSuche] = useState('')
  /** am rechten Fensterrand nach links aufklappen – sonst schnitte das Fenster die Liste ab */
  const [nachLinks, setNachLinks] = useState(false)
  const rahmen = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!offen) return
    const zu = (e: MouseEvent): void => {
      if (!rahmen.current?.contains(e.target as Node)) setOffen(false)
    }
    document.addEventListener('mousedown', zu)
    return () => document.removeEventListener('mousedown', zu)
  }, [offen])
  const nadel = suche.trim().toLowerCase()
  const sichtbar = nadel ? werte.filter((w) => w.titel.toLowerCase().includes(nadel)) : werte
  return (
    <div ref={rahmen} className="relative">
      <Button
        variant="outline"
        size="sm"
        aria-haspopup="true"
        aria-expanded={offen}
        disabled={werte.length === 0}
        className="h-8 gap-1"
        onClick={() => {
          const links = rahmen.current?.getBoundingClientRect().left ?? 0
          setNachLinks(links + LISTE_BREITE + FENSTER_RAND > window.innerWidth)
          setOffen((o) => !o)
        }}
      >
        {titel}
        {gewaehlt.length > 0 && <span>({gewaehlt.length})</span>}
        <ChevronDown className="size-3.5" aria-hidden />
      </Button>
      {offen && (
        <fieldset
          className={cn(
            'absolute top-9 z-20 max-h-72 w-64 overflow-auto rounded-md border bg-card p-2 shadow-lg',
            nachLinks ? 'right-0' : 'left-0'
          )}
          onKeyDown={(e) => e.key === 'Escape' && setOffen(false)}
        >
          <legend className="sr-only">{titel} wählen</legend>
          {werte.length > LISTE_MIT_SUCHE && (
            <input
              type="search"
              aria-label={`${titel} suchen`}
              placeholder="Suchen …"
              value={suche}
              onChange={(e) => setSuche(e.target.value)}
              className={cn(AUSWAHL, 'mb-1 w-full')}
            />
          )}
          {sichtbar.slice(0, LISTE_GEZEIGT).map((w) => (
            <label key={w.wert} className="flex items-center gap-2 rounded px-1.5 py-1 text-sm">
              <input
                type="checkbox"
                checked={gewaehlt.includes(w.wert)}
                onChange={(e) =>
                  filterAendern({
                    [feld]: e.target.checked
                      ? [...gewaehlt, w.wert]
                      : gewaehlt.filter((x) => x !== w.wert)
                  })
                }
                className="accent-[rgb(var(--akzent-linie))]"
              />
              <span className="min-w-0 flex-1 truncate" title={w.titel}>
                {w.titel}
              </span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {zahl.format(w.anzahl)}
              </span>
            </label>
          ))}
          {sichtbar.length === 0 && (
            <p className="px-1.5 py-1 text-xs text-muted-foreground">Keine Treffer</p>
          )}
          {sichtbar.length > LISTE_GEZEIGT && (
            <p className="px-1.5 py-1 text-xs text-muted-foreground">
              {zahl.format(sichtbar.length - LISTE_GEZEIGT)} weitere – bitte suchen
            </p>
          )}
        </fieldset>
      )}
    </div>
  )
}

function Tag({
  beschriftung,
  wert,
  min,
  max,
  onChange
}: {
  beschriftung: string
  wert: string | undefined
  min?: string
  max?: string
  onChange: (v: string) => void
}): JSX.Element {
  return (
    <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
      {beschriftung}
      <input
        type="date"
        value={wert ?? ''}
        min={min}
        max={max}
        onChange={(e) => onChange(e.target.value)}
        className={AUSWAHL}
      />
    </label>
  )
}

function Wahl<T extends string>({
  beschriftung,
  wert,
  optionen,
  onChange
}: {
  beschriftung: string
  wert: T | undefined
  optionen: readonly (readonly [T, string])[]
  onChange: (v: T | undefined) => void
}): JSX.Element {
  return (
    <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
      {beschriftung}
      <select
        value={wert ?? ''}
        onChange={(e) => onChange((e.target.value || undefined) as T | undefined)}
        className={AUSWAHL}
      >
        <option value="">Alle</option>
        {optionen.map(([v, text]) => (
          <option key={v} value={v}>
            {text}
          </option>
        ))}
      </select>
    </label>
  )
}

const BEWERTUNGEN = [1, 2, 3, 4, 5].map((n) => [String(n), `ab ${n} ★`] as const)
const AUSRICHTUNGEN = (['hoch', 'quer', 'quadrat'] as const).map(
  (a) => [a, ausrichtungText(a)] as const
)
const STANDORTE = [
  ['mit', 'Mit Standort'],
  ['ohne', 'Ohne Standort']
] as const

/** Die aufgeklappte Leiste und – auch zugeklappt – die aktiven Filter als Chips. */
export function Filterleiste({
  facetten,
  anzahl,
  gesamt
}: {
  facetten: Facetten | null
  /** Bilder nach dem Filter */
  anzahl: number | null
  /** Bilder im Knoten ohne Filter */
  gesamt: number | undefined
}): JSX.Element | null {
  const f: BildFilter = useBildFilter()
  const offen = useFilterOffen()
  const chips = filterChips(f)
  const aktiv = filterAktiv(f)
  if (!offen && !aktiv) return null
  return (
    <div role="region" aria-label="Filter" className="shrink-0 space-y-2 border-b px-4 py-2">
      {offen && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <Tag
            beschriftung="Von"
            wert={f.von}
            min={facetten?.zeitraum.von ?? undefined}
            max={facetten?.zeitraum.bis ?? undefined}
            onChange={(v) => filterAendern({ von: v })}
          />
          <Tag
            beschriftung="Bis"
            wert={f.bis}
            min={facetten?.zeitraum.von ?? undefined}
            max={facetten?.zeitraum.bis ?? undefined}
            onChange={(v) => filterAendern({ bis: v })}
          />
          <Wahl
            beschriftung="Bewertung"
            wert={f.bewertung === undefined ? undefined : (String(f.bewertung) as '1')}
            optionen={BEWERTUNGEN}
            onChange={(v) => filterAendern({ bewertung: v ? Number(v) : undefined })}
          />
          <Auswahlliste titel="Farblabel" feld="farben" werte={facetten?.farben ?? []} />
          <Auswahlliste titel="Kamera" feld="kameras" werte={facetten?.kameras ?? []} />
          <Auswahlliste titel="Ort" feld="orte" werte={facetten?.orte ?? []} />
          <Auswahlliste
            titel="Stichwort"
            feld="stichwoerter"
            werte={facetten?.stichwoerter ?? []}
          />
          <Auswahlliste titel="Format" feld="formate" werte={facetten?.formate ?? []} />
          <Wahl
            beschriftung="Ausrichtung"
            wert={f.ausrichtung}
            optionen={AUSRICHTUNGEN}
            onChange={(v) => filterAendern({ ausrichtung: v })}
          />
          <Wahl
            beschriftung="Standort"
            wert={f.standort}
            optionen={STANDORTE}
            onChange={(v) => filterAendern({ standort: v })}
          />
        </div>
      )}
      <div className="flex flex-wrap items-center gap-1.5">
        {aktiv && (
          <>
            {chips.map((c) => (
              <button
                key={c.schluessel}
                type="button"
                aria-label={`Filter entfernen: ${c.text}`}
                onClick={() => filterAendern(c.weg)}
                className="inline-flex max-w-64 items-center gap-1 rounded-full bg-primary-line/15 px-2.5 py-0.5 text-xs text-foreground outline-none hover:bg-primary-line/25 focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="truncate">{c.text}</span>
                <X className="size-3 shrink-0" aria-hidden />
              </button>
            ))}
            <Button variant="ghost" size="sm" className="h-6 px-2" onClick={filterZuruecksetzen}>
              Zurücksetzen
            </Button>
          </>
        )}
        <AnsichtSpeichern />
        {aktiv && anzahl !== null && gesamt !== undefined && (
          <span className="ml-auto text-xs text-muted-foreground">
            {zahl.format(anzahl)} von {zahl.format(gesamt)} Bildern
          </span>
        )}
      </div>
    </div>
  )
}
