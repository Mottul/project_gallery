// Argumente für ExifTool (Phase 3) – rein, getestet in args.test.ts. Sie gehen zeilenweise über
// stdin; ein roher Zeilenumbruch in einem Wert machte den Rest der Zeile zu einem neuen Argument
// (gemessen, scripts/labor/exiftool-schreiben.mjs). Darum läuft jeder Wert als C-Zeichenkette
// (`#[CSTR]`): Er bleibt in einer Zeile und kommt als Text an. Tag-Namen stammen nur aus
// `shared/metaFields.ts`, Pfade nur aus dem Index.

import { isAbsolute } from 'node:path'
import type { TagWert } from '@shared/metaFields'

const ZEICHEN = new Map([
  ['\\', '\\\\'],
  ['\n', '\\n'],
  ['\r', '\\r'],
  ['\t', '\\t']
])

/** Tag-Namen der Zuordnung; alles andere ist ein Fehler im Programm, kein Eingabefehler */
const TAG = /^[A-Za-z0-9-]+:[A-Za-z0-9-]+$/

/** Ein Tag setzen; ohne Wert wird er entfernt. */
export function tagArgument({ tag, wert }: TagWert): string {
  if (!TAG.test(tag)) throw new Error('Ungültiger Tag-Name')
  const w = wert === null ? '' : String(wert)
  if (/\p{Cc}/u.test(w.replace(/[\n\r\t]/g, ''))) throw new Error('Steuerzeichen in einem Wert')
  return `#[CSTR]-${tag}=${w.replace(/[\\\n\r\t]/g, (z) => ZEICHEN.get(z) as string)}`
}

function pfadPruefen(pfad: string): string {
  if (!isAbsolute(pfad) || /\p{Cc}/u.test(pfad)) throw new Error('Ungültiger Pfad')
  return pfad
}

/**
 * Schreibt in die neue Datei `ziel`; `quelle` bleibt unberührt. Texte als UTF-8, auch in IPTC –
 * sonst kämen Umlaute dort als Latin-1 an. Ohne `-m`: Hat die Datei einen kleineren Fehler in den
 * Metadaten, lehnt ExifTool ab, statt ihn stillschweigend zu übergehen.
 */
export function schreibArgumente(tags: readonly TagWert[], quelle: string, ziel: string): string[] {
  const iptc = tags.some((t) => t.tag.startsWith('IPTC:') && t.wert !== null)
  return [
    '-o',
    pfadPruefen(ziel),
    ...(iptc ? ['-IPTC:CodedCharacterSet=UTF8'] : []),
    ...tags.map(tagArgument),
    pfadPruefen(quelle)
  ]
}
