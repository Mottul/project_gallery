// Pfad zum gebündelten ExifTool – die einzige Stelle, die ihn kennt (Skill windows-paket).
// Gepackt: resources/exiftool (extraResources); beim Entwickeln: resources/exiftool/<os> im Projekt
// (scripts/download-exiftool.mjs). Nie ein ExifTool aus dem PATH.

import { app } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

export function exiftoolPfad(): string | null {
  const exe = process.platform === 'win32' ? 'exiftool.exe' : 'exiftool'
  const pfad = app.isPackaged
    ? join(process.resourcesPath, 'exiftool', exe)
    : join(
        app.getAppPath(),
        'resources',
        'exiftool',
        process.platform === 'win32' ? 'win' : 'linux',
        exe
      )
  return existsSync(pfad) ? pfad : null
}
