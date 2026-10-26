import { Channels } from '@shared/ipc-contracts'
import {
  pruefeKennung,
  pruefeKennungen,
  pruefeOrdnerFilterStreng,
  pruefeOrdnerModus,
  pruefePfade,
  pruefeSortierungStreng
} from '@shared/eingaben'
import { DETAILS_MAX } from '../services/library/repo'
import {
  abfrage,
  auswahlGroesse,
  bildDetails,
  fensterVon,
  inPapierkorb,
  modusSetzen,
  neuEinlesen,
  ordnerEntfernen,
  ordnerHinzufuegen,
  ordnerHinzufuegenGezogen,
  sichtbar,
  verzeichnisBaum,
  zustand
} from '../services/library/library'
import { handle, on } from './handle'

/** Höchstens so viele Kennungen je Ausschnitt-Meldung (sichtbar + nächste Seite) */
const AUSSCHNITT_MAX = 1000
/** Höchstens so viele Kennungen für eine Summe (die ganze Bibliothek ausgewählt) */
const SUMME_MAX = 200_000
/** Höchstens so viele Bilder auf einmal in den Papierkorb */
const PAPIERKORB_MAX = 10_000
/** Höchstens so viele gezogene Ordner auf einmal */
const GEZOGEN_MAX = 20

export function registerLibraryHandlers(): void {
  handle(Channels.libraryState, () => zustand())
  // Der Pfad kommt aus dem Ordner-Dialog des main, nie vom Renderer (Schicht C)
  handle(Channels.libraryAddFolder, (e) => ordnerHinzufuegen(fensterVon(e.sender)))
  handle(Channels.libraryRemoveFolder, (e, id) =>
    ordnerEntfernen(fensterVon(e.sender), pruefeKennung(id))
  )
  handle(Channels.librarySetFolderMode, (_e, id, mode) =>
    modusSetzen(pruefeKennung(id), pruefeOrdnerModus(mode))
  )
  handle(Channels.libraryRescan, (_e, id) => neuEinlesen(pruefeKennung(id)))
  // Sortierfeld nur aus der Allowlist (sortFilter.ts) – nie Text aus dem Renderer ins SQL
  handle(Channels.libraryQuery, (_e, s, f) =>
    abfrage(pruefeSortierungStreng(s), f === undefined ? undefined : pruefeOrdnerFilterStreng(f))
  )
  handle(Channels.libraryDetails, (_e, ids) => bildDetails(pruefeKennungen(ids, DETAILS_MAX)))
  handle(Channels.libraryDirs, () => verzeichnisBaum())
  handle(Channels.libraryTrash, (e, ids) =>
    inPapierkorb(fensterVon(e.sender), pruefeKennungen(ids, PAPIERKORB_MAX))
  )
  handle(Channels.librarySize, (_e, ids) => auswahlGroesse(pruefeKennungen(ids, SUMME_MAX)))
  on(Channels.libraryVisible, (_e, ids) => sichtbar(pruefeKennungen(ids, AUSSCHNITT_MAX)))
  // Pfade aus dem Preload (aus echten Datei-Objekten eines Drops), geprüft wie beim Dialog
  handle(Channels.libraryAddDropped, (_e, pfade) =>
    ordnerHinzufuegenGezogen(pruefePfade(pfade, GEZOGEN_MAX))
  )
}
