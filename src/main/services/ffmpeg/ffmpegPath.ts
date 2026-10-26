// Pfad zum gebündelten ffmpeg – die einzige Stelle, die ihn kennt (Skill windows-paket).
// Gepackt: resources/ffmpeg (extraResources); beim Entwickeln: resources/ffmpeg/<os> im Projekt
// (scripts/download-ffmpeg.mjs). Nie ein ffmpeg aus dem PATH.

import { app } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

export function ffmpegPfad(): string | null {
  const exe = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
  const pfad = app.isPackaged
    ? join(process.resourcesPath, 'ffmpeg', exe)
    : join(
        app.getAppPath(),
        'resources',
        'ffmpeg',
        process.platform === 'win32' ? 'win' : 'linux',
        exe
      )
  return existsSync(pfad) ? pfad : null
}
