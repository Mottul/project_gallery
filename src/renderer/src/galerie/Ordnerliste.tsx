// Seitenleiste: Bibliotheksordner mit Anzahl und Zustand, Hinzufügen. Der Ordnerbaum mit
// Unterordnern kommt mit 1.4 (docs/PLAN.md, Phase 1).
import {
  AlertTriangle,
  Folder,
  FolderLock,
  FolderPlus,
  FolderX,
  Loader2,
  ShieldOff,
  X
} from 'lucide-react'
import { Alert } from '@renderer/components/ui/alert'
import {
  hinweisSchliessen,
  ordnerHinzufuegen,
  useHinzufuegenStatus,
  useLibrary
} from '@renderer/lib/library'
import { cn } from '@renderer/lib/utils'
import type { LibraryFolder } from '@shared/types'
import { MODUS_TEXT, OrdnerMenue } from './OrdnerMenue'

const zahl = new Intl.NumberFormat('de-DE')

/** „1 Bild“ / „12.345 Bilder“ */
export function bilderText(n: number): string {
  return `${zahl.format(n)} ${n === 1 ? 'Bild' : 'Bilder'}`
}

function Symbol({ ordner }: { ordner: LibraryFolder }): JSX.Element {
  const k = 'size-4 shrink-0'
  if (ordner.status === 'nicht-erreichbar')
    return <FolderX className={cn(k, 'text-warning')} aria-hidden />
  if (ordner.status === 'liest')
    return <Loader2 className={cn(k, 'animate-spin text-primary-line')} aria-hidden />
  if (ordner.mode === 'nur-lesen')
    return <FolderLock className={cn(k, 'text-muted-foreground')} aria-hidden />
  if (ordner.mode === 'privat')
    return <ShieldOff className={cn(k, 'text-muted-foreground')} aria-hidden />
  return <Folder className={cn(k, 'text-primary-line')} aria-hidden />
}

/** Zweite Zeile: Zustand (liest, nicht erreichbar), fehlende Dateien, Modus. */
function Zustand({ ordner }: { ordner: LibraryFolder }): JSX.Element | null {
  const teile: JSX.Element[] = []
  if (ordner.status === 'liest') {
    teile.push(<span key="liest">liest … {zahl.format(ordner.found)}</span>)
  } else if (ordner.status === 'nicht-erreichbar') {
    teile.push(
      <span key="weg" className="text-warning">
        nicht erreichbar
      </span>
    )
  }
  if (ordner.missing > 0) {
    teile.push(
      <span key="fehlt" className="inline-flex items-center gap-1 text-warning">
        <AlertTriangle className="size-3" aria-hidden />
        {zahl.format(ordner.missing)} {ordner.missing === 1 ? 'fehlt' : 'fehlen'}
      </span>
    )
  }
  if (ordner.mode !== 'normal')
    teile.push(<span key="modus">{MODUS_TEXT[ordner.mode].toLowerCase()}</span>)
  if (!teile.length) return null
  return (
    <p className="flex flex-wrap gap-x-2 text-xs text-muted-foreground">
      {teile.map((t, i) => (
        <span key={i} className="inline-flex items-center gap-2">
          {i > 0 && <span aria-hidden>·</span>}
          {t}
        </span>
      ))}
    </p>
  )
}

export function Ordnerliste(): JSX.Element {
  const lib = useLibrary()
  const { hinweis, waehlt } = useHinzufuegenStatus()
  return (
    <nav aria-label="Ordner" className="flex w-64 shrink-0 flex-col border-r bg-leiste">
      <div className="flex items-center justify-between gap-2 px-3 pb-1 pt-3">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Ordner
        </h2>
        <button
          type="button"
          aria-label="Ordner hinzufügen"
          title="Ordner hinzufügen"
          disabled={waehlt}
          onClick={() => void ordnerHinzufuegen()}
          className="flex size-7 items-center justify-center rounded-sm text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
        >
          <FolderPlus className="size-4" aria-hidden />
        </button>
      </div>
      {hinweis && (
        <div className="relative mx-2 mb-2">
          <Alert tone="warning" className="pr-8">
            {hinweis}
          </Alert>
          <button
            type="button"
            aria-label="Hinweis schließen"
            onClick={hinweisSchliessen}
            className="absolute right-1.5 top-1.5 rounded-sm p-0.5 text-warning hover:bg-warning/10"
          >
            <X className="size-3.5" aria-hidden />
          </button>
        </div>
      )}
      <ul className="min-h-0 flex-1 space-y-0.5 overflow-auto px-2 pb-2">
        {lib?.folders.map((f) => (
          <li
            key={f.id}
            aria-label={f.name}
            className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted/60"
          >
            <Symbol ordner={f} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm" title={f.path}>
                {f.name}
              </p>
              <Zustand ordner={f} />
            </div>
            <span
              className="text-xs tabular-nums text-muted-foreground"
              title={bilderText(f.count)}
            >
              {zahl.format(f.count)}
            </span>
            <OrdnerMenue ordner={f} />
          </li>
        ))}
      </ul>
    </nav>
  )
}
