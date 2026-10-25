// Aus der Mottulbox übernommen (project_mega/src/main/services/dialogStartPath.ts, Stand 0cc14cb).
// Startpfad eines Datei-Dialogs – rein und getestet; fileDialogs.ts liefert Ordner und Prüfung.

import { basename, isAbsolute, join } from 'node:path'

/**
 * Ein absoluter Vorschlag bleibt, wie er ist. Sonst startet der Dialog im gemerkten Ordner, beim
 * Speichern mit dem vorgeschlagenen Dateinamen. Gibt es den Ordner nicht mehr (Stick abgezogen,
 * Netzlaufwerk weg), bleibt es beim Vorschlag.
 */
export function dialogStartPath(
  rememberedDir: unknown,
  suggested: string | undefined,
  isDir: (path: string) => boolean
): string | undefined {
  if (suggested && isAbsolute(suggested)) return suggested
  if (typeof rememberedDir !== 'string' || !isAbsolute(rememberedDir) || !isDir(rememberedDir)) {
    return suggested
  }
  return suggested ? join(rememberedDir, basename(suggested)) : rememberedDir
}
