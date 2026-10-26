// Ablage der Vorschaubilder im lokalen Datenordner: <cache>/<2 Hex-Zeichen>/<kennung>-<stufe>.gbv.
// Der Dateiname nennt nur Kennung und Stufe (keine Namen, keine Pfade); 256 Unterordner halten
// die Ordner auch bei 100.000 Bildern klein. Ohne Electron: Bilddienst (schreiben) und main
// (lesen, löschen) nutzen dieselben Pfade; getestet in ablage.test.ts.

import { randomBytes } from 'node:crypto'
import { mkdir, rename, rm, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { STUFEN, type Stufe } from '@shared/vorschau'

export function vorschauPfad(cacheOrdner: string, id: number, stufe: Stufe): string {
  return join(cacheOrdner, (id % 256).toString(16).padStart(2, '0'), `${id}-${stufe}.gbv`)
}

/** Atomar schreiben: erst unter einem Zwischennamen daneben, dann umbenennen. */
export async function schreibeAtomar(pfad: string, daten: Uint8Array): Promise<void> {
  await mkdir(dirname(pfad), { recursive: true })
  const tmp = `${pfad}.${process.pid}-${randomBytes(4).toString('hex')}.tmp`
  try {
    await writeFile(tmp, daten)
    await rename(tmp, pfad)
  } catch (err) {
    await rm(tmp, { force: true })
    throw err
  }
}

/** Alle Stufen dieser Bilder löschen (fehlende Dateien sind kein Fehler); liefert die Zahl. */
export async function vorschauLoeschen(
  cacheOrdner: string,
  ids: readonly number[]
): Promise<number> {
  let n = 0
  for (const id of ids) {
    for (const stufe of STUFEN) {
      try {
        await unlink(vorschauPfad(cacheOrdner, id, stufe))
        n++
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
      }
    }
  }
  return n
}
