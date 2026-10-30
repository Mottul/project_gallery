// Gespeicherte Ansichten im Renderer (Phase 2.4b): EINE Liste je Fenster, gefüttert von
// api.library.views() und dem Ereignis onViewsChanged (ein entfernter Ordner nimmt seine Ansichten
// mit). Öffnen setzt Knoten, Ansicht und Filter in einem Zug; Speichern nimmt, was gerade gilt.

import { create } from 'zustand'
import type { AnsichtSpeichernErgebnis, GespeicherteAnsicht } from '@shared/gespeicherteAnsicht'
import { api } from './api'
import { ansichtAendern, ansichtLesen, knotenWaehlen } from './ansicht'
import { filterLesen, filterSetzen } from './filter'

const useStore = create<{
  liste: GespeicherteAnsicht[]
  /** Name der zuletzt geöffneten Ansicht – Vorschlag beim Speichern, um sie zu ersetzen */
  zuletzt: string
}>(() => ({ liste: [], zuletzt: '' }))

let gestartet = false
function starten(): void {
  if (gestartet) return
  gestartet = true
  let gemeldet = false
  api.library.onViewsChanged((liste) => {
    gemeldet = true
    useStore.setState({ liste })
  })
  void api.library.views().then((liste) => {
    // ein schon eingetroffenes Ereignis ist neuer als diese Antwort
    if (!gemeldet) useStore.setState({ liste })
  })
}

export function useGespeicherteAnsichten(): GespeicherteAnsicht[] {
  starten()
  return useStore((s) => s.liste)
}

export const useZuletztGeoeffnet = (): string => useStore((s) => s.zuletzt)

export function ansichtOeffnen(a: GespeicherteAnsicht): void {
  // erst der Knoten: ansichtAendern schreibt in die Ansicht des gewählten Knotens
  knotenWaehlen(a.knoten)
  ansichtAendern({
    art: a.art,
    groesse: a.groesse,
    sortierung: a.sortierung,
    gruppierung: a.gruppierung
  })
  filterSetzen(a.filter)
  useStore.setState({ zuletzt: a.name })
}

/** Das gerade Gezeigte unter diesem Namen merken. */
export function ansichtSpeichern(
  name: string,
  ersetzen: boolean
): Promise<AnsichtSpeichernErgebnis> {
  const { knoten, art, groesse, sortierung, gruppierung } = ansichtLesen()
  return api.library.saveView(
    name,
    { knoten, art, groesse, sortierung, gruppierung, filter: filterLesen() },
    ersetzen
  )
}
