// Info-Panel des Betrachters (2.1; Entwurf „Betrachter“): Titel, Beschreibung, Bewertung,
// Farblabel, Stichwörter, Aufnahme mit Quelle des Datums, Kamera und Objektiv, Belichtung,
// Standort (Koordinaten – der Ortsname kommt mit 2.2), Datei. „Alle Felder“ liest erst beim
// Aufklappen frisch aus der Datei (über den Bilddienst, nicht aus dem Index). Texte aus den
// Metadaten nur als Text (React escaped), nie als HTML.
import { ChevronDown, ChevronRight, Star } from 'lucide-react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { api } from '@renderer/lib/api'
import {
  belichtungText,
  blendeText,
  brennweiteText,
  datumText,
  dezimalText,
  gpsText,
  groesseText,
  zahl
} from '@renderer/lib/format'
import { cn } from '@renderer/lib/utils'
import type { ImageInfo, MetaFeld } from '@shared/types'

const QUELLE_TEXT: Record<ImageInfo['takenSource'], string> = {
  exif: 'Kamera (Aufnahmezeit)',
  'exif-digitalisiert': 'Kamera (digitalisiert)',
  xmp: 'XMP',
  'datei-erstellt': 'Datei (erstellt) – nicht aus der Kamera',
  'datei-geaendert': 'Datei (geändert) – nicht aus der Kamera'
}

/** Farblabel, wie Lightroom & Co. sie schreiben (englisch) – auf Deutsch; Unbekanntes bleibt */
const FARBLABEL: Record<string, string> = {
  red: 'Rot',
  yellow: 'Gelb',
  green: 'Grün',
  blue: 'Blau',
  purple: 'Lila'
}
const farblabelText = (l: string): string =>
  Object.hasOwn(FARBLABEL, l.toLowerCase()) ? FARBLABEL[l.toLowerCase()] : l

function Zeile({ titel, children }: { titel: string; children: ReactNode }): JSX.Element {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{titel}</dt>
      <dd className="break-words text-sm">{children}</dd>
    </div>
  )
}

function Bewertung({ n }: { n: number }): JSX.Element {
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={`${n} von 5 Sternen`}>
      {Array.from({ length: 5 }, (_, i) => (
        <Star
          key={i}
          className={cn('size-3.5', i < n ? 'fill-warning text-warning' : 'text-muted-foreground')}
          aria-hidden
        />
      ))}
    </span>
  )
}

/** „Alle Felder“: beim Aufklappen frisch gelesen, nach Gruppe, mit Suchfeld. */
function AlleFelder({ bild }: { bild: ImageInfo }): JSX.Element {
  const [offen, setOffen] = useState(false)
  const [felder, setFelder] = useState<MetaFeld[] | null | 'laedt'>(null)
  const [suche, setSuche] = useState('')
  // anderes Bild oder geänderte Datei: neu lesen, sobald aufgeklappt
  useEffect(() => {
    setFelder(null)
  }, [bild.id, bild.mtime])
  useEffect(() => {
    if (!offen || felder !== null) return
    let aktuell = true
    setFelder('laedt')
    api.library.allFields(bild.id).then(
      (f) => aktuell && setFelder(f ?? []),
      () => aktuell && setFelder([])
    )
    return () => {
      aktuell = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offen, bild.id, bild.mtime])
  const gruppen = useMemo(() => {
    if (!Array.isArray(felder)) return []
    const s = suche.trim().toLowerCase()
    const je = new Map<string, MetaFeld[]>()
    for (const f of felder) {
      if (s && !`${f.gruppe} ${f.name} ${f.wert}`.toLowerCase().includes(s)) continue
      je.set(f.gruppe, [...(je.get(f.gruppe) ?? []), f])
    }
    return [...je]
  }, [felder, suche])

  return (
    <section className="border-t pt-3">
      <button
        type="button"
        aria-expanded={offen}
        onClick={() => setOffen((o) => !o)}
        className="flex w-full items-center gap-1 rounded-sm text-left text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {offen ? (
          <ChevronDown className="size-3.5" aria-hidden />
        ) : (
          <ChevronRight className="size-3.5" aria-hidden />
        )}
        Alle Felder
      </button>
      {offen && (
        <div className="mt-2 space-y-2">
          {felder === 'laedt' && <p className="text-xs text-muted-foreground">Liest …</p>}
          {Array.isArray(felder) && felder.length === 0 && (
            <p className="text-xs text-muted-foreground">
              Die Datei lässt sich gerade nicht lesen – geändert, verschoben oder defekt.
            </p>
          )}
          {Array.isArray(felder) && felder.length > 0 && (
            <>
              <input
                type="search"
                value={suche}
                onChange={(e) => setSuche(e.target.value)}
                placeholder="Feld suchen"
                aria-label="Feld suchen"
                className="h-7 w-full rounded-md border border-border bg-background px-2 text-xs"
              />
              <p className="text-xs text-muted-foreground" aria-label="Anzahl der Felder">
                {zahl.format(felder.length)} Felder
              </p>
              {gruppen.map(([gruppe, liste]) => (
                <div key={gruppe}>
                  <h4 className="text-xs font-semibold text-muted-foreground">{gruppe}</h4>
                  <dl className="mt-0.5 grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-x-2 text-xs">
                    {liste.map((f, i) => (
                      <div key={`${f.name}-${i}`} className="contents">
                        <dt className="truncate text-muted-foreground" title={f.name}>
                          {f.name}
                        </dt>
                        <dd className="break-words">{f.wert}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </section>
  )
}

export function InfoPanel({ bild }: { bild: ImageInfo }): JSX.Element {
  const belichtung = [
    bild.aperture !== null ? blendeText(bild.aperture) : null,
    bild.exposure !== null ? belichtungText(bild.exposure) : null,
    bild.iso !== null ? `ISO ${zahl.format(bild.iso)}` : null,
    bild.focal !== null ? brennweiteText(bild.focal) : null
  ].filter(Boolean)
  return (
    <aside
      aria-label="Informationen zum Bild"
      className="w-80 shrink-0 overflow-auto border-l bg-leiste p-4"
    >
      <h3 className="mb-1 break-words text-sm font-semibold">{bild.title ?? bild.name}</h3>
      {bild.title && <p className="mb-2 break-words text-xs text-muted-foreground">{bild.name}</p>}
      {bild.description && <p className="mb-3 whitespace-pre-line text-sm">{bild.description}</p>}
      {!bild.metaRead && (
        <p className="mb-3 text-xs text-muted-foreground">Metadaten werden gelesen …</p>
      )}
      <dl className="space-y-3">
        {(bild.rating !== null || bild.colorLabel) && (
          <Zeile titel="Bewertung">
            <span className="flex items-center gap-2">
              {bild.rating !== null && <Bewertung n={bild.rating} />}
              {bild.colorLabel && (
                <span className="rounded-sm bg-muted px-1.5 text-xs">
                  {farblabelText(bild.colorLabel)}
                </span>
              )}
            </span>
          </Zeile>
        )}
        {bild.keywords.length > 0 && (
          <Zeile titel="Stichwörter">
            <ul className="mt-0.5 flex flex-wrap gap-1" aria-label="Stichwörter">
              {bild.keywords.map((k) => (
                <li key={k} className="rounded-sm bg-muted px-1.5 py-0.5 text-xs">
                  {k}
                </li>
              ))}
            </ul>
          </Zeile>
        )}
        <Zeile titel="Aufnahme">
          {datumText(bild.takenAt) + (bild.takenOffset ? ` (UTC${bild.takenOffset})` : '')}
        </Zeile>
        <Zeile titel="Quelle des Datums">{QUELLE_TEXT[bild.takenSource]}</Zeile>
        <Zeile titel="Kamera">
          {[bild.cameraMake, bild.cameraModel].filter(Boolean).join(' ') || '–'}
        </Zeile>
        {bild.lens && <Zeile titel="Objektiv">{bild.lens}</Zeile>}
        {belichtung.length > 0 && <Zeile titel="Belichtung">{belichtung.join(' · ')}</Zeile>}
        {bild.gps && (
          <Zeile titel="Standort">
            {gpsText(bild.gps.lat, bild.gps.lon)}
            {bild.gps.alt !== null && (
              <span className="text-muted-foreground"> · {dezimalText(bild.gps.alt)} m</span>
            )}
          </Zeile>
        )}
        <Zeile titel="Datei">
          {[
            bild.width && bild.height
              ? `${zahl.format(bild.width)} × ${zahl.format(bild.height)}`
              : null,
            groesseText(bild.size),
            (bild.format ?? bild.ext).toUpperCase()
          ]
            .filter(Boolean)
            .join(' · ')}
        </Zeile>
      </dl>
      <div className="mt-4">
        <AlleFelder bild={bild} />
      </div>
    </aside>
  )
}
