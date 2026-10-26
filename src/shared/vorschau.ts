// Vorschaubilder: Stufen, Version des Verfahrens und die Adresse thumb://id/<kennung>/<stufe> –
// rein, getestet in vorschau.test.ts. Der Renderer kennt nur diese Adressen (Schicht C); was
// dahinter steht, schlägt der main im Index nach.
//
// Fester Rechnername „id“ statt thumb://<kennung>/…: thumb ist ein Standard-Protokoll (nötig für
// <img> in einer sicheren Seite), und Chromium liest dort einen Rechnernamen aus Ziffern als
// IP-Adresse („123“ → „0.0.0.123“).

export const THUMB_PROTOKOLL = 'thumb'

export type Stufe = 256 | 768
export const STUFEN: readonly Stufe[] = [256, 768]

/**
 * Version des Verfahrens (Stufen, Qualität, Farbraum, Ausrichtung). Erhöhen, wenn sich das
 * Ergebnis ändert: Sie steckt in jeder Cache-Datei (verschlüsselte Zusatzdaten), alte Dateien
 * gelten dann als nicht vorhanden und werden neu erzeugt (Skill bibliothek-index).
 */
export const VERFAHREN = 1

/** JPEG-/WebP-Qualität (Labor: Start mit 80) */
export const QUALITAET = 80

/** Adresse eines Vorschaubilds; `version` (Änderungszeit) lässt den Bild-Cache der Seite bei
 *  einer geänderten Datei neu laden. */
export function thumbUrl(id: number, stufe: Stufe, version?: number): string {
  return `${THUMB_PROTOKOLL}://id/${id}/${stufe}` + (version === undefined ? '' : `?v=${version}`)
}

/** Adresse prüfen; liefert Kennung und Stufe oder null. Nichts anderes wird angenommen. */
export function leseThumbUrl(url: string): { id: number; stufe: Stufe } | null {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return null
  }
  if (u.protocol !== `${THUMB_PROTOKOLL}:` || u.host !== 'id') return null
  if (u.username || u.password) return null
  // genau zwei Teile; URL hat „..“ schon aufgelöst, kodierte Trenner passen nicht auf das Muster
  const m = /^\/([1-9]\d{0,15})\/(256|768)$/.exec(u.pathname)
  if (!m) return null
  const id = Number(m[1])
  if (!Number.isSafeInteger(id)) return null
  return { id, stufe: Number(m[2]) as Stufe }
}
