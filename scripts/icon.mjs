// Erzeugt aus build/icon.svg das Fenster-Symbol build/icon.png (512 px) und das Windows-Symbol
// build/icon.ico (16–256 px). Eine fertige .ico statt electron-builder selbst umwandeln lassen:
// Dessen umgewandelte Datei bleibt in dist/ liegen und würde nach einem Logo-Wechsel weiter
// verwendet (Befund der Mottulbox). Kleine Stufen als Bitmap (älteres Windows und NSIS), 256 als PNG.
//
// Aufruf: node scripts/icon.mjs   (nach einer Änderung an build/icon.svg; Ergebnis einchecken)

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const BUILD = join(dirname(fileURLToPath(import.meta.url)), '..', 'build')
const svg = readFileSync(join(BUILD, 'icon.svg'))

const render = (px) => sharp(svg, { density: Math.ceil((72 * px) / 256) * 2 }).resize(px, px)

/** ICO-Eintrag als 32-Bit-Bitmap (BGRA, von unten nach oben, dazu leere UND-Maske). */
async function dib(px) {
  const rgba = await render(px).ensureAlpha().raw().toBuffer()
  const kopf = Buffer.alloc(40)
  kopf.writeUInt32LE(40, 0)
  kopf.writeInt32LE(px, 4)
  kopf.writeInt32LE(px * 2, 8) // Höhe zählt Farbe und Maske
  kopf.writeUInt16LE(1, 12)
  kopf.writeUInt16LE(32, 14)
  const pixel = Buffer.alloc(px * px * 4)
  for (let y = 0; y < px; y++) {
    for (let x = 0; x < px; x++) {
      const q = (y * px + x) * 4
      const z = ((px - 1 - y) * px + x) * 4
      pixel[z] = rgba[q + 2]
      pixel[z + 1] = rgba[q + 1]
      pixel[z + 2] = rgba[q]
      pixel[z + 3] = rgba[q + 3]
    }
  }
  const maske = Buffer.alloc(Math.ceil(px / 32) * 4 * px)
  return Buffer.concat([kopf, pixel, maske])
}

const STUFEN = [16, 24, 32, 48, 64, 128, 256]
const bilder = await Promise.all(
  STUFEN.map((px) => (px === 256 ? render(px).png().toBuffer() : dib(px)))
)
const kopf = Buffer.alloc(6)
kopf.writeUInt16LE(1, 2) // Typ: Symbol
kopf.writeUInt16LE(STUFEN.length, 4)
const verzeichnis = Buffer.alloc(16 * STUFEN.length)
let offset = 6 + verzeichnis.length
STUFEN.forEach((px, i) => {
  const o = i * 16
  verzeichnis[o] = px === 256 ? 0 : px // 0 heißt 256
  verzeichnis[o + 1] = px === 256 ? 0 : px
  verzeichnis.writeUInt16LE(1, o + 4)
  verzeichnis.writeUInt16LE(32, o + 6)
  verzeichnis.writeUInt32LE(bilder[i].length, o + 8)
  verzeichnis.writeUInt32LE(offset, o + 12)
  offset += bilder[i].length
})
writeFileSync(join(BUILD, 'icon.ico'), Buffer.concat([kopf, verzeichnis, ...bilder]))
await render(512).png().toFile(join(BUILD, 'icon.png'))
console.log(`build/icon.ico (${STUFEN.join(', ')} px) und build/icon.png (512 px) geschrieben`)
