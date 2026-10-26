// Bevor eine Datei des Nutzers gelesen wird (Vorschaubild im Bilddienst, Original über bild:// im
// main, Papierkorb): Passt sie noch zum Index, und liegt sie wirklich im Bibliotheksordner? Ohne
// Electron und ohne sharp – Bilddienst und main nutzen dieselbe Prüfung (Schicht C, Skill
// bildschutz: „realpath innerhalb eines Bibliotheksordners, Datei passt zum Index“).

import { lstat, realpath } from 'node:fs/promises'
import { liegtIn, pfadSchluessel } from '@shared/ordnerPruefen'

export function fehler(code: string, meldung = code): Error {
  return Object.assign(new Error(meldung), { code })
}

/**
 * Keine Verknüpfung, gleiche Größe und Änderungszeit wie im Index, der echte Pfad (Junctions,
 * Symlinks aufgelöst) im Ordner. Wirft mit `code`: KEINE_DATEI, GEAENDERT, AUSSERHALB oder dem
 * Code des Dateisystems (ENOENT, EACCES …).
 */
export async function pruefeDatei(
  pfad: string,
  ordner: string,
  size: number,
  mtime: number,
  windows = process.platform === 'win32'
): Promise<void> {
  const st = await lstat(pfad)
  if (!st.isFile()) throw fehler('KEINE_DATEI')
  if (st.size !== size || Math.trunc(st.mtimeMs) !== mtime) throw fehler('GEAENDERT')
  const [echt, wurzel] = await Promise.all([realpath(pfad), realpath(ordner)])
  if (!liegtIn(pfadSchluessel(echt, windows), pfadSchluessel(wurzel, windows))) {
    throw fehler('AUSSERHALB')
  }
}

/** Wartet höchstens `ms` (hängendes Netzlaufwerk), sonst Fehler mit Code ZEITLIMIT. */
export function mitZeitlimit<T>(p: Promise<T>, ms: number): Promise<T> {
  let uhr: NodeJS.Timeout | undefined
  const ablauf = new Promise<never>((_, reject) => {
    uhr = setTimeout(() => reject(fehler('ZEITLIMIT')), ms)
  })
  return Promise.race([p, ablauf]).finally(() => clearTimeout(uhr))
}
