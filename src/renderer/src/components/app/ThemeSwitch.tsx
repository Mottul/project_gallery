// Umschalter System / Hell / Dunkel für die Titelleiste (docs/PLAN.md, „Erscheinungsbild“).
// Eine Optionsgruppe: Pfeiltasten wechseln, nur die gewählte Option ist per Tab erreichbar.
import { useRef, type KeyboardEvent } from 'react'
import { Monitor, Moon, Sun, type LucideIcon } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import type { ThemeMode } from '@shared/types'
import { useAppearance } from './useAppearance'

const OPTIONEN: { mode: ThemeMode; label: string; Icon: LucideIcon }[] = [
  { mode: 'system', label: 'Wie Windows', Icon: Monitor },
  { mode: 'light', label: 'Hell', Icon: Sun },
  { mode: 'dark', label: 'Dunkel', Icon: Moon }
]

export function ThemeSwitch(): JSX.Element {
  const { theme, setTheme } = useAppearance()
  const refs = useRef<(HTMLButtonElement | null)[]>([])

  const onKeyDown = (e: KeyboardEvent, index: number): void => {
    const schritt =
      e.key === 'ArrowRight' || e.key === 'ArrowDown'
        ? 1
        : e.key === 'ArrowLeft' || e.key === 'ArrowUp'
          ? -1
          : 0
    if (!schritt) return
    e.preventDefault()
    const next = (index + schritt + OPTIONEN.length) % OPTIONEN.length
    setTheme(OPTIONEN[next].mode)
    refs.current[next]?.focus()
  }

  return (
    <div
      role="radiogroup"
      aria-label="Design"
      className="flex items-center gap-0.5 rounded-md border bg-card p-0.5"
    >
      {OPTIONEN.map(({ mode, label, Icon }, i) => {
        const gewaehlt = theme === mode
        return (
          <button
            key={mode}
            ref={(el) => {
              refs.current[i] = el
            }}
            type="button"
            role="radio"
            aria-checked={gewaehlt}
            aria-label={label}
            title={label}
            tabIndex={gewaehlt ? 0 : -1}
            onClick={() => setTheme(mode)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={cn(
              'flex size-7 items-center justify-center rounded-sm outline-none transition-colors',
              'focus-visible:ring-2 focus-visible:ring-ring',
              gewaehlt
                ? 'bg-muted text-primary-line'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <Icon className="size-4" aria-hidden />
          </button>
        )
      })}
    </div>
  )
}
