// Tasten in Raster und Liste der Galerie – seit 3.4 in beiden gleich (entschieden 9.11.2026): Auswahl
// wie im Explorer (Strg+A, Esc), Eingabetaste öffnet, E „Metadaten bearbeiten“, 0–5 und 6–9
// Schnellbewertung, R und L drehen um 90°, Strg+Z nimmt den letzten Hinweis zurück. Was schreibt, zählt
// bei gehaltener Taste nur einmal.

import type { KeyboardEvent } from 'react'
import { tastenDrehung, type Drehung } from '@shared/ausrichtung'
import { auswahlAlle, auswahlLeeren, ersteGewaehlte } from './auswahl'

export interface GalerieTasten {
  ids: readonly number[]
  /** Eingabetaste: das erste gewählte Bild im Betrachter öffnen */
  onOeffnen: (index: number) => void
  /** fehlt, solange eine Ansicht oder der Betrachter darüber liegt */
  onMetadaten?: () => void
  onSchnell?: (taste: string) => void
  onDrehen?: (d: Drehung) => void
  onRueckgaengig?: () => void
}

export function galerieTaste(e: KeyboardEvent, t: GalerieTasten): void {
  const strg = e.ctrlKey || e.metaKey
  const taste = e.key.toLowerCase()
  if (strg && taste === 'a') {
    e.preventDefault()
    auswahlAlle(t.ids)
  } else if (strg && taste === 'z' && t.onRueckgaengig) {
    e.preventDefault()
    t.onRueckgaengig()
  } else if (e.key === 'Escape') auswahlLeeren()
  else if (e.key === 'Enter') {
    const i = ersteGewaehlte(t.ids)
    if (i >= 0) t.onOeffnen(i)
  } else if (strg || e.altKey || e.repeat) return
  else if (taste === 'e' && t.onMetadaten) {
    e.preventDefault()
    t.onMetadaten()
  } else if (/^[0-9]$/.test(e.key) && t.onSchnell) {
    e.preventDefault()
    t.onSchnell(e.key)
  } else {
    const d = tastenDrehung(e.key)
    if (!d || !t.onDrehen) return
    e.preventDefault()
    t.onDrehen(d)
  }
}
