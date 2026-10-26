import { randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { entschluesseln, verschluesseln, zusatzdaten } from './verschluesselung'

const schluessel = randomBytes(32)
const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), randomBytes(2000)])
const aad = zusatzdaten(7, 256, 1234, 1_700_000_000_000)

describe('Verschlüsselung der Vorschaubilder', () => {
  it('ver- und entschlüsselt; die Datei verrät den Inhalt nicht', () => {
    const v = verschluesseln(schluessel, jpeg, aad)
    expect(v.subarray(0, 4).toString('ascii')).toBe('GBV1')
    // keine JPEG-Signatur und der Inhalt kommt nirgends im Klartext vor
    expect(v.includes(Buffer.from([0xff, 0xd8, 0xff]))).toBe(false)
    expect(v.includes(jpeg.subarray(100, 132))).toBe(false)
    expect(entschluesseln(schluessel, v, aad)).toEqual(jpeg)
  })

  it('zufälliger Nonce: gleicher Inhalt ergibt jedes Mal eine andere Datei', () => {
    expect(verschluesseln(schluessel, jpeg, aad)).not.toEqual(verschluesseln(schluessel, jpeg, aad))
  })

  it('falscher Schlüssel, ein gekipptes Byte, gekürzte oder fremde Datei: null', () => {
    const v = verschluesseln(schluessel, jpeg, aad)
    expect(entschluesseln(randomBytes(32), v, aad)).toBeNull()
    for (const stelle of [0, 5, 20, 40, v.length - 1]) {
      const kaputt = Buffer.from(v)
      kaputt[stelle] ^= 0x01
      expect(entschluesseln(schluessel, kaputt, aad), `Byte ${stelle}`).toBeNull()
    }
    expect(entschluesseln(schluessel, v.subarray(0, 31), aad)).toBeNull()
    expect(entschluesseln(schluessel, v.subarray(0, v.length - 10), aad)).toBeNull()
    expect(entschluesseln(schluessel, jpeg, aad)).toBeNull()
    expect(entschluesseln(schluessel, Buffer.alloc(0), aad)).toBeNull()
  })

  it('Zusatzdaten binden an Bild, Stufe, Größe, Änderungszeit: vertauscht oder veraltet = null', () => {
    const v = verschluesseln(schluessel, jpeg, aad)
    for (const anders of [
      zusatzdaten(8, 256, 1234, 1_700_000_000_000),
      zusatzdaten(7, 768, 1234, 1_700_000_000_000),
      zusatzdaten(7, 256, 1235, 1_700_000_000_000),
      zusatzdaten(7, 256, 1234, 1_700_000_000_001)
    ]) {
      expect(entschluesseln(schluessel, v, anders), anders).toBeNull()
    }
  })

  it('lehnt Schlüssel mit falscher Länge ab', () => {
    expect(() => verschluesseln(randomBytes(16), jpeg, aad)).toThrow(/Länge/)
    expect(() => entschluesseln(randomBytes(31), jpeg, aad)).toThrow(/Länge/)
  })
})
