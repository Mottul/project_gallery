// Betrachter (docs/PLAN.md, „Betrachter“; Entwurf „Betrachter“): Großansicht über bild:// (Kennung,
// nie Pfad) mit dem Vorschaubild als Platzhalter, Anpassen / 100 % / Mausrad-Zoom am Mauszeiger,
// Verschieben, Vor/Zurück (Pfeiltasten), Filmstreifen (virtualisiert), Diashow mit Intervall,
// Vollbild (F11), Info, Papierkorb (Entf – Rückfrage im main). Nachbarbilder werden vorgeladen.
// Bewertung, Drehen und das volle Info-Panel (Ort, Histogramm) kommen mit Phase 2.
import { useVirtualizer } from '@tanstack/react-virtual'
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Info,
  Maximize,
  Minimize,
  Minus,
  Pause,
  Play,
  Plus,
  Trash2
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { api } from '@renderer/lib/api'
import { datumText, groesseText, zahl } from '@renderer/lib/format'
import { cn, errorText } from '@renderer/lib/utils'
import { bildUrl } from '@shared/bild'
import type { ImageInfo } from '@shared/types'
import { Vorschaubild } from './Vorschaubild'

const ZOOM_SCHRITT = 1.25
const ZOOM_MAX = 8
const DIASHOW_INTERVALLE = [2, 3, 5, 10]
const FILM = 72

const QUELLE_TEXT: Record<ImageInfo['takenSource'], string> = {
  exif: 'Kamera (Aufnahmezeit)',
  'exif-digitalisiert': 'Kamera (digitalisiert)',
  xmp: 'XMP',
  'datei-erstellt': 'Datei (erstellt) – nicht aus der Kamera',
  'datei-geaendert': 'Datei (geändert) – nicht aus der Kamera'
}

type Zoom = { art: 'anpassen' } | { art: 'frei'; s: number; x: number; y: number }

function InfoFeld({ bild }: { bild: ImageInfo }): JSX.Element {
  const zeile = (titel: string, wert: string): JSX.Element => (
    <div>
      <dt className="text-xs text-muted-foreground">{titel}</dt>
      <dd className="text-sm">{wert}</dd>
    </div>
  )
  return (
    <aside
      aria-label="Informationen zum Bild"
      className="w-72 shrink-0 overflow-auto border-l bg-leiste p-4"
    >
      <h3 className="mb-3 break-words text-sm font-semibold">{bild.name}</h3>
      <dl className="space-y-3">
        {zeile(
          'Aufnahme',
          datumText(bild.takenAt) + (bild.takenOffset ? ` (UTC${bild.takenOffset})` : '')
        )}
        {zeile('Quelle des Datums', QUELLE_TEXT[bild.takenSource])}
        {zeile('Kamera', [bild.cameraMake, bild.cameraModel].filter(Boolean).join(' ') || '–')}
        {zeile(
          'Datei',
          [
            bild.width && bild.height
              ? `${zahl.format(bild.width)} × ${zahl.format(bild.height)}`
              : null,
            groesseText(bild.size),
            (bild.format ?? bild.ext).toUpperCase()
          ]
            .filter(Boolean)
            .join(' · ')
        )}
      </dl>
    </aside>
  )
}

function Filmstreifen({
  ids,
  index,
  details,
  onWahl
}: {
  ids: number[]
  index: number
  details: {
    get: (id: number) => ImageInfo | undefined
    anfordern: (ids: readonly number[]) => void
  }
  onWahl: (i: number) => void
}): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const virt = useVirtualizer({
    horizontal: true,
    count: ids.length,
    getScrollElement: () => ref.current,
    estimateSize: () => FILM + 6,
    overscan: 6
  })
  useEffect(() => {
    virt.scrollToIndex(index, { align: 'center' })
  }, [virt, index])
  const items = virt.getVirtualItems()
  const von = items[0]?.index ?? 0
  const bis = (items.at(-1)?.index ?? -1) + 1
  useEffect(() => {
    details.anfordern(ids.slice(von, bis))
  }, [ids, von, bis, details])
  return (
    <div
      ref={ref}
      role="listbox"
      aria-label="Filmstreifen"
      className="h-[88px] shrink-0 overflow-x-auto overflow-y-hidden border-t bg-leiste"
    >
      <div className="relative h-full" style={{ width: virt.getTotalSize() }}>
        {items.map((it) => {
          const id = ids[it.index]
          const b = details.get(id)
          const aktuell = it.index === index
          return (
            <button
              key={id}
              type="button"
              role="option"
              aria-selected={aktuell}
              aria-label={b?.name ?? 'Bild'}
              onClick={() => onWahl(it.index)}
              className="absolute top-2 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
              style={{ left: it.start + 3, width: FILM, height: FILM }}
            >
              <Vorschaubild
                key={b?.mtime}
                bild={b}
                groesse={FILM}
                passend="cover"
                className={cn(
                  'rounded-md',
                  aktuell
                    ? 'ring-[3px] ring-primary-line'
                    : 'opacity-70 transition-opacity hover:opacity-100'
                )}
              />
            </button>
          )
        })}
      </div>
    </div>
  )
}

export function Betrachter({
  ids,
  start,
  details,
  onSchliessen
}: {
  ids: number[]
  start: number
  details: {
    get: (id: number) => ImageInfo | undefined
    anfordern: (ids: readonly number[]) => void
  }
  /** mit der zuletzt gezeigten Kennung (die Galerie wählt sie und scrollt dorthin) */
  onSchliessen: (id: number | null) => void
}): JSX.Element {
  const [index, setIndex] = useState(Math.min(start, ids.length - 1))
  const idRef = useRef<number | null>(ids[start] ?? null)
  const [zoom, setZoom] = useState<Zoom>({ art: 'anpassen' })
  const [natur, setNatur] = useState<{ w: number; h: number } | null>(null)
  const [buehne, setBuehne] = useState({ w: 0, h: 0 })
  const [fehler, setFehler] = useState(false)
  const [info, setInfo] = useState(false)
  const [diashow, setDiashow] = useState(false)
  const [intervall, setIntervall] = useState(3)
  const [vollbild, setVollbild] = useState(false)
  const [hinweis, setHinweis] = useState<string | null>(null)
  const wurzel = useRef<HTMLDivElement>(null)
  const buehneRef = useRef<HTMLDivElement>(null)

  const id = ids[index]
  const bild = id === undefined ? undefined : details.get(id)

  // Liste geändert (Papierkorb, Abgleich): beim selben Bild bleiben, sonst an derselben Stelle
  useEffect(() => {
    const i = idRef.current === null ? -1 : ids.indexOf(idRef.current)
    if (i >= 0) setIndex(i)
    else if (ids.length) setIndex((alt) => Math.min(alt, ids.length - 1))
    else onSchliessen(null)
  }, [ids, onSchliessen])
  useEffect(() => {
    idRef.current = id ?? null
    setZoom({ art: 'anpassen' })
    setNatur(null)
    setFehler(false)
  }, [id])

  // Details für das Bild und seine Nachbarn; die Nachbarn vorladen
  useEffect(() => {
    details.anfordern(ids.slice(Math.max(0, index - 2), index + 3))
    for (const n of [ids[index + 1], ids[index - 1]]) {
      const b = n === undefined ? undefined : details.get(n)
      if (b) new Image().src = bildUrl(b.id, b.mtime)
    }
  }, [ids, index, details, bild])

  useEffect(() => {
    const el = buehneRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setBuehne({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const gehe = useCallback(
    (i: number) => setIndex(Math.max(0, Math.min(ids.length - 1, i))),
    [ids.length]
  )

  // Diashow: weiter im Intervall, am Ende von vorn
  useEffect(() => {
    if (!diashow) return
    const t = setInterval(() => setIndex((i) => (i + 1 < ids.length ? i + 1 : 0)), intervall * 1000)
    return () => clearInterval(t)
  }, [diashow, intervall, ids.length])

  useEffect(() => {
    const aendern = (): void => setVollbild(document.fullscreenElement !== null)
    document.addEventListener('fullscreenchange', aendern)
    return () => document.removeEventListener('fullscreenchange', aendern)
  }, [])
  const vollbildUmschalten = useCallback((): void => {
    if (document.fullscreenElement) void document.exitFullscreen()
    else void wurzel.current?.requestFullscreen()
  }, [])

  const passend =
    natur && buehne.w && buehne.h ? Math.min(1, buehne.w / natur.w, buehne.h / natur.h) : 1
  const skala = zoom.art === 'anpassen' ? passend : zoom.s
  const verschoben = zoom.art === 'frei' ? { x: zoom.x, y: zoom.y } : { x: 0, y: 0 }

  /** Zoomen um den Punkt (px, py) relativ zur Bühnenmitte – er bleibt unter dem Mauszeiger. */
  const zoomen = useCallback(
    (faktor: number, px = 0, py = 0) => {
      const s = Math.max(passend / 4, Math.min(ZOOM_MAX, skala * faktor))
      const k = s / skala
      setZoom({ art: 'frei', s, x: px - (px - verschoben.x) * k, y: py - (py - verschoben.y) * k })
    },
    [passend, skala, verschoben.x, verschoben.y]
  )

  // Mausrad-Zoom (nicht passiv – sonst ließe sich das Scrollen nicht abfangen)
  const zoomenRef = useRef(zoomen)
  zoomenRef.current = zoomen
  useEffect(() => {
    const el = buehneRef.current
    if (!el) return
    const rad = (e: WheelEvent): void => {
      e.preventDefault()
      const r = el.getBoundingClientRect()
      zoomenRef.current(
        e.deltaY < 0 ? ZOOM_SCHRITT : 1 / ZOOM_SCHRITT,
        e.clientX - r.left - r.width / 2,
        e.clientY - r.top - r.height / 2
      )
    }
    el.addEventListener('wheel', rad, { passive: false })
    return () => el.removeEventListener('wheel', rad)
  }, [])

  function ziehen(e: ReactMouseEvent): void {
    if (e.button !== 0 || zoom.art !== 'frei') return
    e.preventDefault()
    const start = { x: e.clientX - zoom.x, y: e.clientY - zoom.y, s: zoom.s }
    const bewegen = (ev: MouseEvent): void =>
      setZoom({ art: 'frei', s: start.s, x: ev.clientX - start.x, y: ev.clientY - start.y })
    const ende = (): void => {
      window.removeEventListener('mousemove', bewegen)
      window.removeEventListener('mouseup', ende)
    }
    window.addEventListener('mousemove', bewegen)
    window.addEventListener('mouseup', ende)
  }

  const papierkorb = useCallback(async (): Promise<void> => {
    if (id === undefined) return
    setDiashow(false)
    try {
      const r = await api.library.trash([id])
      if (r.refused) setHinweis(r.refused)
      else if (r.failed)
        setHinweis('Konnte nicht in den Papierkorb verschoben werden – nichts gelöscht.')
      else setHinweis(null)
    } catch (err) {
      setHinweis(errorText(err))
    }
  }, [id])

  // Tasten (nur solange der Betrachter offen ist)
  useEffect(() => {
    const taste = (e: KeyboardEvent): void => {
      if ((e.target as HTMLElement)?.tagName === 'SELECT') return
      const weiter: Record<string, () => void> = {
        ArrowRight: () => gehe(index + 1),
        ArrowLeft: () => gehe(index - 1),
        Home: () => gehe(0),
        End: () => gehe(ids.length - 1),
        '+': () => zoomen(ZOOM_SCHRITT),
        '-': () => zoomen(1 / ZOOM_SCHRITT),
        ' ': () => setDiashow((d) => !d),
        i: () => setInfo((v) => !v),
        F11: vollbildUmschalten,
        Delete: () => void papierkorb(),
        Escape: () => {
          if (!document.fullscreenElement) onSchliessen(idRef.current)
        }
      }
      const f = Object.hasOwn(weiter, e.key) ? weiter[e.key] : undefined
      if (!f) return
      e.preventDefault()
      f()
    }
    window.addEventListener('keydown', taste)
    return () => window.removeEventListener('keydown', taste)
  }, [gehe, index, ids.length, zoomen, vollbildUmschalten, papierkorb, onSchliessen])

  const knopf =
    'inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-xs outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40'

  return (
    <div
      ref={wurzel}
      role="dialog"
      aria-modal="true"
      aria-label="Betrachter"
      className="fixed inset-0 z-40 flex flex-col bg-background"
    >
      <div className="flex h-12 shrink-0 items-center gap-2 border-b bg-leiste px-2">
        <button
          type="button"
          className={knopf}
          onClick={() => onSchliessen(idRef.current)}
          aria-label="Zurück zur Galerie"
        >
          <ArrowLeft className="size-4" aria-hidden />
          Galerie
        </button>
        <div className="min-w-0 flex-1 px-2">
          <h2 className="truncate text-sm font-semibold">{bild?.name ?? ''}</h2>
          <p className="text-xs text-muted-foreground" aria-label="Position">
            {zahl.format(index + 1)} / {zahl.format(ids.length)}
          </p>
        </div>
        <div role="group" aria-label="Zoom" className="flex items-center">
          <button
            type="button"
            className={knopf}
            aria-label="Verkleinern"
            onClick={() => zoomen(1 / ZOOM_SCHRITT)}
          >
            <Minus className="size-4" aria-hidden />
          </button>
          <button
            type="button"
            className={knopf}
            aria-pressed={zoom.art === 'anpassen'}
            onClick={() => setZoom({ art: 'anpassen' })}
          >
            Anpassen
          </button>
          <button
            type="button"
            className={knopf}
            aria-pressed={zoom.art === 'frei' && zoom.s === 1}
            onClick={() => setZoom({ art: 'frei', s: 1, x: 0, y: 0 })}
          >
            100 %
          </button>
          <button
            type="button"
            className={knopf}
            aria-label="Vergrößern"
            onClick={() => zoomen(ZOOM_SCHRITT)}
          >
            <Plus className="size-4" aria-hidden />
          </button>
          <span
            className="w-12 text-right text-xs tabular-nums text-muted-foreground"
            aria-label="Zoomstufe"
          >
            {Math.round(skala * 100)} %
          </span>
        </div>
        <div className="flex items-center gap-1 border-l pl-2">
          <button
            type="button"
            className={knopf}
            aria-pressed={diashow}
            onClick={() => setDiashow((d) => !d)}
          >
            {diashow ? (
              <Pause className="size-4" aria-hidden />
            ) : (
              <Play className="size-4" aria-hidden />
            )}
            Diashow
          </button>
          <select
            aria-label="Intervall der Diashow"
            value={intervall}
            onChange={(e) => setIntervall(Number(e.target.value))}
            className="h-8 rounded-md border border-border bg-background px-1 text-xs"
          >
            {DIASHOW_INTERVALLE.map((s) => (
              <option key={s} value={s}>
                {s} s
              </option>
            ))}
          </select>
          <button
            type="button"
            className={knopf}
            aria-label={vollbild ? 'Vollbild beenden' : 'Vollbild'}
            onClick={vollbildUmschalten}
          >
            {vollbild ? (
              <Minimize className="size-4" aria-hidden />
            ) : (
              <Maximize className="size-4" aria-hidden />
            )}
          </button>
          <button
            type="button"
            className={knopf}
            aria-pressed={info}
            onClick={() => setInfo((v) => !v)}
          >
            <Info className="size-4" aria-hidden />
            Info
          </button>
          <button
            type="button"
            className={cn(knopf, 'text-danger')}
            onClick={() => void papierkorb()}
            disabled={id === undefined}
          >
            <Trash2 className="size-4" aria-hidden />
            Papierkorb
          </button>
        </div>
      </div>

      {hinweis && (
        <p role="alert" className="border-b bg-warning/10 px-4 py-1.5 text-xs text-warning">
          {hinweis}
        </p>
      )}

      <div className="flex min-h-0 flex-1">
        <div
          ref={buehneRef}
          className={cn(
            'relative min-w-0 flex-1 overflow-hidden bg-buehne',
            zoom.art === 'frei' && 'cursor-grab active:cursor-grabbing'
          )}
          onMouseDown={ziehen}
          onDoubleClick={() =>
            setZoom(
              zoom.art === 'anpassen' ? { art: 'frei', s: 1, x: 0, y: 0 } : { art: 'anpassen' }
            )
          }
        >
          {bild && (
            <>
              {/* Platzhalter: das Vorschaubild, bis das Original da ist */}
              {!natur && (
                <Vorschaubild
                  key={`v${bild.id}:${bild.mtime}`}
                  bild={bild}
                  stufe={768}
                  className="absolute inset-0 size-full bg-transparent"
                />
              )}
              {!fehler && (
                <img
                  key={`${bild.id}:${bild.mtime}`}
                  src={bildUrl(bild.id, bild.mtime)}
                  alt={bild.name}
                  draggable={false}
                  onLoad={(e) =>
                    setNatur({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })
                  }
                  onError={() => setFehler(true)}
                  className={cn(
                    'absolute left-1/2 top-1/2 max-w-none select-none',
                    !natur && 'invisible'
                  )}
                  style={{
                    width: natur?.w,
                    height: natur?.h,
                    transform: `translate(-50%, -50%) translate(${verschoben.x}px, ${verschoben.y}px) scale(${skala})`
                  }}
                />
              )}
              {fehler && (
                <p className="absolute inset-x-0 bottom-6 mx-auto w-fit rounded-md bg-background/90 px-3 py-2 text-sm">
                  Dieses Bild lässt sich gerade nicht anzeigen – geändert, verschoben oder defekt.
                </p>
              )}
            </>
          )}
          <button
            type="button"
            aria-label="Vorheriges Bild"
            disabled={index <= 0}
            onClick={() => gehe(index - 1)}
            className="absolute left-2 top-1/2 flex size-10 -translate-y-1/2 items-center justify-center rounded-full bg-background/70 outline-none hover:bg-background focus-visible:ring-2 focus-visible:ring-ring disabled:invisible"
          >
            <ChevronLeft className="size-5" aria-hidden />
          </button>
          <button
            type="button"
            aria-label="Nächstes Bild"
            disabled={index >= ids.length - 1}
            onClick={() => gehe(index + 1)}
            className="absolute right-2 top-1/2 flex size-10 -translate-y-1/2 items-center justify-center rounded-full bg-background/70 outline-none hover:bg-background focus-visible:ring-2 focus-visible:ring-ring disabled:invisible"
          >
            <ChevronRight className="size-5" aria-hidden />
          </button>
        </div>
        {info && bild && <InfoFeld bild={bild} />}
      </div>

      <Filmstreifen ids={ids} index={index} details={details} onWahl={gehe} />
    </div>
  )
}
