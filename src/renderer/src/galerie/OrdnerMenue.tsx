// Menü je Ordner: Modus (normal / nur lesen / privat), neu einlesen, Fehlende entfernen (2.1),
// entfernen. Ein schlichtes Aufklappmenü mit Tastatur (Pfeile, Escape) und Schließen beim Klick
// daneben oder bei Größenänderung. Gezeichnet über ein Portal direkt in <body>, fest am Knopf: In der Seitenleiste
// schnitte deren Scrollbereich das breitere Menü sonst ab.
import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { Check, FileX, MoreHorizontal, RefreshCw, Trash2 } from 'lucide-react'
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

/** Breite des Menüs in px (w-72) und Abstand zum Fensterrand */
const BREITE = 288
const RAND = 8

/** Lage unter dem Knopf, links bündig, aber nie über den rechten Fensterrand hinaus. */
function lageAm(knopf: HTMLElement): CSSProperties {
  const r = knopf.getBoundingClientRect()
  return {
    position: 'fixed',
    top: r.bottom + 4,
    left: Math.max(RAND, Math.min(r.left, window.innerWidth - BREITE - RAND))
  }
}

export function OrdnerMenue({ ordner }: { ordner: LibraryFolder }): JSX.Element {
  const [lage, setLage] = useState<CSSProperties | null>(null)
  const offen = lage !== null
  const menue = useRef<HTMLDivElement>(null)
  const knopf = useRef<HTMLButtonElement>(null)
  const setOffen = (auf: boolean | ((o: boolean) => boolean)): void => {
    const neu = typeof auf === 'function' ? auf(offen) : auf
    setLage(neu && knopf.current ? lageAm(knopf.current) : null)
  }

  useEffect(() => {
    if (!offen) return
    menue.current?.querySelector<HTMLElement>('[role^="menuitem"]')?.focus()
    const daneben = (e: PointerEvent): void => {
      const ziel = e.target as Node
      if (!menue.current?.contains(ziel) && !knopf.current?.contains(ziel)) setLage(null)
    }
    const zu = (): void => setLage(null)
    document.addEventListener('pointerdown', daneben)
    window.addEventListener('resize', zu)
    return () => {
      document.removeEventListener('pointerdown', daneben)
      window.removeEventListener('resize', zu)
    }
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
    <div>
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
      {lage &&
        createPortal(
          <div
            ref={menue}
            role="menu"
            aria-label={`Aktionen für „${ordner.name}“`}
            onKeyDown={tasten}
            style={lage}
            className="z-50 w-72 rounded-md border bg-card p-1 shadow-lg"
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
            {ordner.missing > 0 && (
              <button
                type="button"
                role="menuitem"
                tabIndex={-1}
                className={EINTRAG}
                onClick={() => tun(() => api.library.removeMissing(ordner.id))}
              >
                <FileX className="size-4 shrink-0" aria-hidden />
                Fehlende entfernen ({ordner.missing}) …
              </button>
            )}
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
          </div>,
          document.body
        )}
    </div>
  )
}
