import {
  pruefeDrehungStreng,
  pruefeKennung,
  pruefeKennungen,
  pruefeMehrfachAenderungStreng,
  pruefeMetaAenderungStreng,
  pruefeSchreibOptionenStreng
} from '@shared/eingaben'
import { Channels } from '@shared/ipc-contracts'
import { MEHRFACH_MAX, type AuftragStand } from '@shared/metaMehrfach'
import { broadcast } from '../services/broadcast'
import { fensterVon } from '../services/library/library'
import {
  auftragAbbrechen,
  lesenStarten,
  rueckgaengigStarten,
  schreibenStarten
} from '../services/metadata/mehrfach'
import {
  metaAendern,
  metaDrehen,
  metaLesen,
  metaRueckgaengig
} from '../services/metadata/schreiben'
import { handle, on } from './handle'

/** Höchstens so viele Bilder bzw. Journal-Zeilen je Auftrag */
const AUFTRAG_MAX = 10_000

/** Fortschritt und Ende der Mehrfach-Aufträge an die Fenster */
const melden = (stand: AuftragStand): void => broadcast(Channels.metaJob, stand)

export function registerMetaHandlers(): void {
  handle(Channels.metaRead, (_e, id) => metaLesen(pruefeKennung(id)))
  // Felder und Werte aus der Allowlist (metaFields.ts) – nie Tag-Namen aus dem Renderer
  handle(Channels.metaWrite, (_e, ids, aenderung) =>
    metaAendern(pruefeKennungen(ids, AUFTRAG_MAX), pruefeMetaAenderungStreng(aenderung))
  )
  // nur die Richtung (3.4); die neue Ausrichtung bildet der main aus der Datei
  handle(Channels.metaRotate, (_e, id, richtung) =>
    metaDrehen(pruefeKennung(id), pruefeDrehungStreng(richtung))
  )
  handle(Channels.metaUndo, (_e, journal) =>
    metaRueckgaengig(pruefeKennungen(journal, AUFTRAG_MAX))
  )
  // Mehrfachauswahl (3.3): Kennungen statt Objektlisten; Fortschritt und Bericht als Ereignis
  handle(Channels.metaReadMany, (_e, ids) =>
    lesenStarten(pruefeKennungen(ids, MEHRFACH_MAX), melden)
  )
  handle(Channels.metaWriteMany, (e, ids, aenderung, optionen) =>
    schreibenStarten(
      fensterVon(e.sender),
      pruefeKennungen(ids, MEHRFACH_MAX),
      pruefeMehrfachAenderungStreng(aenderung),
      pruefeSchreibOptionenStreng(optionen),
      melden
    )
  )
  handle(Channels.metaUndoMany, (_e, journal) =>
    rueckgaengigStarten(pruefeKennungen(journal, MEHRFACH_MAX), melden)
  )
  on(Channels.metaCancel, (_e, auftrag) => auftragAbbrechen(pruefeKennung(auftrag)))
}
