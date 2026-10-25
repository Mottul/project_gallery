// Grundgerüst des Hauptfensters: Titelleiste, Inhalt, Statusleiste. Die Galerie selbst
// (Ordnerbaum, Raster, Betrachter) kommt in Phase 1 (docs/PLAN.md).
import { Images, ShieldCheck } from 'lucide-react'
import { APP_NAME } from '@shared/brand'
import { ErrorBoundary } from './components/ErrorBoundary'
import { ThemeSwitch } from './components/app/ThemeSwitch'
import { useAppearanceSync } from './components/app/useAppearance'

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

      <main className="min-h-0 flex-1 overflow-auto">
        <ErrorBoundary>
          <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
            <Images className="size-12 text-muted-foreground" aria-hidden />
            <h1 className="text-lg font-semibold">Noch keine Ordner</h1>
            <p className="max-w-sm text-sm text-muted-foreground">
              Ordner hinzufügen und Bilder ansehen kommt mit der ersten nutzbaren Version.
            </p>
          </div>
        </ErrorBoundary>
      </main>

      <footer className="flex h-7 shrink-0 items-center gap-2 border-t bg-leiste px-3 text-xs text-muted-foreground">
        <ShieldCheck className="size-3.5 text-success" aria-hidden />
        <span>Offline</span>
      </footer>
    </div>
  )
}
