// Grundgerüst des Hauptfensters: Titelleiste, Ordner links, Galerie, Statusleiste
// (docs/PLAN.md, Phase 1).
import { Images, ShieldCheck } from 'lucide-react'
import { APP_NAME } from '@shared/brand'
import { ErrorBoundary } from './components/ErrorBoundary'
import { ThemeSwitch } from './components/app/ThemeSwitch'
import { useAppearanceSync } from './components/app/useAppearance'
import { Galerie } from './galerie/Galerie'
import { bilderText, Ordnerliste } from './galerie/Ordnerliste'
import { useLibrary } from './lib/library'

function Statusleiste(): JSX.Element {
  const lib = useLibrary()
  return (
    <footer className="flex h-7 shrink-0 items-center gap-3 border-t bg-leiste px-3 text-xs text-muted-foreground">
      {lib && lib.folders.length > 0 && <span>{bilderText(lib.total)}</span>}
      <span className="ml-auto inline-flex items-center gap-1.5">
        <ShieldCheck className="size-3.5 text-success" aria-hidden />
        Offline
      </span>
    </footer>
  )
}

export function App(): JSX.Element {
  useAppearanceSync()
  return (
    <div className="flex h-full flex-col">
      <header className="flex h-11 shrink-0 items-center justify-between gap-3 border-b bg-leiste px-3">
        <div className="flex items-center gap-2">
          <Images className="size-5 text-primary-line" aria-hidden />
          <span className="text-sm font-semibold">{APP_NAME}</span>
        </div>
        <ThemeSwitch />
      </header>

      <div className="flex min-h-0 flex-1">
        <ErrorBoundary label="Ordner">
          <Ordnerliste />
        </ErrorBoundary>
        <main className="min-w-0 flex-1 overflow-auto">
          <ErrorBoundary label="Galerie">
            <Galerie />
          </ErrorBoundary>
        </main>
      </div>

      <Statusleiste />
    </div>
  )
}
