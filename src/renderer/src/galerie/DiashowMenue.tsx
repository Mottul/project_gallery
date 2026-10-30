// Einstellungen der Diashow (Phase 2.5): kleines Menü am Knopf „Diashow“ – Übergang, Ken Burns und
// Stärke. Der Rest der Werkzeugleiste bleibt, wie er ist (entschieden 30.10.2026).
import { Settings2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import {
  diashowAendern,
  useDiashowWahl,
  useWenigBewegung,
  type KenBurnsWahl,
  type Uebergang
} from '@renderer/lib/diashow'
import type { KenBurnsStaerke } from '@shared/kenBurns'

const AUSWAHL = 'h-8 rounded-md border border-border bg-background px-1 text-xs'

const UEBERGAENGE: readonly (readonly [Uebergang, string])[] = [
  ['ueberblenden', 'Überblenden'],
  ['schnitt', 'Schnitt']
]
const KEN_BURNS: readonly (readonly [KenBurnsWahl, string])[] = [
  ['auto', 'Automatisch'],
  ['aus', 'Aus']
]
const STAERKEN: readonly (readonly [KenBurnsStaerke, string])[] = [
  ['sanft', 'Sanft'],
  ['mittel', 'Mittel'],
  ['stark', 'Stark']
]

function Wahl<T extends string>({
  beschriftung,
  wert,
  optionen,
  aus,
  onChange
}: {
  beschriftung: string
  wert: T
  optionen: readonly (readonly [T, string])[]
  aus?: boolean
  onChange: (v: T) => void
}): JSX.Element {
  return (
    <label className="flex items-center justify-between gap-3">
      {beschriftung}
      <select
        value={wert}
        disabled={aus}
        onChange={(e) => onChange(e.target.value as T)}
        className={AUSWAHL}
      >
        {optionen.map(([v, text]) => (
          <option key={v} value={v}>
            {text}
          </option>
        ))}
      </select>
    </label>
  )
}

export function DiashowMenue({ knopf }: { knopf: string }): JSX.Element {
  const { uebergang, kenBurns, staerke } = useDiashowWahl()
  const wenigBewegung = useWenigBewegung()
  const [offen, setOffen] = useState(false)
  const rahmen = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!offen) return
    const zu = (e: MouseEvent): void => {
      if (!rahmen.current?.contains(e.target as Node)) setOffen(false)
    }
    document.addEventListener('mousedown', zu)
    return () => document.removeEventListener('mousedown', zu)
  }, [offen])
  return (
    <div
      ref={rahmen}
      className="relative"
      onKeyDown={(e) => {
        // Esc schließt nur das Menü, nicht den Betrachter
        if (e.key === 'Escape' && offen) {
          e.stopPropagation()
          setOffen(false)
        }
      }}
    >
      <button
        type="button"
        className={knopf}
        aria-label="Einstellungen der Diashow"
        title="Einstellungen der Diashow"
        aria-haspopup="true"
        aria-expanded={offen}
        onClick={() => setOffen((o) => !o)}
      >
        <Settings2 className="size-4" aria-hidden />
      </button>
      {offen && (
        <div
          role="group"
          aria-label="Einstellungen der Diashow"
          className="absolute right-0 top-9 z-50 w-56 space-y-2 rounded-md border bg-card p-3 text-xs shadow-lg"
        >
          <Wahl
            beschriftung="Übergang"
            wert={uebergang}
            optionen={UEBERGAENGE}
            onChange={(v) => diashowAendern({ uebergang: v })}
          />
          <Wahl
            beschriftung="Ken Burns"
            wert={kenBurns}
            optionen={KEN_BURNS}
            onChange={(v) => diashowAendern({ kenBurns: v })}
          />
          <Wahl
            beschriftung="Stärke"
            wert={staerke}
            optionen={STAERKEN}
            aus={kenBurns === 'aus'}
            onChange={(v) => diashowAendern({ staerke: v })}
          />
          {wenigBewegung && (
            <p className="text-muted-foreground">
              Windows hat Animationen abgeschaltet – die Bilder wechseln ohne Effekte.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
