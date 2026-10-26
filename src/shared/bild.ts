// bild://id/<kennung> – das Bild für den Betrachter: das Original, wenn Chromium es selbst zeigen
// kann, sonst eine bildschirmgroße Umrechnung (TIFF; später HEIC/RAW). Rein, getestet in
// bild.test.ts: Adresse, Inhaltstyp, Range-Kopf (Videos spulen damit, Phase 6).
//
// Fester Rechnername „id“ wie bei thumb:// – Ziffern als Rechnername läse Chromium als IP-Adresse.

import { formatAusEndung } from './bildFormate'

export const BILD_PROTOKOLL = 'bild'

export function bildUrl(id: number, version?: number): string {
  return `${BILD_PROTOKOLL}://id/${id}` + (version === undefined ? '' : `?v=${version}`)
}

/** Adresse prüfen; liefert die Kennung oder null. */
export function leseBildUrl(url: string): { id: number } | null {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return null
  }
  if (u.protocol !== `${BILD_PROTOKOLL}:` || u.host !== 'id' || u.username || u.password)
    return null
  const m = /^\/([1-9]\d{0,15})$/.exec(u.pathname)
  if (!m) return null
  const id = Number(m[1])
  return Number.isSafeInteger(id) ? { id } : null
}

/** Formate, die Chromium selbst zeigt (Labor, Formatmatrix): das Original geht unverändert hinaus. */
const DIREKT = new Map<string, string>([
  ['jpeg', 'image/jpeg'],
  ['png', 'image/png'],
  ['webp', 'image/webp'],
  ['gif', 'image/gif'],
  ['avif', 'image/avif'],
  ['bmp', 'image/bmp']
])

/**
 * Inhaltstyp, unter dem das Original direkt ausgeliefert wird – nach dem Format laut Inhalt
 * (ExifTool), sonst nach der Endung; null = umrechnen (TIFF, Unbekanntes).
 */
export function direktTyp(format: string | null, ext: string): string | null {
  const f = format ?? formatAusEndung(`x.${ext}`)
  return (f && DIREKT.get(f)) ?? null
}

/**
 * Range-Kopf lesen („bytes=a-b“, „bytes=a-“, „bytes=-n“; nur ein Bereich). Liefert den Bereich
 * [anfang, ende] (einschließlich), null ohne (gültigen) Range-Wunsch – dann das Ganze –, oder
 * 'ungueltig', wenn der Bereich außerhalb der Datei liegt (416).
 */
export function leseRange(
  kopf: string | null,
  groesse: number
): [number, number] | null | 'ungueltig' {
  if (!kopf) return null
  const m = /^bytes=(\d*)-(\d*)$/.exec(kopf.trim())
  if (!m || (m[1] === '' && m[2] === '')) return null
  if (m[1] === '') {
    // die letzten n Bytes
    const n = Number(m[2])
    if (n === 0) return 'ungueltig'
    return [Math.max(0, groesse - n), groesse - 1]
  }
  const anfang = Number(m[1])
  const ende = m[2] === '' ? groesse - 1 : Math.min(Number(m[2]), groesse - 1)
  if (anfang >= groesse || ende < anfang) return 'ungueltig'
  return [anfang, ende]
}
