// Hauptfläche der Galerie (docs/PLAN.md, „Galerie-Ansichten“; Entwurf „Galerie – Kacheln/Liste“):
// ohne Ordner der Einstieg; sonst eine Kopfzeile (gewählter Knoten, Kacheln/Liste, Sortieren,
// Gruppen, Größe) über Raster oder Liste. Ordner lassen sich aus dem Explorer hineinziehen – die Seite gibt
// dabei nur die Datei-Objekte weiter, den Pfad liest der Preload (Schicht C).
import { BrickWall, FolderInput, FolderPlus, Images, LayoutGrid, List } from 'lucide-react'
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
import { auswahlAbgleichen, auswahlNur } from '@renderer/lib/auswahl'
import {
  angezeigtMelden,
  useDetails,
  useKennungen,
  useSichtbarMelden
} from '@renderer/lib/bildliste'
import {
  ordnerGezogen,
  ordnerHinzufuegen,
  useHinzufuegenStatus,
  useLibrary
} from '@renderer/lib/library'
import { cn } from '@renderer/lib/utils'
import { Betrachter } from './Betrachter'
import { Liste } from './Liste'
import { Raster } from './Raster'
import { Gruppenwahl, Sortierwahl } from './Sortierwahl'

const istDateien = (e: DragEvent): boolean => Array.from(e.dataTransfer.types).includes('Files')

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
  const k = useKennungen(lib, knoten, ansicht.sortierung, ansicht.gruppierung, blocksatz)
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

  useEffect(() => {
    if (k) auswahlAbgleichen(k.ids)
    angezeigtMelden(k && !k.fehler ? k.ids.length : null)
  }, [k])

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
  // neu beim Wechsel von Ordner, Sortierung, Gruppen oder Kacheln/Blocksatz: oben anfangen
  const schluessel = JSON.stringify([knoten, ansicht.sortierung, ansicht.gruppierung, blocksatz])

  return (
    <div className="relative flex h-full flex-col" {...zieh}>
      <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b px-4 py-2">
        <div className="min-w-0">
          <h1 className="truncate text-sm font-semibold">{titel}</h1>
          {pfadText && <p className="truncate text-xs text-muted-foreground">{pfadText}</p>}
        </div>
        {liest && <span className="text-xs text-muted-foreground">Ordner werden eingelesen …</span>}
        <div className="ml-auto flex flex-wrap items-center gap-3">
          <Umschalter art={ansicht.art} />
          <Sortierwahl />
          <Gruppenwahl />
          {ansicht.art !== 'liste' && (
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              Größe
              <input
                type="range"
                min={GROESSE_MIN}
                max={GROESSE_MAX}
                step={4}
                value={ansicht.groesse}
                onChange={(e) => ansichtAendern({ groesse: Number(e.target.value) })}
                className="w-32 accent-[rgb(var(--akzent-linie))]"
              />
            </label>
          )}
        </div>
      </div>
      {k?.fehler && <p className="p-4 text-sm text-danger">Bilder nicht verfügbar: {k.fehler}</p>}
      {k && !k.fehler && k.ids.length === 0 && (
        <p className="p-8 text-center text-sm text-muted-foreground">
          {liest ? 'Die Ordner werden gerade eingelesen …' : 'Hier liegen keine Bilder.'}
        </p>
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
          />
        ))}
      {ablage}
      {betrachter !== null && k && k.ids.length > 0 && (
        <Betrachter ids={k.ids} start={betrachter} details={details} onSchliessen={schliessen} />
      )}
    </div>
  )
}
