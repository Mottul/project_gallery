// Hauptfläche der Galerie (docs/PLAN.md, „Galerie-Ansichten“; Entwurf „Galerie – Kacheln/Liste“):
// ohne Ordner der Einstieg; sonst eine Kopfzeile (gewählter Knoten, Kacheln/Liste, Sortieren,
// Gruppen, Suche, Filter, Größe, Metadaten) über Raster oder Liste. Ordner lassen sich aus dem
// Explorer hineinziehen – die Seite gibt dabei nur die Datei-Objekte weiter, den Pfad liest der
// Preload (Schicht C). Mehrfachauswahl (3.3; entschieden 9.11.2026): „Metadaten“ bzw. Taste E öffnet
// die Ansicht für die gewählten Bilder; im Raster schreiben 0–5 und 6–9 für alle gewählten – eines
// sofort wie im Betrachter, ab zwei nach einer Rückfrage im main, mit Fortschritt und Abbrechen.
import { BrickWall, FolderInput, FolderPlus, Images, LayoutGrid, List, Tag } from 'lucide-react'
import { useCallback, useEffect, useState, type DragEvent } from 'react'
import { Button } from '@renderer/components/ui/button'
import {
  ansichtAendern,
  GROESSE_MAX,
  GROESSE_MIN,
  knotenWaehlen,
  useAnsicht,
  useKnoten,
  type AnsichtArt
} from '@renderer/lib/ansicht'
import { api } from '@renderer/lib/api'
import { auswahlAbgleichen, auswahlNur, useAuswahl } from '@renderer/lib/auswahl'
import { zahl } from '@renderer/lib/format'
import { auftragLaeuft, auftragStarten, LAEUFT_SCHON, useAuftrag } from '@renderer/lib/metaAuftrag'
import { errorText } from '@renderer/lib/utils'
import type { Farblabel, MetaAenderung } from '@shared/metaFields'
import { MEHRFACH_MAX } from '@shared/metaMehrfach'
import {
  angezeigtMelden,
  useDetails,
  useFacetten,
  useKennungen,
  useSichtbarMelden
} from '@renderer/lib/bildliste'
import {
  ordnerGezogen,
  ordnerHinzufuegen,
  useHinzufuegenStatus,
  useLibrary
} from '@renderer/lib/library'
import { filterZuruecksetzen, useBildFilter, useFilterOffen } from '@renderer/lib/filter'
import { cn } from '@renderer/lib/utils'
import { farblabelText, filterAktiv } from '@shared/bildFilter'
import { Betrachter } from './Betrachter'
import { FilterKnopf, Filterleiste, Suchfeld } from './Filterleiste'
import { Liste } from './Liste'
import { MetaMehrfach } from './MetaMehrfach'
import { Raster } from './Raster'
import { Rasterhinweis, type Rueckmeldung } from './Rasterhinweis'
import { Gruppenwahl, Sortierwahl } from './Sortierwahl'

const istDateien = (e: DragEvent): boolean => Array.from(e.dataTransfer.types).includes('Files')

const LABEL_TASTEN = new Map<string, Farblabel>([
  ['6', 'Red'],
  ['7', 'Yellow'],
  ['8', 'Green'],
  ['9', 'Blue']
])

/**
 * Was eine Taste im Raster schreibt. `labelVorher`: das Label des einen gewählten Bildes – dieselbe
 * Taste nimmt es wieder weg (wie im Betrachter); bei mehreren Bildern setzt die Taste immer.
 */
function tastenAenderung(
  taste: string,
  labelVorher: string | null | undefined
): { a: Pick<MetaAenderung, 'bewertung' | 'farblabel'>; text: string; fertig: string } | null {
  if (/^[0-5]$/.test(taste)) {
    const n = Number(taste)
    if (n === 0)
      return { a: { bewertung: 0 }, text: 'Bewertung entfernen', fertig: 'Bewertung entfernt' }
    const s = n === 1 ? '1 Stern' : `${n} Sterne`
    return { a: { bewertung: n }, text: s, fertig: `${s} gespeichert` }
  }
  const label = LABEL_TASTEN.get(taste)
  if (!label) return null
  if (labelVorher === label) {
    return { a: { farblabel: null }, text: 'Farblabel entfernen', fertig: 'Farblabel entfernt' }
  }
  const t = `Farblabel ${farblabelText(label)}`
  return { a: { farblabel: label }, text: t, fertig: `${t} gespeichert` }
}

function Umschalter({ art }: { art: AnsichtArt }): JSX.Element {
  const knopf = (wert: AnsichtArt, text: string, Icon: typeof LayoutGrid): JSX.Element => (
    <button
      type="button"
      aria-pressed={art === wert}
      onClick={() => ansichtAendern({ art: wert })}
      className={cn(
        'inline-flex h-7 items-center gap-1.5 rounded-[5px] px-2.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring',
        art === wert
          ? 'bg-card text-foreground shadow-sm'
          : 'text-muted-foreground hover:text-foreground'
      )}
    >
      <Icon className="size-3.5" aria-hidden />
      {text}
    </button>
  )
  return (
    <div role="group" aria-label="Ansicht" className="flex rounded-md bg-muted p-0.5">
      {knopf('kacheln', 'Kacheln', LayoutGrid)}
      {knopf('blocksatz', 'Blocksatz', BrickWall)}
      {knopf('liste', 'Liste', List)}
    </div>
  )
}

export function Galerie(): JSX.Element | null {
  const lib = useLibrary()
  const { waehlt } = useHinzufuegenStatus()
  const gemerkt = useKnoten()
  // ein inzwischen entfernter Ordner: alle Bilder zeigen
  const knoten =
    gemerkt && lib && !lib.folders.some((f) => f.id === gemerkt.ordner) ? null : gemerkt
  useEffect(() => {
    if (lib && gemerkt && !knoten) knotenWaehlen(null)
  }, [lib, gemerkt, knoten])
  const ansicht = useAnsicht()
  const blocksatz = ansicht.art === 'blocksatz'
  const bildFilter = useBildFilter()
  const filterOffen = useFilterOffen()
  const facetten = useFacetten(lib, knoten, filterOffen)
  const k = useKennungen(
    lib,
    knoten,
    ansicht.sortierung,
    ansicht.gruppierung,
    blocksatz,
    bildFilter
  )
  const details = useDetails(k?.stand ?? 0)
  const sichtbarMelden = useSichtbarMelden()
  const [ziehen, setZiehen] = useState(false)
  /** offen im Betrachter: Startstelle in `k.ids`; danach das zuletzt gezeigte Bild */
  const [betrachter, setBetrachter] = useState<number | null>(null)
  const [fokusId, setFokusId] = useState<number | null>(null)
  const schliessen = useCallback((id: number | null) => {
    setBetrachter(null)
    if (id !== null) {
      auswahlNur(id)
      setFokusId(id)
    }
  }, [])
  const auswahl = useAuswahl()
  const auftrag = useAuftrag()
  /** offen in „Metadaten bearbeiten“: die gewählten Bilder beim Öffnen (bleiben fest) */
  const [mehrfach, setMehrfach] = useState<number[] | null>(null)
  /** Hinweis unter der Kopfzeile (Rückfrage verneint gibt keinen) */
  const [hinweis, setHinweis] = useState<string | null>(null)
  /** Gerade für ein Bild geschrieben: was „Rückgängig“ zurücknimmt */
  const [rueck, setRueck] = useState<Rueckmeldung | null>(null)

  useEffect(() => {
    if (k) auswahlAbgleichen(k.ids)
    angezeigtMelden(k && !k.fehler ? k.ids.length : null)
  }, [k])

  /** Die gewählten Bilder in der Reihenfolge der Galerie */
  const gewaehlt = useCallback(
    (): number[] => (k && !k.fehler ? k.ids.filter((id) => auswahl.has(id)) : []),
    [k, auswahl]
  )

  const metadatenOeffnen = useCallback(() => {
    const ids = gewaehlt()
    if (!ids.length) return
    if (auftragLaeuft()) return setHinweis(LAEUFT_SCHON)
    if (ids.length > MEHRFACH_MAX) {
      return setHinweis(
        `Höchstens ${zahl.format(MEHRFACH_MAX)} Bilder auf einmal – bitte weniger auswählen.`
      )
    }
    setHinweis(null)
    setRueck(null)
    setMehrfach(ids)
  }, [gewaehlt])

  /** Schnellbewertung im Raster: Tasten 0–5 und 6–9 für alle gewählten Bilder */
  const schnell = useCallback(
    async (taste: string) => {
      const ids = gewaehlt()
      if (!ids.length) return
      const t = tastenAenderung(taste, ids.length === 1 ? details.get(ids[0])?.colorLabel : null)
      if (!t) return
      if (auftragLaeuft()) return setHinweis(LAEUFT_SCHON)
      setHinweis(null)
      setRueck(null)
      if (ids.length === 1) {
        // ein Bild: sofort wie im Betrachter
        try {
          const r = await api.meta.write(ids, t.a)
          details.setzen(r.geschrieben)
          const f = r.fehler[0]
          if (f) setHinweis(f.grund)
          else setRueck({ text: t.fertig, journal: r.journal })
        } catch (err) {
          setHinweis(errorText(err))
        }
        return
      }
      // ab zwei: Rückfrage im main („3 Sterne für 12 Bilder schreiben?“), dann Fortschritt
      const r = await auftragStarten('raster', 'schreiben', ids.length, t.text, () =>
        api.meta.writeMany(ids, t.a, { rueckfrage: true })
      )
      if ('grund' in r) setHinweis(r.grund)
    },
    [gewaehlt, details]
  )

  /** „Rückgängig“ (auch Strg+Z) für den letzten Hinweis im Raster – ein Bild oder ein ganzer Auftrag */
  const rueckgaengig = useCallback(async () => {
    if (rueck) {
      setRueck(null)
      try {
        const r = await api.meta.undo(rueck.journal)
        details.setzen(r.geschrieben)
        setHinweis(r.fehler[0]?.grund ?? null)
      } catch (err) {
        setHinweis(errorText(err))
      }
      return
    }
    const journal =
      auftrag?.quelle === 'raster' && auftrag.art === 'schreiben' ? auftrag.ende?.journal : null
    if (!journal?.length || auftragLaeuft()) return
    const r = await auftragStarten('raster', 'rueckgaengig', journal.length, 'Rückgängig', () =>
      api.meta.undoMany(journal)
    )
    if ('grund' in r) setHinweis(r.grund)
  }, [rueck, auftrag, details])

  // über einer offenen Ansicht oder dem Betrachter wirken die Tasten des Rasters nicht
  const tastenFrei = mehrfach === null && betrachter === null

  function ablegen(e: DragEvent): void {
    if (!istDateien(e)) return
    e.preventDefault()
    setZiehen(false)
    void ordnerGezogen(Array.from(e.dataTransfer.files)).then((neu) => {
      if (neu.length === 1) knotenWaehlen({ ordner: neu[0], pfad: '' })
    })
  }
  const zieh = {
    onDragEnter: (e: DragEvent) => {
      if (!istDateien(e)) return
      e.preventDefault()
      setZiehen(true)
    },
    onDragOver: (e: DragEvent) => {
      if (!istDateien(e)) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'copy'
    },
    onDragLeave: (e: DragEvent) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setZiehen(false)
    },
    onDrop: ablegen
  }
  const ablage = ziehen && (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-2 z-30 flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-primary-line bg-background/90 text-center"
    >
      <FolderInput className="size-10 text-primary-line" />
      <p className="text-sm font-medium">Ordner hier ablegen</p>
      <p className="max-w-xs text-xs text-muted-foreground">
        Sie werden zur Galerie hinzugefügt. Die Dateien bleiben, wo sie sind.
      </p>
    </div>
  )

  if (!lib) return null
  if (!lib.folders.length) {
    return (
      <div
        className="relative flex h-full flex-col items-center justify-center gap-3 p-8 text-center"
        {...zieh}
      >
        <Images className="size-12 text-muted-foreground" aria-hidden />
        <h1 className="text-lg font-semibold">Noch keine Ordner</h1>
        <p className="max-w-sm text-sm text-muted-foreground">
          Füge einen Ordner mit Bildern hinzu – über den Knopf oder indem du ihn hierher ziehst. Die
          Dateien bleiben, wo sie sind; die Galerie liest sie nur.
        </p>
        <Button onClick={() => void ordnerHinzufuegen()} disabled={waehlt}>
          <FolderPlus className="size-4" aria-hidden />
          Ordner hinzufügen
        </Button>
        {ablage}
      </div>
    )
  }

  const ordner = knoten && lib.folders.find((f) => f.id === knoten.ordner)
  const titel = !ordner
    ? 'Alle Bilder'
    : knoten?.pfad
      ? (knoten.pfad.split('/').pop() ?? '')
      : ordner.name
  const pfadText =
    ordner && knoten?.pfad ? `${ordner.name} › ${knoten.pfad.split('/').join(' › ')}` : null
  const liest = lib.folders.some((f) => f.status === 'liest')
  // neu beim Wechsel von Ordner, Sortierung, Gruppen, Filter oder Kacheln/Blocksatz: oben anfangen
  const schluessel = JSON.stringify([
    knoten,
    ansicht.sortierung,
    ansicht.gruppierung,
    blocksatz,
    bildFilter
  ])

  return (
    <div className="relative flex h-full flex-col" {...zieh}>
      <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b px-4 py-2">
        <div className="min-w-0">
          <h1 className="truncate text-sm font-semibold">{titel}</h1>
          {pfadText && <p className="truncate text-xs text-muted-foreground">{pfadText}</p>}
        </div>
        {liest && <span className="text-xs text-muted-foreground">Ordner werden eingelesen …</span>}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Umschalter art={ansicht.art} />
          <Sortierwahl />
          <Gruppenwahl />
          <Suchfeld />
          <FilterKnopf />
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5"
            disabled={!auswahl.size}
            title={
              auswahl.size
                ? 'Metadaten der ausgewählten Bilder bearbeiten (E)'
                : 'Erst Bilder auswählen'
            }
            onClick={metadatenOeffnen}
          >
            <Tag className="size-3.5" aria-hidden />
            Metadaten
          </Button>
          {ansicht.art !== 'liste' && (
            <label className="flex items-center" title="Größe">
              <span className="sr-only">Größe</span>
              <input
                type="range"
                min={GROESSE_MIN}
                max={GROESSE_MAX}
                step={4}
                value={ansicht.groesse}
                onChange={(e) => ansichtAendern({ groesse: Number(e.target.value) })}
                className="w-24 accent-[rgb(var(--akzent-linie))]"
              />
            </label>
          )}
        </div>
      </div>
      <Filterleiste
        facetten={facetten}
        anzahl={k && !k.fehler ? k.ids.length : null}
        gesamt={k?.gesamt}
      />
      {hinweis && (
        <p role="alert" className="border-b bg-warning/10 px-4 py-1.5 text-xs text-warning">
          {hinweis}
        </p>
      )}
      {k?.fehler && <p className="p-4 text-sm text-danger">Bilder nicht verfügbar: {k.fehler}</p>}
      {k && !k.fehler && k.ids.length === 0 && (
        <div className="flex flex-col items-center gap-3 p-8 text-center text-sm text-muted-foreground">
          {filterAktiv(bildFilter) ? (
            <>
              <p>Keine Bilder passen zum Filter.</p>
              <Button variant="outline" size="sm" onClick={filterZuruecksetzen}>
                Zurücksetzen
              </Button>
            </>
          ) : (
            <p>{liest ? 'Die Ordner werden gerade eingelesen …' : 'Hier liegen keine Bilder.'}</p>
          )}
        </div>
      )}
      {k &&
        !k.fehler &&
        k.ids.length > 0 &&
        (ansicht.art !== 'liste' ? (
          // Blocksatz erst mit den Seitenverhältnissen (die Antwort kommt nach dem Umschalten)
          (!blocksatz || k.seiten) && (
            <Raster
              key={schluessel}
              ids={k.ids}
              gruppen={k.gruppen}
              seiten={blocksatz ? k.seiten : undefined}
              details={details}
              groesse={ansicht.groesse}
              onGroesse={(px) => ansichtAendern({ groesse: px })}
              onSichtbar={sichtbarMelden}
              onOeffnen={setBetrachter}
              fokusId={fokusId}
              onMetadaten={tastenFrei ? metadatenOeffnen : undefined}
              onSchnell={tastenFrei ? (t) => void schnell(t) : undefined}
              onRueckgaengig={tastenFrei ? () => void rueckgaengig() : undefined}
            />
          )
        ) : (
          <Liste
            key={schluessel}
            ids={k.ids}
            gruppen={k.gruppen}
            details={details}
            sortierung={ansicht.sortierung}
            onSichtbar={sichtbarMelden}
            onOeffnen={setBetrachter}
            onMetadaten={tastenFrei ? metadatenOeffnen : undefined}
          />
        ))}
      {ablage}
      {mehrfach === null && (
        <Rasterhinweis
          rueck={rueck}
          onRueckgaengig={() => void rueckgaengig()}
          onSchliessen={() => setRueck(null)}
        />
      )}
      {betrachter !== null && k && k.ids.length > 0 && (
        <Betrachter ids={k.ids} start={betrachter} details={details} onSchliessen={schliessen} />
      )}
      {mehrfach !== null && (
        <MetaMehrfach ids={mehrfach} details={details} onSchliessen={() => setMehrfach(null)} />
      )}
    </div>
  )
}
