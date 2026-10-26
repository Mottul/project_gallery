// Raster der Galerie: virtualisiert (@tanstack/react-virtual – nur sichtbare Zeilen im DOM, flüssig
// auch bei 100.000 Bildern), quadratische Kacheln mit Größenregler und Strg + Mausrad, Auswahl wie
// im Explorer (Klick, Strg, Umschalt, Strg+A, Esc, Rahmen ziehen). Details und Vorschau-Vorrang
// nur für den sichtbaren Bereich plus die nächste Seite (Skill bibliothek-index).
import { useVirtualizer } from '@tanstack/react-virtual'
import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import {
  auswahlAlle,
  auswahlKlick,
  auswahlLeeren,
  auswahlRahmen,
  ersteGewaehlte,
  useAuswahl
} from '@renderer/lib/auswahl'
import { tagText } from '@renderer/lib/format'
import { cn } from '@renderer/lib/utils'
import type { ImageInfo } from '@shared/types'
import { stufeFuer, Vorschaubild } from './Vorschaubild'

/** Abstand zwischen Kacheln und Rand des Rasters (px) */
const ABSTAND = 8
const RAND = 16
/** Höhe der beiden Textzeilen unter dem Bild (Name, Datum) */
const TEXT = 38
/** Strg + Mausrad: so viele px je Raste */
const RAD_SCHRITT = 16

interface Rahmen {
  x0: number
  y0: number
  x1: number
  y1: number
}

export function Raster({
  ids,
  details,
  groesse,
  onGroesse,
  onSichtbar,
  onOeffnen,
  fokusId
}: {
  ids: number[]
  details: {
    get: (id: number) => ImageInfo | undefined
    anfordern: (ids: readonly number[]) => void
  }
  groesse: number
  onGroesse: (px: number) => void
  onSichtbar: (ids: readonly number[]) => void
  /** Doppelklick oder Eingabetaste: Bild an dieser Stelle im Betrachter öffnen */
  onOeffnen: (index: number) => void
  /** dorthin scrollen (nach dem Betrachter: das zuletzt gezeigte Bild) */
  fokusId: number | null
}): JSX.Element {
  const auswahl = useAuswahl()
  const scrollRef = useRef<HTMLDivElement>(null)
  const [breite, setBreite] = useState(0)
  const [rahmen, setRahmen] = useState<Rahmen | null>(null)

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setBreite(el.clientWidth))
    ro.observe(el)
    setBreite(el.clientWidth)
    return () => ro.disconnect()
  }, [])

  const spalten = Math.max(1, Math.floor((breite - 2 * RAND + ABSTAND) / (groesse + ABSTAND)))
  // der Regler gibt die Mindestgröße vor; die Kacheln füllen die Breite (kein leerer Streifen)
  const kante =
    breite > 0
      ? Math.max(groesse, Math.floor((breite - 2 * RAND - (spalten - 1) * ABSTAND) / spalten))
      : groesse
  const zeilen = Math.ceil(ids.length / spalten)
  const zeilenHoehe = kante + TEXT + ABSTAND
  const virt = useVirtualizer({
    count: zeilen,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => zeilenHoehe,
    overscan: 3,
    paddingStart: RAND,
    paddingEnd: RAND
  })
  useEffect(() => {
    virt.measure()
  }, [virt, zeilenHoehe, spalten])

  useEffect(() => {
    const i = fokusId === null ? -1 : ids.indexOf(fokusId)
    if (i >= 0) virt.scrollToIndex(Math.floor(i / spalten), { align: 'auto' })
    // nur wenn sich der Fokus ändert, nicht bei jeder neuen Liste
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fokusId, spalten > 0])

  const items = virt.getVirtualItems()
  const von = (items[0]?.index ?? 0) * spalten
  const bis = Math.min(ids.length, ((items.at(-1)?.index ?? -1) + 1) * spalten)
  useEffect(() => {
    const sichtbar = ids.slice(von, bis)
    details.anfordern(sichtbar)
    // dahinter die nächste Seite: beim Weiterscrollen sind ihre Vorschaubilder schon da
    onSichtbar([...sichtbar, ...ids.slice(bis, bis + (bis - von))])
  }, [ids, von, bis, details, onSichtbar])

  // Strg + Mausrad: Kachelgröße (nicht passiv – sonst ließe sich das Zoomen nicht abfangen)
  const groesseRef = useRef(groesse)
  groesseRef.current = groesse
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const rad = (e: WheelEvent): void => {
      if (!e.ctrlKey) return
      e.preventDefault()
      onGroesse(groesseRef.current - Math.sign(e.deltaY) * RAD_SCHRITT)
    }
    el.addEventListener('wheel', rad, { passive: false })
    return () => el.removeEventListener('wheel', rad)
  }, [onGroesse])

  /** Kennungen, deren Kachel den Rahmen schneidet (aus der Rastergeometrie, ohne DOM). */
  function imRahmen(r: Rahmen): number[] {
    const [xa, xb] = r.x0 < r.x1 ? [r.x0, r.x1] : [r.x1, r.x0]
    const [ya, yb] = r.y0 < r.y1 ? [r.y0, r.y1] : [r.y1, r.y0]
    const out: number[] = []
    const z0 = Math.max(0, Math.floor((ya - RAND) / zeilenHoehe))
    const z1 = Math.min(zeilen - 1, Math.floor((yb - RAND) / zeilenHoehe))
    for (let z = z0; z <= z1; z++) {
      const oben = RAND + z * zeilenHoehe
      if (oben > yb || oben + kante + TEXT < ya) continue
      for (let s = 0; s < spalten; s++) {
        const links = RAND + s * (kante + ABSTAND)
        if (links > xb || links + kante < xa) continue
        const i = z * spalten + s
        if (i < ids.length) out.push(ids[i])
      }
    }
    return out
  }

  function rahmenStart(e: ReactMouseEvent<HTMLDivElement>): void {
    const el = scrollRef.current
    // nur auf freier Fläche – auf einer Kachel ist es ein Klick
    if (!el || e.button !== 0 || (e.target as HTMLElement).closest('[role="option"]')) return
    e.preventDefault()
    el.focus()
    const vorher = e.ctrlKey || e.metaKey ? new Set(auswahl) : null
    if (!vorher) auswahlLeeren()
    const punkt = (ev: MouseEvent): { x: number; y: number } => {
      const r = el.getBoundingClientRect()
      return { x: ev.clientX - r.left + el.scrollLeft, y: ev.clientY - r.top + el.scrollTop }
    }
    const start = punkt(e.nativeEvent)
    let aktuell: Rahmen = { x0: start.x, y0: start.y, x1: start.x, y1: start.y }
    const bewegen = (ev: MouseEvent): void => {
      // am Rand weiterscrollen, damit der Rahmen über den sichtbaren Bereich hinaus reicht
      const r = el.getBoundingClientRect()
      if (ev.clientY > r.bottom - 24) el.scrollTop += 24
      else if (ev.clientY < r.top + 24) el.scrollTop -= 24
      const p = punkt(ev)
      aktuell = { ...aktuell, x1: p.x, y1: p.y }
      setRahmen(aktuell)
      auswahlRahmen(imRahmen(aktuell), vorher)
    }
    const ende = (): void => {
      setRahmen(null)
      window.removeEventListener('mousemove', bewegen)
      window.removeEventListener('mouseup', ende)
    }
    window.addEventListener('mousemove', bewegen)
    window.addEventListener('mouseup', ende)
  }

  return (
    <div
      ref={scrollRef}
      role="listbox"
      aria-label="Bilder"
      aria-multiselectable="true"
      tabIndex={0}
      className="relative min-h-0 flex-1 select-none overflow-auto outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      onMouseDown={rahmenStart}
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
      <div className="relative w-full" style={{ height: virt.getTotalSize() }}>
        {items.map((zeile) => (
          <div
            key={zeile.key}
            role="presentation"
            className="absolute inset-x-0"
            style={{ top: zeile.start, height: zeilenHoehe }}
          >
            {Array.from({ length: spalten }, (_, s) => {
              const index = zeile.index * spalten + s
              const id = ids[index]
              if (id === undefined) return null
              const bild = details.get(id)
              const gewaehlt = auswahl.has(id)
              return (
                <div
                  key={id}
                  role="option"
                  aria-selected={gewaehlt}
                  aria-label={bild?.name ?? 'Bild'}
                  data-id={id}
                  className="absolute cursor-default"
                  style={{ left: RAND + s * (kante + ABSTAND), width: kante }}
                  onClick={(e) =>
                    auswahlKlick(ids, index, {
                      strg: e.ctrlKey || e.metaKey,
                      umschalt: e.shiftKey
                    })
                  }
                  onDoubleClick={() => onOeffnen(index)}
                >
                  <Vorschaubild
                    key={bild?.mtime}
                    bild={bild}
                    stufe={stufeFuer(kante)}
                    passend="cover"
                    className={cn(
                      'rounded-md',
                      gewaehlt &&
                        'ring-[3px] ring-primary-line ring-offset-2 ring-offset-background'
                    )}
                    groesse={kante}
                  />
                  <p className="mt-1 truncate text-xs" title={bild?.name}>
                    {bild?.name ?? ' '}
                  </p>
                  <p className="truncate text-[11px] text-muted-foreground">
                    {bild ? tagText(bild.takenAt) : ' '}
                  </p>
                </div>
              )
            })}
          </div>
        ))}
        {rahmen && (
          <div
            aria-hidden
            className="pointer-events-none absolute border border-primary-line bg-primary-line/10"
            style={{
              left: Math.min(rahmen.x0, rahmen.x1),
              top: Math.min(rahmen.y0, rahmen.y1),
              width: Math.abs(rahmen.x1 - rahmen.x0),
              height: Math.abs(rahmen.y1 - rahmen.y0)
            }}
          />
        )}
      </div>
    </div>
  )
}
