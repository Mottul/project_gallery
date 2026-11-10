// Labor (Skill bild-labor, Phase 3.4): verlustfreies Drehen über die EXIF-Ausrichtung messen, bevor
// es eingebaut wird. Je Format: Lässt sich die Ausrichtung mit dem gebündelten ExifTool schreiben (mit
// -o in eine Nachbardatei wie der Schreibweg), wo landet sie, bleiben die Bilddaten gleich – und wer
// beachtet sie: sharp (Vorschaubilder, Umrechnung für TIFF), Chromium in der GEBAUTEN App (Betrachter),
// die Windows-Shell (Vorschaubild im Explorer, Eigenschaft System.Photo.Orientation)? Dazu AVIF mit
// irot (die Drehung, die dort eigentlich gilt), alle acht Ausrichtungen weitergedreht (auch die
// gespiegelten) und eine XMP-Ausrichtung, die der EXIF-Ausrichtung widerspricht. Nur synthetische
// Dateien: das Vierfarb-Motiv der Testbilder (Rot oben links, Grün oben rechts, Blau unten links,
// Gelb unten rechts) – nach falscher Drehung stimmt mindestens eine Ecke nicht.
//
// Aufruf: npx electron-vite build && node scripts/labor/ausrichtung.mjs
// (vorher npm run exiftool:fetch und npm run ffmpeg:fetch; ohne gebaute App fehlt Chromium)
// Ergebnis: Tabellen auf der Konsole und JSON in <tmp>/galeria-labor-ausrichtung.json.

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { extname, join } from 'node:path'
import sharp from 'sharp'
import { ausrichtungsPixel, MOTIV, QUADRANTEN, werkzeug } from '../testbilder.mjs'

sharp.cache({ files: 0 })
const EXIFTOOL = werkzeug('exiftool')
const FFMPEG = werkzeug('ffmpeg')
if (!EXIFTOOL) throw new Error('ExifTool fehlt – zuerst npm run exiftool:fetch')
const ORDNER = mkdtempSync(join(tmpdir(), 'galeria-labor-ausrichtung-'))

/** Ein Aufruf mit Argumenten über stdin – wie der Wrapper der App, ein Argument je Zeile */
function et(args) {
  const r = spawnSync(EXIFTOOL, ['-charset', 'filename=utf8', '-@', '-'], {
    input: args.join('\n') + '\n',
    encoding: 'utf8',
    windowsHide: true
  })
  return `${r.stdout}${r.stderr}`.trim().replace(/\s+/g, ' ')
}

// ── Erwartung: Ecken des angezeigten Bildes ──────────────────────────────────────────────────
const { obenLinks: R, obenRechts: G, untenLinks: B, untenRechts: Y } = QUADRANTEN
/** Ecken (ol, or, ul, ur) und Seitenlage je Drehung des aufgerichteten Motivs */
const LAGEN = {
  aufrecht: { ecken: [R, G, B, Y], hoch: false },
  rechts: { ecken: [B, R, Y, G], hoch: true }, // 90° im Uhrzeigersinn
  kopf: { ecken: [Y, B, G, R], hoch: false },
  links: { ecken: [G, Y, R, B], hoch: true }, // 90° gegen den Uhrzeigersinn
  gespiegelt: { ecken: [G, R, Y, B], hoch: false }
}
const nah = (a, b) => a.every((v, i) => Math.abs(v - b[i]) <= 40)
/** Welche Lage zeigen diese Ecken? („?“ = keine) */
function lage({ w, h, ecken }) {
  for (const [name, l] of Object.entries(LAGEN)) {
    if (l.hoch === h > w && l.ecken.every((c, i) => nah(ecken[i], c))) return name
  }
  return `? ${w}×${h} ${JSON.stringify(ecken)}`
}
/** Ecken aus rohen Pixeln (Mitte jedes Viertels) */
function eckenAus(data, w, h, kanaele) {
  const px = (x, y) => {
    const o = (Math.floor(y) * w + Math.floor(x)) * kanaele
    return [data[o], data[o + 1], data[o + 2]]
  }
  return [
    px(w / 4, h / 4),
    px((3 * w) / 4, h / 4),
    px(w / 4, (3 * h) / 4),
    px((3 * w) / 4, (3 * h) / 4)
  ]
}

/** sharp wie im Bilddienst: rotate() ohne Argument richtet nach den Metadaten auf */
async function sharpLage(p) {
  try {
    const { data, info } = await sharp(p).rotate().raw().toBuffer({ resolveWithObject: true })
    return lage({
      w: info.width,
      h: info.height,
      ecken: eckenAus(data, info.width, info.height, info.channels)
    })
  } catch (e) {
    return `kann nicht (${String(e.message).split('\n')[0].slice(0, 40)})`
  }
}

/** Kennung der Bilddaten: ExifTool ImageDataHash, sonst die gespeicherten Pixel (sharp) */
async function bilddaten(p) {
  const h = et(['-api', 'ImageHashType=SHA256', '-ImageDataHash', '-s3', p])
  if (/^[0-9a-f]{64}$/.test(h)) return `hash:${h.slice(0, 12)}`
  try {
    const { data } = await sharp(p, { animated: true }).raw().toBuffer({ resolveWithObject: true })
    return `pixel:${createHash('sha256').update(data).digest('hex').slice(0, 12)}`
  } catch {
    return 'unlesbar'
  }
}

/** Minimales 24-Bit-BMP mit dem Vierfarb-Motiv (sharp schreibt kein BMP). */
async function bmpMotiv() {
  const { data, info } = await sharp(await ausrichtungsPixel(1))
    .raw()
    .toBuffer({ resolveWithObject: true })
  const { width: w, height: h, channels: k } = info
  const zeile = Math.ceil((w * 3) / 4) * 4
  const buf = Buffer.alloc(54 + zeile * h)
  buf.write('BM', 0, 'ascii')
  buf.writeUInt32LE(buf.length, 2)
  buf.writeUInt32LE(54, 10)
  buf.writeUInt32LE(40, 14)
  buf.writeInt32LE(w, 18)
  buf.writeInt32LE(h, 22)
  buf.writeUInt16LE(1, 26)
  buf.writeUInt16LE(24, 28)
  buf.writeUInt32LE(zeile * h, 34)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const q = ((h - 1 - y) * w + x) * k // BMP: unterste Zeile zuerst
      const o = 54 + y * zeile + x * 3
      buf[o] = data[q + 2]
      buf[o + 1] = data[q + 1]
      buf[o + 2] = data[q]
    }
  }
  return buf
}

/** Aufrechtes Motiv in einem Format (verlustfrei, wo es geht) */
async function motivIn(format, p) {
  const s = () => sharp(ausrichtungsPixelCache)
  const machen = {
    jpeg: () => s().jpeg({ quality: 95 }).toFile(p),
    tiff: () => s().tiff().toFile(p),
    png: () => s().png().toFile(p),
    webp: () => s().webp({ lossless: true }).toFile(p),
    avif: () => s().avif({ lossless: true }).toFile(p),
    gif: () => s().gif().toFile(p),
    bmp: async () => writeFileSync(p, await bmpMotiv())
  }
  await machen[format]()
}
let ausrichtungsPixelCache

const MIME = {
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.tif': 'image/tiff'
}
const ENDUNG = { jpeg: 'jpg', tiff: 'tif' }

// ── Chromium in der gebauten App ─────────────────────────────────────────────────────────────
async function chromiumStarten() {
  if (!existsSync(join(process.cwd(), 'out', 'main', 'index.js'))) return null
  const { launchApp } = await import('../../e2e/harness.mjs')
  const ctx = await launchApp()
  await ctx.page.getByRole('heading', { name: 'Noch keine Ordner' }).waitFor({ timeout: 20_000 })
  return ctx
}

/** Wie <img> im Betrachter: natürliche Größe und gezeichnete Ecken (image-orientation: from-image) */
async function chromiumLage(ctx, p) {
  if (!ctx) return '– (nicht gebaut)'
  const b64 = readFileSync(p).toString('base64')
  const r = await ctx.page.evaluate(
    async ({ b64, mime }) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
      const url = URL.createObjectURL(new Blob([bytes], { type: mime }))
      try {
        const img = new Image()
        img.src = url
        try {
          await img.decode()
        } catch {
          return null
        }
        const w = img.naturalWidth
        const h = img.naturalHeight
        const c = document.createElement('canvas')
        c.width = w
        c.height = h
        const g = c.getContext('2d')
        g.drawImage(img, 0, 0)
        const px = (x, y) =>
          Array.from(g.getImageData(Math.floor(x), Math.floor(y), 1, 1).data.slice(0, 3))
        return {
          w,
          h,
          ecken: [
            px(w / 4, h / 4),
            px((3 * w) / 4, h / 4),
            px(w / 4, (3 * h) / 4),
            px((3 * w) / 4, (3 * h) / 4)
          ]
        }
      } finally {
        URL.revokeObjectURL(url)
      }
    },
    { b64, mime: MIME[extname(p).toLowerCase()] }
  )
  return r ? lage(r) : 'zeigt nicht'
}

// ── Windows-Shell: Vorschaubild (IShellItemImageFactory) und System.Photo.Orientation ─────────
function shellMessen(dateien) {
  if (process.platform !== 'win32' || !dateien.length) return new Map()
  const ps1 = join(ORDNER, 'shell.ps1')
  const liste = join(ORDNER, 'shell-dateien.txt')
  writeFileSync(liste, dateien.join('\n'), 'utf8')
  writeFileSync(
    ps1,
    `$ErrorActionPreference = 'Stop'
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System;
using System.Drawing;
using System.Runtime.InteropServices;
[StructLayout(LayoutKind.Sequential)] public struct GROESSE { public int cx; public int cy; }
[ComImport, Guid("bcc18b79-ba16-442f-80c4-8a59c30c463b"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IShellItemImageFactory { [PreserveSig] int GetImage(GROESSE size, int flags, out IntPtr phbm); }
public static class Schale {
  [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = false)]
  static extern void SHCreateItemFromParsingName(string pfad, IntPtr pbc, ref Guid riid, [MarshalAs(UnmanagedType.Interface)] out object ppv);
  [DllImport("gdi32.dll")] static extern bool DeleteObject(IntPtr h);
  public static string Vorschau(string pfad) {
    Guid iid = new Guid("bcc18b79-ba16-442f-80c4-8a59c30c463b");
    object o;
    SHCreateItemFromParsingName(pfad, IntPtr.Zero, ref iid, out o);
    IntPtr h;
    // SIIGBF_THUMBNAILONLY: nie ein Symbol statt der Vorschau
    int hr = ((IShellItemImageFactory)o).GetImage(new GROESSE { cx = 256, cy = 256 }, 0x8, out h);
    if (hr != 0) return "keine Vorschau (0x" + hr.ToString("x8") + ")";
    try {
      using (Bitmap b = Image.FromHbitmap(h)) {
        Func<double, double, string> px = (x, y) => {
          Color c = b.GetPixel((int)(x * b.Width), (int)(y * b.Height));
          return "[" + c.R + "," + c.G + "," + c.B + "]";
        };
        return "{\\"w\\":" + b.Width + ",\\"h\\":" + b.Height + ",\\"ecken\\":[" + px(0.25, 0.25) + "," + px(0.75, 0.25) + "," + px(0.25, 0.75) + "," + px(0.75, 0.75) + "]}";
      }
    } finally { DeleteObject(h); }
  }
}
'@
$shell = New-Object -ComObject Shell.Application
foreach ($p in Get-Content -LiteralPath '${liste}' -Encoding UTF8) {
  $o = $shell.Namespace([System.IO.Path]::GetDirectoryName($p)).ParseName([System.IO.Path]::GetFileName($p))
  $ausr = $o.ExtendedProperty('System.Photo.Orientation')
  $v = try { [Schale]::Vorschau($p) } catch { 'Fehler: ' + $_.Exception.Message }
  Write-Output ($p + '|' + $ausr + '|' + $v)
}`,
    'utf8'
  )
  const r = spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ps1], {
    encoding: 'utf8',
    timeout: 120_000
  })
  if (r.status !== 0) console.log('Shell-Messung:', r.stderr.slice(0, 400))
  const out = new Map()
  for (const zeile of r.stdout.split(/\r?\n/)) {
    const [p, ausr, v] = zeile.split('|')
    if (!v) continue
    let ergebnis = v
    if (v.startsWith('{')) ergebnis = lage(JSON.parse(v))
    out.set(p, { orientation: ausr || '–', vorschau: ergebnis })
  }
  return out
}

// ── Messung ──────────────────────────────────────────────────────────────────────────────────
console.log(
  `ExifTool ${et(['-ver'])}, sharp ${sharp.versions.sharp}, libvips ${sharp.versions.vips}, libheif ${sharp.versions.heif ?? '–'}`
)
ausrichtungsPixelCache = await ausrichtungsPixel(1)
const ctx = await chromiumStarten()
const ergebnis = { formate: [], avifIrot: null, gedreht: [], xmp: [] }
const shellDateien = []
try {
  // 1. Formatmatrix: aufrechtes Motiv, dann EXIF-Ausrichtung 6 („90° im Uhrzeigersinn“) geschrieben
  const zeilen = []
  for (const format of ['jpeg', 'tiff', 'png', 'webp', 'avif', 'gif', 'bmp']) {
    const ext = ENDUNG[format] ?? format
    const quelle = join(ORDNER, `quelle-${format}.${ext}`)
    await motivIn(format, quelle)
    const ziel = join(ORDNER, `ausrichtung6-${format}.${ext}`)
    // genau das Argument des Schreibwegs: Wert als C-Zeichenkette, „#“ = Zahl statt Text
    const schreiben = et(['-o', ziel, '#[CSTR]-EXIF:Orientation#=6', quelle])
    const geschrieben = existsSync(ziel) && /1 image files? created/.test(schreiben)
    const wo = geschrieben ? et(['-G1', '-a', '-s', '-n', '-Orientation', ziel]) || 'nirgends' : '–'
    // ohne „#“ lehnt ExifTool die Zahl ab und kopiert nur (gemessen: „not in PrintConv“)
    const ohneRaute = et([
      '-o',
      join(ORDNER, `ohne-raute-${format}.${ext}`),
      '#[CSTR]-EXIF:Orientation=6',
      quelle
    ])
    const z = {
      format,
      schreiben,
      ohneRaute,
      wo,
      bilddatenGleich: geschrieben ? (await bilddaten(quelle)) === (await bilddaten(ziel)) : null,
      sharpVorher: await sharpLage(quelle),
      sharp: geschrieben ? await sharpLage(ziel) : '–',
      chromiumVorher: await chromiumLage(ctx, quelle),
      chromium: geschrieben ? await chromiumLage(ctx, ziel) : '–'
    }
    zeilen.push({ z, quelle, ziel: geschrieben ? ziel : null })
    shellDateien.push(quelle, ...(geschrieben ? [ziel] : []))
  }

  // 2. AVIF mit irot (ffmpeg setzt es aus der Drehung der Eingabe, falls es das kann)
  if (FFMPEG) {
    const png = join(ORDNER, 'irot-quelle.png')
    writeFileSync(png, ausrichtungsPixelCache)
    const ziel = join(ORDNER, 'irot.avif')
    const r = spawnSync(
      FFMPEG,
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-y',
        '-display_rotation',
        '-90',
        '-i',
        png,
        '-frames:v',
        '1',
        '-c:v',
        'libsvtav1',
        '-pix_fmt',
        'yuv420p',
        '-still-picture',
        '1',
        ziel
      ],
      { encoding: 'utf8' }
    )
    if (r.status === 0 && existsSync(ziel)) {
      ergebnis.avifIrot = {
        exiftool: et(['-G1', '-a', '-s', '-n', '-Rotation', '-ImageMirror', '-ImageSize', ziel]),
        exiftoolSchreibt: et(['-o', join(ORDNER, 'irot2.avif'), '-Rotation=180', ziel]),
        sharp: await sharpLage(ziel),
        chromium: await chromiumLage(ctx, ziel)
      }
      shellDateien.push(ziel)
    } else ergebnis.avifIrot = { ffmpeg: (r.stderr || '').trim().split('\n').pop() }
  }

  // 3. Alle acht Ausrichtungen weiterdrehen (JPEG, wie die Testbilder): Tabelle der App
  const RECHTS = { 1: 6, 6: 3, 3: 8, 8: 1, 2: 7, 7: 4, 4: 5, 5: 2 }
  const LINKS = Object.fromEntries(Object.entries(RECHTS).map(([a, b]) => [b, Number(a)]))
  for (let n = 1; n <= 8; n++) {
    const quelle = join(ORDNER, `n${n}.jpg`)
    await sharp(await ausrichtungsPixel(n))
      .jpeg({ quality: 95 })
      .toFile(quelle)
    et(['-overwrite_original', `-EXIF:Orientation#=${n}`, quelle])
    const vorher = await sharpLage(quelle)
    for (const [richtung, tabelle, soll] of [
      ['rechts', RECHTS, 'rechts'],
      ['links', LINKS, 'links']
    ]) {
      const ziel = join(ORDNER, `n${n}-${richtung}.jpg`)
      et(['-o', ziel, `#[CSTR]-EXIF:Orientation#=${tabelle[n]}`, quelle])
      const sh = await sharpLage(ziel)
      const ch = await chromiumLage(ctx, ziel)
      ergebnis.gedreht.push({
        n,
        richtung,
        neu: tabelle[n],
        vorher,
        sharp: sh,
        chromium: ch,
        ok: sh === soll && (ch === soll || !ctx)
      })
    }
  }

  // 4. XMP-tiff:Orientation widerspricht der EXIF-Ausrichtung: Wer liest welche?
  for (const [name, exif, xmp] of [
    ['exif1-xmp6', 1, 6],
    ['exif6-xmp1', 6, 1],
    ['nur-xmp6', null, 6]
  ]) {
    const p = join(ORDNER, `${name}.jpg`)
    await sharp(ausrichtungsPixelCache).jpeg({ quality: 95 }).toFile(p)
    et([
      '-overwrite_original',
      ...(exif ? [`-EXIF:Orientation#=${exif}`] : []),
      `-XMP-tiff:Orientation#=${xmp}`,
      p
    ])
    ergebnis.xmp.push({
      name,
      gelesen: et(['-G1', '-a', '-s', '-n', '-Orientation', p]),
      sharp: await sharpLage(p),
      chromium: await chromiumLage(ctx, p)
    })
    shellDateien.push(p)
  }

  // 5. Windows-Shell für alle Dateien auf einmal
  const shell = shellMessen(shellDateien)
  for (const { z, quelle, ziel } of zeilen) {
    z.shellVorher = shell.get(quelle) ?? null
    z.shell = ziel ? (shell.get(ziel) ?? null) : null
    ergebnis.formate.push(z)
  }
  if (ergebnis.avifIrot?.sharp)
    ergebnis.avifIrot.shell = shell.get(join(ORDNER, 'irot.avif')) ?? null
  for (const x of ergebnis.xmp) x.shell = shell.get(join(ORDNER, `${x.name}.jpg`)) ?? null
} finally {
  await ctx?.close()
}

// ── Ausgabe ──────────────────────────────────────────────────────────────────────────────────
console.log('\n1. Formatmatrix: aufrechtes Motiv, dann EXIF-Ausrichtung 6 (90° im Uhrzeigersinn)')
for (const z of ergebnis.formate) {
  console.log(`\n── ${z.format}`)
  console.log(`   ExifTool mit #:  ${z.schreiben}   → ${z.wo}`)
  console.log(`   ExifTool ohne #: ${z.ohneRaute}`)
  console.log(`   Bilddaten gleich: ${z.bilddatenGleich}`)
  console.log(`   sharp rotate():  vorher ${z.sharpVorher}, danach ${z.sharp}`)
  console.log(`   Chromium <img>:  vorher ${z.chromiumVorher}, danach ${z.chromium}`)
  console.log(
    `   Windows-Shell:   vorher ${JSON.stringify(z.shellVorher)}, danach ${JSON.stringify(z.shell)}`
  )
}
console.log(
  '\n2. AVIF mit irot (ffmpeg -display_rotation):',
  JSON.stringify(ergebnis.avifIrot, null, 2)
)
console.log('\n3. Weiterdrehen aller acht Ausrichtungen (JPEG; erwartet: rechts bzw. links)')
for (const g of ergebnis.gedreht) {
  console.log(
    `   ${g.n} ${g.richtung.padEnd(6)} → ${g.neu}: vorher ${g.vorher}, sharp ${g.sharp}, Chromium ${g.chromium} ${g.ok ? 'ok' : 'FALSCH'}`
  )
}
console.log('\n4. XMP-tiff:Orientation neben EXIF')
for (const x of ergebnis.xmp) {
  console.log(
    `   ${x.name.padEnd(11)} ${x.gelesen} | sharp ${x.sharp} | Chromium ${x.chromium} | Shell ${JSON.stringify(x.shell)}`
  )
}
const json = join(tmpdir(), 'galeria-labor-ausrichtung.json')
writeFileSync(json, JSON.stringify(ergebnis, null, 2))
console.log(`\nJSON: ${json}`)
rmSync(ORDNER, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
