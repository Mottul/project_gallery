// Wo Index und (ab 1.3) Vorschaubilder liegen: unter %LOCALAPPDATA%\Galeria Beata – nicht im
// Roaming-Profil (das wandert mit Anmeldungen über Server) und nicht in OneDrive (Schicht D,
// docs/PLAN.md). Einstellungen und Log bleiben in userData (Roaming).
// Außerhalb von Windows (nur CI): ein Unterordner von userData.
//
// Die E2E-Läufe setzen LOCALAPPDATA auf einen Temp-Ordner (e2e/harness.mjs) – sonst landeten
// Testdaten im echten Profil.

import { app } from 'electron'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { APP_NAME } from '@shared/brand'

/** Basisordner der lokalen Daten (wird angelegt). */
export function lokalerOrdner(): string {
  const local = process.env['LOCALAPPDATA']
  const dir =
    process.platform === 'win32' && local
      ? join(local, APP_NAME)
      : join(app.getPath('userData'), 'lokal')
  mkdirSync(dir, { recursive: true })
  return dir
}

/** Unterordner der lokalen Daten (wird angelegt), z. B. `index`. */
export function lokalerUnterordner(name: string): string {
  const dir = join(lokalerOrdner(), name)
  mkdirSync(dir, { recursive: true })
  return dir
}

/**
 * Sicherungen vor dem Schreiben (Phase 3): neben dem Datenordner statt darin – die Deinstallation
 * löscht ihn, Sicherungen sollen sie überstehen (Skill windows-paket, docs/INSTALL.md). Der Ordner
 * entsteht erst mit der ersten Sicherung.
 */
export function sicherungsOrdner(): string {
  return `${lokalerOrdner()} Sicherungen`
}
