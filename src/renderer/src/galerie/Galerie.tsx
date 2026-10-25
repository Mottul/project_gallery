// Hauptfläche: ohne Ordner ein Einstieg zum Hinzufügen; mit Ordnern vorerst die Übersicht.
// Kacheln und Liste kommen mit 1.4, Vorschaubilder mit 1.3 (docs/PLAN.md, Phase 1).
import { FolderPlus, Images } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { ordnerHinzufuegen, useHinzufuegenStatus, useLibrary } from '@renderer/lib/library'
import { bilderText } from './Ordnerliste'

export function Galerie(): JSX.Element | null {
  const lib = useLibrary()
  const { waehlt } = useHinzufuegenStatus()
  if (!lib) return null
  if (!lib.folders.length) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
        <Images className="size-12 text-muted-foreground" aria-hidden />
        <h1 className="text-lg font-semibold">Noch keine Ordner</h1>
        <p className="max-w-sm text-sm text-muted-foreground">
          Füge einen Ordner mit Bildern hinzu. Die Dateien bleiben, wo sie sind – die Galerie liest
          sie nur.
        </p>
        <Button onClick={() => void ordnerHinzufuegen()} disabled={waehlt}>
          <FolderPlus className="size-4" aria-hidden />
          Ordner hinzufügen
        </Button>
      </div>
    )
  }
  const liest = lib.folders.some((f) => f.status === 'liest')
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
      <Images className="size-12 text-muted-foreground" aria-hidden />
      <h1 className="text-lg font-semibold">{bilderText(lib.total)}</h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        {liest
          ? 'Die Ordner werden gerade eingelesen.'
          : 'Die Bildansicht mit Kacheln und Liste folgt im nächsten Entwicklungsschritt.'}
      </p>
    </div>
  )
}
