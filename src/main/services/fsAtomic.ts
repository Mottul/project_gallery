// Aus der Mottulbox übernommen (project_mega/src/main/services/fsAtomic.ts, Stand 0cc14cb).
// Atomar schreiben: erst vollständig (und auf den Datenträger) in eine Nachbardatei, dann
// umbenennen. Bricht der Strom mitten im Schreiben weg, bleibt die alte Datei heil. Genutzt für
// settings.json. Achtung für später: Beide write…Atomic schreiben notfalls direkt (nicht atomar),
// wenn das Umbenennen scheitert – für Einstellungen richtig, für Originale nicht. Dort lieber
// scheitern und melden (Skill metadaten-schreiben, Schicht B im Skill bildschutz).

import { closeSync, fsyncSync, openSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { link, open, rename, rm, writeFile } from 'node:fs/promises'
import { logLine } from './log'

let seq = 0

/** Eindeutige Nachbardatei: Zwei gleichzeitige Schreibvorgänge dürfen sich nicht treffen. Weil
 *  der Name jedes Mal neu ist, räumt jeder Fehlerweg seine Nachbardatei selbst wieder weg. */
function tmpName(file: string): string {
  return `${file}.${process.pid}-${Date.now().toString(36)}-${(seq++).toString(36)}.tmp`
}

export function writeFileAtomic(file: string, data: string | Uint8Array): void {
  const tmp = tmpName(file)
  const fd = openSync(tmp, 'w')
  try {
    try {
      writeFileSync(fd, data) // schreibt vollständig (writeSync dürfte kürzer schreiben)
      fsyncSync(fd)
    } finally {
      closeSync(fd)
    }
  } catch (err) {
    rmSync(tmp, { force: true })
    throw err
  }
  try {
    renameSync(tmp, file)
  } catch (err) {
    // Windows: Virenscanner/Indexer halten die Datei kurz -> dann eben direkt schreiben
    logLine('[fs] Umbenennen fehlgeschlagen, schreibe direkt:', String(err))
    try {
      writeFileSync(file, data)
    } finally {
      rmSync(tmp, { force: true })
    }
  }
}

const RENAME_RETRY = new Set(['EPERM', 'EACCES', 'EBUSY'])

/**
 * Umbenennen mit kurzen Wiederholungen: Unter Windows halten Virenscanner und Sync-Programme
 * (OneDrive, Nextcloud, NAS) die frische Datei oft nur Millisekunden. Der Notweg danach schreibt
 * nicht mehr atomar – bricht er ab, wäre die Datei halb.
 */
async function renameWithRetry(tmp: string, file: string): Promise<void> {
  for (const ms of [25, 50, 100, 200, 400]) {
    try {
      return await rename(tmp, file)
    } catch (err) {
      if (!RENAME_RETRY.has((err as NodeJS.ErrnoException).code ?? '')) throw err
      await new Promise((r) => setTimeout(r, ms))
    }
  }
  await rename(tmp, file)
}

/** Inhalt vollständig in eine neue Nachbardatei schreiben (oder sie bei einem Fehler entfernen). */
async function writeTmp(file: string, data: Uint8Array): Promise<string> {
  const tmp = tmpName(file)
  const fh = await open(tmp, 'w')
  try {
    try {
      await fh.writeFile(data)
      await fh.sync()
    } finally {
      await fh.close()
    }
  } catch (err) {
    await rm(tmp, { force: true }).catch(() => {})
    throw err
  }
  return tmp
}

/** Wie writeFileAtomic, ohne den main-Prozess zu blockieren (große Dateien). */
export async function writeFileAtomicAsync(file: string, data: Uint8Array): Promise<void> {
  const tmp = await writeTmp(file, data)
  try {
    await renameWithRetry(tmp, file)
  } catch (err) {
    logLine('[fs] Umbenennen fehlgeschlagen, schreibe direkt:', String(err))
    try {
      await writeFile(file, data)
    } finally {
      await rm(tmp, { force: true }).catch(() => {})
    }
  }
}

/** Fehler von link(), wenn das Dateisystem keine Hardlinks kann (FAT/exFAT-Stick, manche SMB-Freigaben). */
const NO_HARDLINK = new Set(['EPERM', 'ENOTSUP', 'EOPNOTSUPP', 'ENOSYS', 'EXDEV', 'EINVAL'])

/**
 * Neue Datei anlegen – nie eine vorhandene ersetzen: Gibt es sie inzwischen doch (ein anderer Rechner auf dem
 * NAS), scheitert das mit EEXIST. Geschrieben wird erst vollständig in die Nachbardatei; unter dem
 * Zielnamen erscheint sie erst fertig (link ist atomar). Bricht das Schreiben ab, bleibt am
 * Zielpfad nichts Halbes liegen, das ihn bis zum Löschen von Hand sperrte.
 */
export async function writeNewFileAsync(file: string, data: Uint8Array): Promise<void> {
  const tmp = await writeTmp(file, data)
  try {
    try {
      await link(tmp, file)
    } catch (err) {
      if (!NO_HARDLINK.has((err as NodeJS.ErrnoException).code ?? '')) throw err
      // ohne Hardlinks: Namen exklusiv reservieren (leer), dann die fertige Datei darüberlegen
      await (await open(file, 'wx')).close()
      try {
        await renameWithRetry(tmp, file)
      } catch (renameErr) {
        await rm(file, { force: true }).catch(() => {}) // nur die eigene, leere Reservierung
        throw renameErr
      }
    }
  } finally {
    await rm(tmp, { force: true }).catch(() => {})
  }
}
