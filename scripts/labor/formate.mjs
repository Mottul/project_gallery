// Labor (Skill bild-labor): Formatmatrix – was dekodiert sharp, was schreibt ExifTool, was zeigt
// bzw. spielt Chromium in der GEBAUTEN App. Die Dateien kommen als blob: in die Seite (erlaubt von
// CSP und Netzsperre) – die Regeln der App werden nicht umgangen.
//
// Aufruf: npx electron-vite build && node scripts/labor/formate.mjs
// (vorher npm run exiftool:fetch und npm run ffmpeg:fetch)
// Ergebnis: Tabelle auf der Konsole und JSON in <tmp>/galeria-labor-formate.json.

import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, extname, join } from 'node:path'
import sharp from 'sharp'
import { launchApp } from '../../e2e/harness.mjs'
import { erzeugeTestbilder, werkzeug } from '../testbilder.mjs'

sharp.cache({ files: 0 })
const exiftool = werkzeug('exiftool')
const ffmpeg = werkzeug('ffmpeg')

/** Minimales 24-Bit-BMP (sharp schreibt kein BMP). */
function bmp(breite, hoehe, [r, g, b]) {
  const zeile = Math.ceil((breite * 3) / 4) * 4
  const daten = Buffer.alloc(zeile * hoehe)
  for (let y = 0; y < hoehe; y++)
    for (let x = 0; x < breite; x++) daten.set([b, g, r], y * zeile + x * 3)
  const kopf = Buffer.alloc(54)
  kopf.write('BM', 0)
  kopf.writeUInt32LE(54 + daten.length, 2)
  kopf.writeUInt32LE(54, 10)
  kopf.writeUInt32LE(40, 14)
  kopf.writeInt32LE(breite, 18)
  kopf.writeInt32LE(hoehe, 22)
  kopf.writeUInt16LE(1, 26)
  kopf.writeUInt16LE(24, 28)
  kopf.writeUInt32LE(daten.length, 34)
  return Buffer.concat([kopf, daten])
}

async function sharpKann(datei) {
  try {
    const m = await sharp(datei, { failOn: 'error' }).metadata()
    await sharp(datei, { failOn: 'error' }).resize(64).raw().toBuffer()
    return `ja (${m.format})`
  } catch (e) {
    return `nein (${String(e.message).split('\n')[0].slice(0, 50)})`
  }
}

function exiftoolSchreibt(datei, dir) {
  const kopie = join(dir, `kopie-${basename(datei)}`)
  copyFileSync(datei, kopie)
  const r = spawnSync(
    exiftool,
    ['-overwrite_original', '-charset', 'filename=utf8', '-XMP-dc:Title=Test', kopie],
    {
      encoding: 'utf8'
    }
  )
  rmSync(kopie, { force: true })
  return /1 image files updated/.test(r.stdout)
    ? 'ja'
    : `nein (${(r.stderr || r.stdout).trim().split('\n')[0].slice(0, 60)})`
}

const MIME = {
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.avi': 'video/x-msvideo',
  // Bilder: der Typ, den später das bild://-Protokoll setzt (SVG errät Chromium nicht)
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp'
}

async function main() {
  const dir = mkdtempSync(join(tmpdir(), 'galeria-labor-formate-'))
  const bib = join(dir, 'bib')
  const ctx = await launchApp()
  try {
    const manifest = await erzeugeTestbilder(bib)
    const kandidaten = manifest.eintraege
      .filter(
        (e) =>
          (e.art === 'bild' && (e.datei.startsWith('formate/') || e.datei === 'orte/paris.jpg')) ||
          e.art === 'video'
      )
      .map((e) => ({ datei: join(bib, ...e.datei.split('/')), art: e.art, name: e.datei }))
    // weitere Formate, die die Testbibliothek nicht enthält
    writeFileSync(join(dir, 'bild.bmp'), bmp(200, 150, [200, 60, 60]))
    kandidaten.push({ datei: join(dir, 'bild.bmp'), art: 'bild', name: 'extra/bild.bmp' })
    writeFileSync(
      join(dir, 'bild.svg'),
      '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="150"><rect width="200" height="150" fill="#22c55e"/></svg>'
    )
    kandidaten.push({ datei: join(dir, 'bild.svg'), art: 'bild', name: 'extra/bild.svg' })
    const videos = [
      ['av1.mp4', ['-c:v', 'libsvtav1', '-pix_fmt', 'yuv420p']],
      ['prores.mov', ['-c:v', 'prores_ks', '-profile:v', '1']],
      ['mpeg4.avi', ['-c:v', 'mpeg4']],
      ['h264.mkv', ['-c:v', 'libopenh264', '-pix_fmt', 'yuv420p']]
    ]
    for (const [name, args] of videos) {
      const ziel = join(dir, name)
      const r = spawnSync(ffmpeg, [
        '-hide_banner',
        '-loglevel',
        'error',
        '-y',
        '-f',
        'lavfi',
        '-i',
        'testsrc2=size=320x240:rate=25:duration=1',
        ...args,
        ziel
      ])
      if (r.status === 0) kandidaten.push({ datei: ziel, art: 'video', name: `extra/${name}` })
    }

    const { page } = ctx
    await page.getByRole('heading', { name: 'Noch keine Ordner' }).waitFor({ timeout: 20_000 })
    const zeilen = []
    for (const k of kandidaten) {
      const b64 = readFileSync(k.datei).toString('base64')
      const chromium = await page.evaluate(
        async ({ b64, art, mime }) => {
          const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
          const url = URL.createObjectURL(new Blob([bytes], mime ? { type: mime } : {}))
          try {
            if (art === 'bild') {
              const img = new Image()
              img.src = url
              try {
                await img.decode()
                return `ja (${img.naturalWidth}×${img.naturalHeight})`
              } catch {
                return 'nein'
              }
            }
            const v = document.createElement('video')
            v.muted = true
            const r = await new Promise((resolve) => {
              const t = setTimeout(() => resolve('nein (Zeitüberschreitung)'), 8000)
              v.onloadeddata = () => {
                clearTimeout(t)
                resolve(`ja (${v.videoWidth}×${v.videoHeight})`)
              }
              v.onerror = () => {
                clearTimeout(t)
                resolve(`nein (${v.error?.message || v.error?.code})`)
              }
              v.src = url
            })
            v.removeAttribute('src')
            v.load()
            return r
          } finally {
            URL.revokeObjectURL(url)
          }
        },
        { b64, art: k.art, mime: MIME[extname(k.datei).toLowerCase()] }
      )
      const zeile = {
        datei: k.name,
        sharp: k.art === 'bild' ? await sharpKann(k.datei) : '–',
        chromium,
        exiftoolSchreibt: exiftoolSchreibt(k.datei, dir)
      }
      zeilen.push(zeile)
      console.log(
        `${zeile.datei.padEnd(26)} sharp: ${zeile.sharp.padEnd(16)} Chromium: ${zeile.chromium.padEnd(24)} ExifTool schreibt: ${zeile.exiftoolSchreibt}`
      )
    }
    const datei = join(tmpdir(), 'galeria-labor-formate.json')
    writeFileSync(datei, JSON.stringify(zeilen, null, 2))
    console.log(`\nJSON: ${datei}`)
  } finally {
    await ctx.close()
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
