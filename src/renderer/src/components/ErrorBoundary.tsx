// React-Fehlergrenze (aus der Mottulbox übernommen,
// project_mega/src/renderer/src/components/ErrorBoundary.tsx, Knöpfe ohne deren UI-Baustein):
// fängt Render-Fehler eines Bereichs ab, damit nicht die ganze Seite zum weißen Fenster wird.
// Zeigt eine Ersatzfläche mit „Erneut versuchen“ und „Neu laden“ und meldet den Fehler an die
// Konsole und (best effort) an das Debug-Log des main-Prozesses.

import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'

interface Props {
  children: ReactNode
  /** Optionaler Name des Bereichs (z. B. „Betrachter“), erscheint in der Meldung. */
  label?: string
}
interface State {
  error: Error | null
}

const KNOPF =
  'rounded-md border px-3 py-1.5 text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    const where = this.props.label ? ` (${this.props.label})` : ''
    console.error(`[ErrorBoundary]${where}`, error, info.componentStack)
    try {
      window.api?.log?.(
        `[renderer] Komponenten-Fehler${where}: ${error.message}\n${info.componentStack ?? ''}`
      )
    } catch {
      /* Log ist best effort */
    }
  }

  private reset = (): void => this.setState({ error: null })

  render(): ReactNode {
    const { error } = this.state
    if (!error) return this.props.children
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
        <AlertTriangle className="size-10 text-danger" aria-hidden />
        <div>
          <p className="font-semibold">
            {this.props.label
              ? `Fehler im Bereich „${this.props.label}“`
              : 'Etwas ist schiefgelaufen'}
          </p>
          <p className="mx-auto mt-1 max-w-md break-words text-sm text-muted-foreground">
            {error.message || String(error)}
          </p>
        </div>
        <div className="flex gap-2">
          <button type="button" className={KNOPF} onClick={this.reset}>
            Erneut versuchen
          </button>
          <button type="button" className={KNOPF} onClick={() => window.location.reload()}>
            Neu laden
          </button>
        </div>
      </div>
    )
  }
}
