// Zoom-Bedienung des Betrachters (Rückmeldung zu 1.5): Anpassen, 100 %, Verkleinern, Schieberegler
// (logarithmisch, lib/zoom.ts), Vergrößern und die Prozentzahl als Menü mit festen Stufen. Das Menü
// liegt im Betrachter selbst, nicht in einem Portal – im Vollbild ist nur der Betrachter zu sehen.
import { ChevronDown, Minus, Plus } from 'lucide-react'
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { cn } from '@renderer/lib/utils'
import { REGLER, ZOOM_SCHRITT, ZOOM_STUFEN, ausRegler, reglerWert } from '@renderer/lib/zoom'

const EINTRAG =
  'flex w-full items-center rounded-sm px-2 py-1.5 text-left text-sm tabular-nums outline-none hover:bg-muted focus-visible:bg-muted'

export function Zoomleiste({
  skala,
  passend,
  angepasst,
  knopf,
  onZoom,
  onFaktor,
  onAnpassen
}: {
  skala: number
  passend: number
  /** Stufe „Anpassen“ gewählt */
  angepasst: boolean
  /** Klassen der Knöpfe in der Leiste */
  knopf: string
  /** auf eine Stufe zoomen (um die Bühnenmitte) */
  onZoom: (s: number) => void
  /** um einen Faktor zoomen (um die Bühnenmitte) */
  onFaktor: (f: number) => void
  onAnpassen: () => void
}): JSX.Element {
  const [offen, setOffen] = useState(false)
  const menue = useRef<HTMLDivElement>(null)
  const stufeKnopf = useRef<HTMLButtonElement>(null)
  const prozent = Math.round(skala * 100)

  useEffect(() => {
    if (!offen) return
    menue.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus()
    const daneben = (e: PointerEvent): void => {
      const ziel = e.target as Node
      if (!menue.current?.contains(ziel) && !stufeKnopf.current?.contains(ziel)) setOffen(false)
    }
    document.addEventListener('pointerdown', daneben)
    return () => document.removeEventListener('pointerdown', daneben)
  }, [offen])

  const schliessen = (): void => {
    setOffen(false)
    stufeKnopf.current?.focus()
  }
  // Tasten im Menü erreichen den Betrachter nicht (sonst schlösse Esc ihn, Pfeile blätterten)
  const tasten = (e: KeyboardEvent): void => {
    e.stopPropagation()
    const eintraege = [...(menue.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])]
    const i = eintraege.indexOf(document.activeElement as HTMLElement)
    if (e.key === 'Escape') {
      e.preventDefault()
      schliessen()
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const n = e.key === 'ArrowDown' ? 1 : -1
      eintraege[(i + n + eintraege.length) % eintraege.length]?.focus()
    }
  }
  const waehlen = (f: () => void): void => {
    f()
    schliessen()
  }

  return (
    <div role="group" aria-label="Zoom" className="flex items-center">
      <button type="button" className={knopf} aria-pressed={angepasst} onClick={onAnpassen}>
        Anpassen
      </button>
      <button
        type="button"
        className={knopf}
        aria-pressed={!angepasst && skala === 1}
        onClick={() => onZoom(1)}
      >
        100 %
      </button>
      <button
        type="button"
        className={cn(knopf, 'ml-2')}
        aria-label="Verkleinern"
        onClick={() => onFaktor(1 / ZOOM_SCHRITT)}
      >
        <Minus className="size-4" aria-hidden />
      </button>
      <input
        type="range"
        aria-label="Zoom"
        aria-valuetext={`${prozent} %`}
        min={0}
        max={REGLER}
        step={1}
        value={reglerWert(skala, passend)}
        onChange={(e) => onZoom(ausRegler(Number(e.target.value), passend))}
        // mit der Maus bedient: Fokus zurück, damit die Pfeiltasten wieder blättern
        onPointerUp={(e) => e.currentTarget.blur()}
        className="h-8 w-28 cursor-pointer accent-primary-line"
      />
      <button
        type="button"
        className={knopf}
        aria-label="Vergrößern"
        onClick={() => onFaktor(ZOOM_SCHRITT)}
      >
        <Plus className="size-4" aria-hidden />
      </button>
      <div className="relative">
        <button
          ref={stufeKnopf}
          type="button"
          aria-label={`Zoomstufe ${prozent} %`}
          aria-haspopup="menu"
          aria-expanded={offen}
          onClick={() => setOffen((o) => !o)}
          className={cn(knopf, 'w-[4.5rem] justify-end tabular-nums text-muted-foreground')}
        >
          {prozent} %
          <ChevronDown className="size-3" aria-hidden />
        </button>
        {offen && (
          <div
            ref={menue}
            role="menu"
            aria-label="Zoomstufe"
            onKeyDown={tasten}
            className="absolute right-0 top-full z-50 mt-1 w-32 rounded-md border bg-card p-1 shadow-lg"
          >
            <button
              type="button"
              role="menuitem"
              className={EINTRAG}
              onClick={() => waehlen(onAnpassen)}
            >
              Anpassen
            </button>
            {ZOOM_STUFEN.map((s) => (
              <button
                key={s}
                type="button"
                role="menuitem"
                className={EINTRAG}
                onClick={() => waehlen(() => onZoom(s))}
              >
                {s * 100} %
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
