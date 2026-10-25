// Menü je Ordner: Modus (normal / nur lesen / privat), neu einlesen, entfernen. Ein schlichtes
// Aufklappmenü mit Tastatur (Pfeile, Escape) und Schließen beim Klick daneben.
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { Check, MoreHorizontal, RefreshCw, Trash2 } from 'lucide-react'
import { api } from '@renderer/lib/api'
import { cn } from '@renderer/lib/utils'
import type { FolderMode, LibraryFolder } from '@shared/types'

export const MODUS_TEXT: Record<FolderMode, string> = {
  normal: 'Normal',
  'nur-lesen': 'Nur lesen',
  privat: 'Privat'
}

const MODUS_ERKLAERUNG: Record<FolderMode, string> = {
  normal: 'Galerie darf Metadaten schreiben, wenn du es ausdrücklich willst',
  'nur-lesen': 'Galerie schreibt hier nie – fürs Archiv',
  privat: 'Keine Vorschaubilder auf der Platte, nur im Arbeitsspeicher'
}

const EINTRAG =
  'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-none hover:bg-muted focus-visible:bg-muted'

export function OrdnerMenue({ ordner }: { ordner: LibraryFolder }): JSX.Element {
  const [offen, setOffen] = useState(false)
  const huelle = useRef<HTMLDivElement>(null)
  const menue = useRef<HTMLDivElement>(null)
  const knopf = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!offen) return
    menue.current?.querySelector<HTMLElement>('[role^="menuitem"]')?.focus()
    const daneben = (e: PointerEvent): void => {
      if (!huelle.current?.contains(e.target as Node)) setOffen(false)
    }
    document.addEventListener('pointerdown', daneben)
    return () => document.removeEventListener('pointerdown', daneben)
  }, [offen])

  const schliessen = (): void => {
    setOffen(false)
    knopf.current?.focus()
  }

  const tasten = (e: KeyboardEvent): void => {
    const eintraege = [
      ...(menue.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? [])
    ]
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

  const tun = (fn: () => Promise<unknown>): void => {
    schliessen()
    void fn().catch((err) => api.log(`[renderer] Ordner-Aktion: ${String(err)}`))
  }

  return (
    <div ref={huelle} className="relative">
      <button
        ref={knopf}
        type="button"
        aria-label={`Aktionen für „${ordner.name}“`}
        aria-haspopup="menu"
        aria-expanded={offen}
        onClick={() => setOffen((o) => !o)}
        className={cn(
          'flex size-7 items-center justify-center rounded-sm text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring',
          offen && 'bg-muted text-foreground'
        )}
      >
        <MoreHorizontal className="size-4" aria-hidden />
      </button>
      {offen && (
        <div
          ref={menue}
          role="menu"
          aria-label={`Aktionen für „${ordner.name}“`}
          onKeyDown={tasten}
          className="absolute right-0 top-full z-20 mt-1 w-72 rounded-md border bg-card p-1 shadow-lg"
        >
          <p className="px-2 pb-1 pt-1.5 text-xs font-medium text-muted-foreground">Modus</p>
          {(Object.keys(MODUS_TEXT) as FolderMode[]).map((m) => (
            <button
              key={m}
              type="button"
              role="menuitemradio"
              aria-checked={ordner.mode === m}
              tabIndex={-1}
              className={EINTRAG}
              onClick={() => tun(() => api.library.setFolderMode(ordner.id, m))}
            >
              <Check
                className={cn(
                  'size-4 shrink-0 text-primary-line',
                  ordner.mode !== m && 'invisible'
                )}
                aria-hidden
              />
              <span className="min-w-0">
                <span className="block">{MODUS_TEXT[m]}</span>
                <span className="block text-xs text-muted-foreground">{MODUS_ERKLAERUNG[m]}</span>
              </span>
            </button>
          ))}
          <div className="my-1 border-t" role="separator" />
          <button
            type="button"
            role="menuitem"
            tabIndex={-1}
            className={EINTRAG}
            onClick={() => tun(() => api.library.rescan(ordner.id))}
          >
            <RefreshCw className="size-4 shrink-0" aria-hidden />
            Neu einlesen
          </button>
          <button
            type="button"
            role="menuitem"
            tabIndex={-1}
            className={cn(EINTRAG, 'text-danger')}
            onClick={() => tun(() => api.library.removeFolder(ordner.id))}
          >
            <Trash2 className="size-4 shrink-0" aria-hidden />
            Aus der Galerie entfernen …
          </button>
        </div>
      )}
    </div>
  )
}
