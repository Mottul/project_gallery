// Schlüssel der Vorschau-Cache-Dateien (Schicht D, Skill bildschutz): 32 zufällige Bytes, auf der
// Platte nur durch safeStorage geschützt (Windows: DPAPI, an das Benutzerkonto gebunden). Lässt
// er sich nicht mehr entschlüsseln (anderes Konto, Profil neu), gibt es einen neuen und der alte
// Cache wird geleert – er ist nur abgeleitet, die Originale bleiben unberührt.
//
// Ohne sicheren Speicher (Linux ohne Schlüsselbund, nur CI: „basic_text“ schützt nicht) gilt der
// Schlüssel nur für diese Sitzung und wird nie gespeichert; Vorschaubilder entstehen dann neu.

import { safeStorage } from 'electron'
import { randomBytes } from 'node:crypto'
import { readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { logLine } from '../log'
import { SCHLUESSEL_LAENGE } from './verschluesselung'

const DATEI = 'schluessel.bin'

function sichererSpeicher(): boolean {
  if (!safeStorage.isEncryptionAvailable()) return false
  return process.platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text'
}

/** Alle Cache-Dateien weg (Unterordner der Ablage), der Schlüssel bleibt. */
function cacheLeeren(cacheOrdner: string): void {
  for (const e of readdirSync(cacheOrdner, { withFileTypes: true })) {
    if (e.isDirectory()) rmSync(join(cacheOrdner, e.name), { recursive: true, force: true })
  }
}

/**
 * Schlüssel laden oder anlegen (einmal je Start, im main nach `ready`). `neu`: Der Cache wurde
 * dabei geleert – der Index muss seine Vorschaubilder wieder als offen führen.
 */
export function vorschauSchluessel(cacheOrdner: string): { schluessel: Buffer; neu: boolean } {
  if (!sichererSpeicher()) {
    logLine('[vorschau] kein sicherer Schlüsselspeicher – Schlüssel nur für diese Sitzung')
    cacheLeeren(cacheOrdner)
    return { schluessel: randomBytes(SCHLUESSEL_LAENGE), neu: true }
  }
  const pfad = join(cacheOrdner, DATEI)
  try {
    const k = Buffer.from(safeStorage.decryptString(readFileSync(pfad)), 'base64')
    if (k.length === SCHLUESSEL_LAENGE) return { schluessel: k, neu: false }
    logLine('[vorschau] Schlüssel unbrauchbar – neuer Schlüssel, Cache wird geleert')
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code !== 'ENOENT') {
      logLine(
        '[vorschau] Schlüssel nicht lesbar – neuer Schlüssel, Cache wird geleert:',
        code ?? 'entschlüsseln'
      )
    }
  }
  cacheLeeren(cacheOrdner)
  const neu = randomBytes(SCHLUESSEL_LAENGE)
  const tmp = `${pfad}.${process.pid}.tmp`
  writeFileSync(tmp, safeStorage.encryptString(neu.toString('base64')))
  renameSync(tmp, pfad)
  return { schluessel: neu, neu: true }
}
