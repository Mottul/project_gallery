import { Channels } from '@shared/ipc-contracts'
import { pruefeKennung, pruefeOrdnerModus } from '@shared/eingaben'
import {
  fensterVon,
  modusSetzen,
  neuEinlesen,
  ordnerEntfernen,
  ordnerHinzufuegen,
  zustand
} from '../services/library/library'
import { handle } from './handle'

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
}
