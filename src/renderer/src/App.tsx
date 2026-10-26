// Grundgerüst des Hauptfensters: Titelleiste, Ordnerbaum links, Galerie, Statusleiste
// (docs/PLAN.md, Phase 1; Entwurf „Galerie – Kacheln“).
import { Images, Loader2, Lock, ShieldCheck } from 'lucide-react'
import { APP_NAME } from '@shared/brand'
import { ErrorBoundary } from './components/ErrorBoundary'
import { ThemeSwitch } from './components/app/ThemeSwitch'
import { useAppearanceSync } from './components/app/useAppearance'
import { Galerie } from './galerie/Galerie'
import { Ordnerbaum } from './galerie/Ordnerbaum'
import { useAuswahl } from './lib/auswahl'
import { useAngezeigt, useAuswahlGroesse } from './lib/bildliste'
import { bilderText, groesseText, zahl } from './lib/format'
import { useLibrary } from './lib/library'

function Statusleiste(): JSX.Element {
  const lib = useLibrary()
  const angezeigt = useAngezeigt()
  const auswahl = useAuswahl()
  const summe = useAuswahlGroesse(auswahl)
  return (
    <footer className="flex h-7 shrink-0 items-center gap-3 border-t bg-leiste px-3 text-xs text-muted-foreground">
      {lib && lib.folders.length > 0 && angezeigt !== null && <span>{bilderText(angezeigt)}</span>}
      {auswahl.size > 0 && (
        <span>
          {zahl.format(auswahl.size)} ausgewählt
          {summe !== null && ` · ${groesseText(summe)}`}
        </span>
      )}
      {/* ohne role="status": die Zahl ändert sich laufend, ein Screenreader läse sie ständig vor */}
      {lib && lib.metaPending > 0 && (
        <span className="inline-flex items-center gap-1.5">
          <Loader2 className="size-3.5 animate-spin" aria-hidden />
          liest Metadaten … noch {zahl.format(lib.metaPending)}
        </span>
      )}
      {lib && lib.thumbPending > 0 && (
        <span className="inline-flex items-center gap-1.5">
          <Loader2 className="size-3.5 animate-spin" aria-hidden />
          erzeugt Vorschaubilder … noch {zahl.format(lib.thumbPending)}
        </span>
      )}
      <span className="ml-auto inline-flex items-center gap-1.5">
        <ShieldCheck className="size-3.5 text-success" aria-hidden />
        Offline
      </span>
      <span className="inline-flex items-center gap-1.5">
        <Lock className="size-3.5 text-success" aria-hidden />
        Vorschaubilder verschlüsselt
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
          <Ordnerbaum />
        </ErrorBoundary>
        <main className="min-w-0 flex-1 overflow-hidden">
          <ErrorBoundary label="Galerie">
            <Galerie />
          </ErrorBoundary>
        </main>
      </div>

      <Statusleiste />
    </div>
  )
}
