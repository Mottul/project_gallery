import { pruefeKennungen, pruefeMetaAenderungStreng } from '@shared/eingaben'
import { Channels } from '@shared/ipc-contracts'
import { metaAendern, metaRueckgaengig } from '../services/metadata/schreiben'
import { handle } from './handle'

/** Höchstens so viele Bilder bzw. Journal-Zeilen je Auftrag */
const AUFTRAG_MAX = 10_000

export function registerMetaHandlers(): void {
  // Felder und Werte aus der Allowlist (metaFields.ts) – nie Tag-Namen aus dem Renderer
  handle(Channels.metaWrite, (_e, ids, aenderung) =>
    metaAendern(pruefeKennungen(ids, AUFTRAG_MAX), pruefeMetaAenderungStreng(aenderung))
  )
  handle(Channels.metaUndo, (_e, journal) =>
    metaRueckgaengig(pruefeKennungen(journal, AUFTRAG_MAX))
  )
}
