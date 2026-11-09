// Hinweis unten im Raster (Phase 3.3; Schnellbewertung, entschieden 9.11.2026): ein Bild – „3 Sterne
// gespeichert · Rückgängig“ wie im Betrachter; mehrere – erst der Fortschritt des Auftrags mit
// „Abbrechen“, dann das Ergebnis mit „Rückgängig“ für alle auf einmal. Der Fortschritt ohne
// role="status" (die Zahl ändert sich laufend, ein Screenreader läse jede vor), das Ende mit.
import { Loader2, X } from 'lucide-react'
import { useEffect } from 'react'
import { zahl } from '@renderer/lib/format'
import { auftragAnhalten, auftragVergessen, useAuftrag } from '@renderer/lib/metaAuftrag'

/** So lange bleibt ein Hinweis ohne Probleme stehen */
const STEHEN_MS = 8000

export interface Rueckmeldung {
  text: string
  journal: number[]
}

const KASTEN =
  'absolute bottom-4 left-1/2 z-30 flex max-w-[90%] -translate-x-1/2 items-center gap-3 rounded-md border bg-card px-3 py-1.5 text-sm shadow-lg'
const LINK =
  'shrink-0 rounded-sm font-medium text-primary-line underline outline-none focus-visible:ring-2 focus-visible:ring-ring'

export function Rasterhinweis({
  rueck,
  onRueckgaengig,
  onSchliessen
}: {
  rueck: Rueckmeldung | null
  onRueckgaengig: () => void
  onSchliessen: () => void
}): JSX.Element | null {
  const a = useAuftrag()
  const meiner = a?.quelle === 'raster' ? a : null
  const ende = meiner?.ende ?? null
  const probleme = ende
    ? ende.dateien.filter((d) => d.status !== 'geschrieben' && d.status !== 'unveraendert')
    : []
  const glatt = ende !== null && !ende.abgebrochen && probleme.length === 0

  useEffect(() => {
    if (!rueck) return
    const t = setTimeout(onSchliessen, STEHEN_MS)
    return () => clearTimeout(t)
  }, [rueck, onSchliessen])
  // ging alles, verschwindet das Ergebnis von selbst; sonst bleibt es, bis es geschlossen wird
  useEffect(() => {
    if (!glatt) return
    const t = setTimeout(auftragVergessen, STEHEN_MS)
    return () => clearTimeout(t)
  }, [glatt, ende])

  // während der Rückfrage im main (noch ohne Kennung) noch nichts zeigen
  if (meiner && !ende && meiner.auftrag === null) return null
  if (meiner && !ende) {
    return (
      <div className={KASTEN}>
        <Loader2 className="size-4 shrink-0 animate-spin" aria-hidden />
        <span className="truncate">
          {meiner.art === 'rueckgaengig' ? 'Nimmt zurück' : `Schreibt „${meiner.text}“`} …{' '}
          {zahl.format(meiner.fertig)} von {zahl.format(meiner.gesamt)}
        </span>
        <button type="button" className={LINK} onClick={() => auftragAnhalten()}>
          Abbrechen
        </button>
      </div>
    )
  }

  if (meiner && ende) {
    const geschrieben = ende.dateien.filter((d) => d.status === 'geschrieben').length
    const schon = ende.dateien.filter((d) => d.status === 'unveraendert').length
    const rueckgaengig = meiner.art === 'rueckgaengig'
    const teile = [
      rueckgaengig
        ? `Rückgängig gemacht: ${zahl.format(geschrieben)} ${geschrieben === 1 ? 'Datei' : 'Dateien'}`
        : `${meiner.text}: ${zahl.format(geschrieben)} ${geschrieben === 1 ? 'Datei' : 'Dateien'} geschrieben`,
      ...(schon ? [`${zahl.format(schon)} hatten es schon`] : []),
      ...(probleme.length === 1
        ? [`${probleme[0].name ?? 'eine Datei'}: ${probleme[0].grund ?? 'nicht geschrieben'}`]
        : probleme.length
          ? [
              `${zahl.format(probleme.length)} nicht ${rueckgaengig ? 'zurückgenommen' : 'geschrieben'}`
            ]
          : []),
      ...(ende.abgebrochen ? ['abgebrochen – der Rest ist unverändert'] : [])
    ]
    return (
      <div role="status" className={KASTEN}>
        <span
          className="truncate"
          title={probleme.map((d) => `${d.name ?? d.id}: ${d.grund ?? ''}`).join('\n') || undefined}
        >
          {teile.join(' · ')}
        </span>
        {!rueckgaengig && ende.journal.length > 0 && (
          <button type="button" className={LINK} onClick={onRueckgaengig}>
            Rückgängig
          </button>
        )}
        <button
          type="button"
          aria-label="Hinweis schließen"
          className="shrink-0 rounded-sm outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          onClick={auftragVergessen}
        >
          <X className="size-4" aria-hidden />
        </button>
      </div>
    )
  }

  if (!rueck) return null
  return (
    <div role="status" className={KASTEN}>
      <span>{rueck.text}</span>
      <button type="button" className={LINK} onClick={onRueckgaengig}>
        Rückgängig
      </button>
    </div>
  )
}
