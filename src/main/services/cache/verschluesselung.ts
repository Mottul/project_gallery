// Verschlüsselte Cache-Dateien (Schicht D, Skill bildschutz): AES-256-GCM mit zufälligem Nonce je
// Datei. Die Zusatzdaten (AAD) binden den Inhalt an Bild, Stufe, Größe, Änderungszeit und
// Verfahren – eine vertauschte, veraltete oder manipulierte Datei besteht die Prüfung nicht und
// wird neu erzeugt, nie angezeigt. Ohne Electron: läuft im Bilddienst (schreiben) und im main
// (lesen); getestet in verschluesselung.test.ts.

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { VERFAHREN, type Stufe } from '@shared/vorschau'

/** Kennung des Dateiformats („Galeria Beata Vorschau, Format 1“) */
const MAGIE = Buffer.from('GBV1', 'ascii')
const NONCE = 12
const TAG = 16
export const SCHLUESSEL_LAENGE = 32

/** Zusatzdaten einer Vorschau-Datei: was sie sein muss, damit sie gilt. */
export function zusatzdaten(id: number, stufe: Stufe, size: number, mtime: number): string {
  return `galeria-vorschau|${VERFAHREN}|${id}|${stufe}|${size}|${mtime}`
}

function pruefeSchluessel(schluessel: Uint8Array): void {
  if (schluessel.length !== SCHLUESSEL_LAENGE) throw new Error('Schlüssel hat die falsche Länge')
}

export function verschluesseln(schluessel: Uint8Array, klar: Uint8Array, aad: string): Buffer {
  pruefeSchluessel(schluessel)
  const nonce = randomBytes(NONCE)
  const c = createCipheriv('aes-256-gcm', schluessel, nonce)
  c.setAAD(Buffer.from(aad, 'utf8'))
  const inhalt = Buffer.concat([c.update(klar), c.final()])
  return Buffer.concat([MAGIE, nonce, c.getAuthTag(), inhalt])
}

/** Entschlüsselt und prüft; null bei falschem Schlüssel, anderen Zusatzdaten oder Manipulation. */
export function entschluesseln(
  schluessel: Uint8Array,
  daten: Uint8Array,
  aad: string
): Buffer | null {
  pruefeSchluessel(schluessel)
  const b = Buffer.from(daten.buffer, daten.byteOffset, daten.byteLength)
  if (b.length < MAGIE.length + NONCE + TAG || !b.subarray(0, MAGIE.length).equals(MAGIE)) {
    return null
  }
  const nonce = b.subarray(MAGIE.length, MAGIE.length + NONCE)
  const tag = b.subarray(MAGIE.length + NONCE, MAGIE.length + NONCE + TAG)
  try {
    // Tag-Länge fest: Node nähme sonst auch gekürzte Tags (ab 4 Byte) an
    const d = createDecipheriv('aes-256-gcm', schluessel, nonce, { authTagLength: TAG })
    d.setAuthTag(tag)
    d.setAAD(Buffer.from(aad, 'utf8'))
    return Buffer.concat([d.update(b.subarray(MAGIE.length + NONCE + TAG)), d.final()])
  } catch {
    return null
  }
}
