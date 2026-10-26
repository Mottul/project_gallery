// Bibliothek im Renderer: EIN gemeinsamer Stand je Fenster, gefüttert von api.library.state()
// und dem Ereignis onChanged (Fortschritt beim Einlesen kommt gedrosselt). Ordner hinzufügen
// läuft über den Dialog im main – der Renderer schickt nie einen Pfad (Schicht C).

import { create } from 'zustand'
import type { LibraryState } from '@shared/types'
import { api } from './api'
import { errorText } from './utils'

const useStore = create<{ state: LibraryState | null; hinweis: string | null; waehlt: boolean }>(
  () => ({ state: null, hinweis: null, waehlt: false })
)

let started = false
function start(): void {
  if (started) return
  started = true
  api.library.onChanged((s) => useStore.setState({ state: s }))
  void api.library.state().then((s) => {
    // ein schon eingetroffenes Ereignis ist neuer als diese Antwort
    if (!useStore.getState().state) useStore.setState({ state: s })
  })
}

/** Ordner und Anzahl; null, solange sie laden. */
export function useLibrary(): LibraryState | null {
  start()
  return useStore((s) => s.state)
}

/** Hinweis zum letzten Hinzufügen (z. B. „liegt schon in …“) und ob der Dialog offen ist. */
export function useHinzufuegenStatus(): { hinweis: string | null; waehlt: boolean } {
  const hinweis = useStore((s) => s.hinweis)
  const waehlt = useStore((s) => s.waehlt)
  return { hinweis, waehlt }
}

export function hinweisSchliessen(): void {
  useStore.setState({ hinweis: null })
}

/** Ordner-Dialog im main öffnen; eine Ablehnung erscheint als Hinweis. Liefert den neuen Ordner. */
export async function ordnerHinzufuegen(): Promise<number | null> {
  useStore.setState({ hinweis: null, waehlt: true })
  try {
    const r = await api.library.addFolder()
    if (r.status === 'abgelehnt') useStore.setState({ hinweis: r.grund })
    return r.status === 'hinzugefuegt' ? r.folder.id : null
  } catch (err) {
    useStore.setState({ hinweis: errorText(err) })
    return null
  } finally {
    useStore.setState({ waehlt: false })
  }
}

/**
 * Gezogene Ordner aufnehmen: Die Datei-Objekte gehen an den Preload, der den Pfad daraus liest
 * (die Seite kennt keine Pfade). Ablehnungen erscheinen gesammelt als Hinweis. Liefert die
 * Kennungen der neu aufgenommenen Ordner.
 */
export async function ordnerGezogen(files: File[]): Promise<number[]> {
  useStore.setState({ hinweis: null })
  try {
    const r = await api.library.addDropped(files)
    if (!r.length) {
      useStore.setState({ hinweis: 'Nur Ordner lassen sich hinzufügen.' })
      return []
    }
    const gruende = r.flatMap((x) => (x.status === 'abgelehnt' ? [x.grund] : []))
    if (gruende.length) useStore.setState({ hinweis: gruende.join(' ') })
    return r.flatMap((x) => (x.status === 'hinzugefuegt' ? [x.folder.id] : []))
  } catch (err) {
    useStore.setState({ hinweis: errorText(err) })
    return []
  }
}
