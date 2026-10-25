// Aus der Mottulbox übernommen (project_mega/src/renderer/src/lib/api.ts).
import type { GalerieApi } from '@shared/ipc-contracts'

// Typisierter Zugriff auf die per Preload bereitgestellte Brücke. Fehlt sie (Preload nicht
// geladen), liefert ein Proxy bei jedem Zugriff eine KLARE Meldung statt eines kryptischen
// „Cannot read properties of undefined“ – so landet der Grund in der Fehlergrenze statt in
// einem stillen Absturz.
const missingBridge = (): never => {
  throw new Error('Programmbrücke (window.api) nicht verfügbar – Preload nicht geladen.')
}

export const api: GalerieApi =
  window.api ?? (new Proxy({}, { get: missingBridge }) as unknown as GalerieApi)
