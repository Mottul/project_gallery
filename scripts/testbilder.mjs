// Synthetische Testbibliothek – NIE echte Fotos (CLAUDE.md, Skill bild-labor). Pixel per sharp,
// Metadaten per gebündeltem ExifTool, Videos per gebündeltem ffmpeg (lavfi). Daneben entsteht
// testbilder.json mit allen erwarteten Werten (Datum, Ort, Ausrichtung, Maße …): Tests erwarten
// Reihenfolgen und Werte damit exakt.
//
// Aufruf: node scripts/testbilder.mjs <zielordner> [--gross] [--ohne-videos]
//   --gross        zusätzlich Panorama 30.000 × 2.000 und ein Bild über 100 MP (Speicher, Grenzen)
//   --ohne-videos  ohne ffmpeg (schneller)
// Voraussetzung: npm run exiftool:fetch (und für Videos npm run ffmpeg:fetch).
// Der Zielordner muss leer sein oder fehlen – das Skript überschreibt nie fremde Dateien.

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import sharp from 'sharp'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OS = process.platform === 'win32' ? 'win' : 'linux'
const EXE = OS === 'win' ? '.exe' : ''

/** Pfad eines gebündelten Werkzeugs oder null (dann fehlt `npm run …:fetch`). */
export function werkzeug(name) {
  const p =
    name === 'exiftool'
      ? join(ROOT, 'resources', 'exiftool', OS, `exiftool${EXE}`)
      : join(ROOT, 'resources', 'ffmpeg', OS, `${name}${EXE}`)
  return existsSync(p) ? p : null
}

// Farben des Ausrichtungs-Motivs: aufgerichtet liegt Rot oben links, Grün oben rechts, Blau unten
// links, Gelb unten rechts – nach falscher Drehung stimmt mindestens eine Ecke nicht.
export const QUADRANTEN = {
  obenLinks: [220, 30, 30],
  obenRechts: [30, 200, 60],
  untenLinks: [40, 70, 220],
  untenRechts: [235, 210, 40]
}
const MOTIV = { breite: 300, hoehe: 200 }

/** Quer-Motiv mit vier farbigen Vierteln als rohe RGB-Pixel. */
function quadrantenMotiv() {
  const { breite, hoehe } = MOTIV
  const px = Buffer.alloc(breite * hoehe * 3)
  for (let y = 0; y < hoehe; y++) {
    for (let x = 0; x < breite; x++) {
      const links = x < breite / 2
      const oben = y < hoehe / 2
      const c = oben
        ? links
          ? QUADRANTEN.obenLinks
          : QUADRANTEN.obenRechts
        : links
          ? QUADRANTEN.untenLinks
          : QUADRANTEN.untenRechts
      px.set(c, (y * breite + x) * 3)
    }
  }
  return sharp(px, { raw: { width: breite, height: hoehe, channels: 3 } })
}

/**
 * Gespeicherte Pixel für EXIF-Ausrichtung n: die Umkehrung dessen, was ein Betrachter anwendet,
 * damit das Bild aufgerichtet wieder wie das Motiv aussieht. Schritte einzeln (sharp führt
 * rotate und flip/flop in fester Reihenfolge aus, nicht in der Aufruf-Reihenfolge).
 */
const GESPEICHERT = {
  1: [],
  2: ['flop'],
  3: [['rotate', 180]],
  4: ['flip'],
  5: [['rotate', 90], 'flop'], // Transponieren
  6: [['rotate', 270]],
  7: [['rotate', 90], 'flip'], // Transversale
  8: [['rotate', 90]]
}

async function ausrichtungsBild(n) {
  let buf = await quadrantenMotiv().png().toBuffer()
  for (const schritt of GESPEICHERT[n]) {
    const s = sharp(buf)
    buf = await (Array.isArray(schritt) ? s.rotate(schritt[1]) : s[schritt]()).png().toBuffer()
  }
  return sharp(buf).jpeg({ quality: 92 }).toBuffer()
}

/** Einfarbiges Bild mit leichtem Verlauf (gut komprimierbar, aber kein reiner Block). */
function flaeche(breite, hoehe, farbe) {
  return sharp({
    create: { width: breite, height: hoehe, channels: 3, background: farbe }
  })
}

const ORTE = {
  dubrovnik: { lat: 42.6507, lon: 18.0944, ort: 'Dubrovnik', land: 'Kroatien' },
  muenchen: { lat: 48.1374, lon: 11.5755, ort: 'München', land: 'Deutschland' },
  paris: { lat: 48.8584, lon: 2.2945, ort: 'Paris', land: 'Frankreich' },
  parisTexas: { lat: 33.6609, lon: -95.5555, ort: 'Paris', land: 'Vereinigte Staaten' }
}

/** Farben des BMP-Testbilds: oben/unten verschieden – eine falsch herum gelesene Datei fällt auf */
export const BMP_FARBEN = { oben: [8, 145, 178], unten: [245, 158, 11] }

/**
 * Unkomprimiertes 24-Bit-BMP, obere Hälfte `oben`, untere `unten`. Von Hand, weil sharp BMP weder
 * schreiben noch lesen kann. BMP speichert die Zeilen von unten nach oben, je auf 4 Byte aufgefüllt.
 */
function bmpBild(breite, hoehe, { oben, unten }) {
  const zeile = Math.ceil((breite * 3) / 4) * 4
  const daten = zeile * hoehe
  const buf = Buffer.alloc(54 + daten)
  buf.write('BM', 0, 'ascii')
  buf.writeUInt32LE(54 + daten, 2)
  buf.writeUInt32LE(54, 10) // Beginn der Pixel
  buf.writeUInt32LE(40, 14) // BITMAPINFOHEADER
  buf.writeInt32LE(breite, 18)
  buf.writeInt32LE(hoehe, 22) // positiv = Zeilen von unten
  buf.writeUInt16LE(1, 26)
  buf.writeUInt16LE(24, 28)
  buf.writeUInt32LE(daten, 34)
  for (let y = 0; y < hoehe; y++) {
    // y = 0 ist die UNTERSTE Zeile
    const [r, g, b] = y < hoehe / 2 ? unten : oben
    for (let x = 0; x < breite; x++) {
      const o = 54 + y * zeile + x * 3
      buf[o] = b
      buf[o + 1] = g
      buf[o + 2] = r
    }
  }
  return buf
}

const KAMERA_A = { hersteller: 'Galeria', modell: 'Testkamera A' }
const KAMERA_B = { hersteller: 'Galeria', modell: 'Testkamera B' }

/** ExifTool-Argumente für die erwarteten Werte eines Eintrags. */
function exifArgs(e) {
  const a = []
  if (e.aufnahme) {
    const d = e.aufnahme.lokal.replace('T', ' ').replace(/-/g, ':')
    a.push(`-DateTimeOriginal=${d}`, `-CreateDate=${d}`)
    if (e.aufnahme.offset) a.push(`-OffsetTimeOriginal=${e.aufnahme.offset}`)
  }
  if (e.gps) {
    a.push(
      `-GPSLatitude=${Math.abs(e.gps.lat)}`,
      `-GPSLatitudeRef=${e.gps.lat >= 0 ? 'N' : 'S'}`,
      `-GPSLongitude=${Math.abs(e.gps.lon)}`,
      `-GPSLongitudeRef=${e.gps.lon >= 0 ? 'E' : 'W'}`
    )
  }
  if (e.kamera) a.push(`-Make=${e.kamera.hersteller}`, `-Model=${e.kamera.modell}`)
  if (e.objektiv) a.push(`-EXIF:LensModel=${e.objektiv}`)
  if (e.belichtung) {
    const b = e.belichtung
    a.push(
      `-FNumber=${b.blende}`,
      `-ExposureTime=${b.zeit}`,
      `-ISO=${b.iso}`,
      `-FocalLength=${b.brennweite}`
    )
  }
  if (e.bewertung !== undefined) a.push(`-XMP-xmp:Rating=${e.bewertung}`)
  if (e.farblabel) a.push(`-XMP-xmp:Label=${e.farblabel}`)
  if (e.titel) a.push(`-XMP-dc:Title=${e.titel}`)
  if (e.beschreibung) a.push(`-XMP-dc:Description=${e.beschreibung}`)
  for (const k of e.stichwoerter ?? []) a.push(`-XMP-dc:Subject+=${k}`)
  // nur in IPTC (ältere Programme) – die Galerie führt beide Listen zusammen
  for (const k of e.iptcStichwoerter ?? []) a.push(`-IPTC:Keywords+=${k}`)
  if (e.ausrichtung) a.push(`-Orientation#=${e.ausrichtung}`)
  return a
}

/**
 * Metadaten in einem einzigen ExifTool-Lauf schreiben: je Datei ein Block im Argumentfile,
 * getrennt durch -execute. Pfade und Werte stehen im UTF-8-Argumentfile (Umlaute, Emoji) –
 * nie auf der Kommandozeile, und ein Name wie „-rf.jpg“ wird so nie zur Option.
 */
function schreibeMetadaten(exiftool, bloecke) {
  if (!bloecke.length) return
  const argfile = join(tmpdir(), `galeria-testbilder-${process.pid}.args`)
  const zeilen = []
  for (const { datei, args } of bloecke) zeilen.push(...args, datei, '-execute')
  writeFileSync(argfile, zeilen.join('\n') + '\n', 'utf8')
  try {
    const r = spawnSync(
      exiftool,
      ['-@', argfile, '-common_args', '-charset', 'filename=utf8', '-overwrite_original', '-q'],
      { encoding: 'utf8', timeout: 120_000 }
    )
    if (r.status !== 0) throw new Error(`ExifTool: ${r.stderr || r.error?.message}`)
  } finally {
    rmSync(argfile, { force: true })
  }
}

function ffmpegLauf(ffmpeg, args) {
  const r = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', ...args], {
    encoding: 'utf8',
    timeout: 120_000
  })
  return r.status === 0 ? null : (r.stderr || r.error?.message || `Code ${r.status}`).trim()
}

/**
 * Testbibliothek in `ziel` anlegen; gibt das Manifest zurück (auch als testbilder.json im Ziel).
 * Jeder Eintrag: datei (relativ, mit /), art (bild | video | defekt) und die erwarteten Werte.
 */
export async function erzeugeTestbilder(ziel, { gross = false, videos = true } = {}) {
  const exiftool = werkzeug('exiftool')
  if (!exiftool) throw new Error('ExifTool fehlt – zuerst `npm run exiftool:fetch`')
  const ffmpeg = videos ? werkzeug('ffmpeg') : null
  if (videos && !ffmpeg)
    throw new Error('ffmpeg fehlt – zuerst `npm run ffmpeg:fetch` (oder --ohne-videos)')
  if (existsSync(ziel) && readdirSync(ziel).length) {
    throw new Error(`Zielordner ist nicht leer: ${ziel}`)
  }
  mkdirSync(ziel, { recursive: true })

  const eintraege = []
  const meta = []
  const pfad = (datei) => join(ziel, ...datei.split('/'))
  const neu = async (e, bild) => {
    mkdirSync(dirname(pfad(e.datei)), { recursive: true })
    await bild.toFile(pfad(e.datei))
    eintraege.push(e)
    const args = exifArgs(e)
    if (args.length) meta.push({ datei: pfad(e.datei), args })
  }

  // 1. Ausrichtungen 1–8: gleiches Motiv, aufgerichtet immer 300 × 200
  for (let n = 1; n <= 8; n++) {
    const e = {
      datei: `ausrichtung/ausrichtung-${n}.jpg`,
      art: 'bild',
      format: 'jpeg',
      breite: MOTIV.breite,
      hoehe: MOTIV.hoehe,
      ausrichtung: n,
      aufnahme: { lokal: `2024-05-0${n}T12:00:00` },
      kamera: KAMERA_A
    }
    await neu(e, sharp(await ausrichtungsBild(n)))
  }

  // 2. Orte: Sortierung A–Z, gleichnamige Orte in zwei Ländern, ohne Standort am Ende
  const orte = [
    {
      datei: 'orte/dubrovnik.jpg',
      gps: ORTE.dubrovnik,
      aufnahme: { lokal: '2024-07-14T18:30:05', offset: '+02:00' },
      bewertung: 5,
      titel: 'Altstadt am Abend',
      beschreibung: 'Blick über die Stadtmauer',
      stichwoerter: ['Urlaub', 'Meer'],
      farblabel: 'Red',
      objektiv: 'Galeria 35mm F1.8',
      belichtung: { blende: 8, zeit: 0.004, iso: 100, brennweite: 35 },
      farbe: '#d97706'
    },
    {
      datei: 'orte/muenchen.jpg',
      gps: ORTE.muenchen,
      aufnahme: { lokal: '2023-12-24T16:00:00' },
      bewertung: 3,
      stichwoerter: ['Familie', 'Weihnachten'],
      iptcStichwoerter: ['Weihnachten', 'Winter'],
      farbe: '#2563eb'
    },
    {
      datei: 'orte/paris.jpg',
      gps: ORTE.paris,
      aufnahme: { lokal: '2022-04-02T09:15:00', offset: '+02:00' },
      kamera: KAMERA_B,
      titel: 'Tour Eiffel – Morgen',
      farbe: '#16a34a'
    },
    {
      datei: 'orte/paris-texas.jpg',
      gps: ORTE.parisTexas,
      aufnahme: { lokal: '2022-04-03T10:00:00', offset: '-05:00' },
      kamera: KAMERA_B,
      farbe: '#9333ea'
    }
  ]
  for (const { farbe, ...o } of orte) {
    await neu(
      { art: 'bild', format: 'jpeg', breite: 640, hoehe: 480, kamera: KAMERA_A, ...o },
      flaeche(640, 480, farbe).jpeg()
    )
  }

  // 3. Namen: natürliche Sortierung, Groß/Klein, Umlaute, Emoji, führender Bindestrich
  const namen = [
    ['namen/bild 1.jpg', '2021-01-01T08:00:00'],
    ['namen/Bild 2.jpg', '2021-01-02T08:00:00'],
    ['namen/Bild 10.jpg', '2021-01-10T08:00:00'],
    ['namen/Übersicht äöü ß.jpg', '2021-02-01T08:00:00'],
    ['namen/Sonne 🌞.jpg', '2021-02-02T08:00:00'],
    ['namen/-rf.jpg', '2021-02-03T08:00:00']
  ]
  for (const [datei, lokal] of namen) {
    await neu(
      {
        datei,
        art: 'bild',
        format: 'jpeg',
        breite: 320,
        hoehe: 240,
        aufnahme: { lokal },
        titel: datei.includes('Sonne') ? 'Grüße aus Köln 🌞' : undefined,
        stichwoerter: datei.includes('Übersicht') ? ['Ärger', 'Café'] : undefined
      },
      flaeche(320, 240, '#64748b').jpeg()
    )
  }

  // 4. Formate und Dekoder-Pfade (ohne Aufnahmedatum: fällt auf das Dateidatum zurück)
  const f = (datei, format, breite, hoehe, bild, extra = {}) =>
    neu({ datei, art: 'bild', format, breite, hoehe, ...extra }, bild)
  await f(
    'formate/progressiv.jpg',
    'jpeg',
    400,
    300,
    flaeche(400, 300, '#0ea5e9').jpeg({ progressive: true })
  )
  await f(
    'formate/cmyk.jpg',
    'jpeg',
    400,
    300,
    flaeche(400, 300, '#e11d48').toColourspace('cmyk').jpeg(),
    { farbraum: 'cmyk' }
  )
  await f(
    'formate/16bit.png',
    'png',
    400,
    300,
    flaeche(400, 300, '#84cc16').toColourspace('rgb16').png()
  )
  await f(
    'formate/alpha.png',
    'png',
    400,
    300,
    sharp({
      create: {
        width: 400,
        height: 300,
        channels: 4,
        background: { r: 20, g: 180, b: 120, alpha: 0.5 }
      }
    }).png()
  )
  await f('formate/bild.webp', 'webp', 400, 300, flaeche(400, 300, '#f97316').webp())
  await f('formate/bild.gif', 'gif', 400, 300, flaeche(400, 300, '#a855f7').gif())
  await f('formate/bild.avif', 'avif', 400, 300, flaeche(400, 300, '#14b8a6').avif())
  await f('formate/bild.tif', 'tiff', 400, 300, flaeche(400, 300, '#eab308').tiff())
  // Display-P3 mit kräftigem Rot: nach sRGB umgerechnet darf es nicht blasser werden
  await f(
    'formate/p3-rot.jpg',
    'jpeg',
    400,
    300,
    flaeche(400, 300, '#ff0000').withIccProfile('p3').jpeg(),
    { farbraum: 'p3' }
  )
  const rahmen = await Promise.all(
    ['#ef4444', '#22c55e', '#3b82f6'].map((c) => flaeche(200, 150, c).png().toBuffer())
  )
  await f(
    'formate/animiert.gif',
    'gif',
    200,
    150,
    sharp(rahmen, { join: { animated: true } }).gif(),
    { bilder: 3 }
  )
  await f(
    'formate/animiert.webp',
    'webp',
    200,
    150,
    sharp(rahmen, { join: { animated: true } }).webp(),
    { bilder: 3 }
  )
  // PNG mit falscher Endung: kein Defekt, der Inhalt entscheidet
  await f('formate/png-als.jpg', 'png', 120, 90, flaeche(120, 90, '#475569').png())
  // ohne Metadaten und ohne Datum
  await f('formate/ohne-metadaten.png', 'png', 120, 90, flaeche(120, 90, '#334155').png())
  // BMP: Vorschaubild per ffmpeg (sharp liest es nicht), Anzeige in Chromium
  mkdirSync(join(ziel, 'formate'), { recursive: true })
  writeFileSync(pfad('formate/bild.bmp'), bmpBild(400, 300, BMP_FARBEN))
  eintraege.push({ datei: 'formate/bild.bmp', art: 'bild', format: 'bmp', breite: 400, hoehe: 300 })

  if (gross) {
    await f(
      'gross/panorama-30000x2000.jpg',
      'jpeg',
      30000,
      2000,
      flaeche(30000, 2000, '#0369a1').jpeg()
    )
    await f(
      'gross/riesig-12000x9000.jpg',
      'jpeg',
      12000,
      9000,
      flaeche(12000, 9000, '#065f46').jpeg()
    )
  }

  schreibeMetadaten(exiftool, meta)

  // 5. Kaputte Dateien: dürfen nur „defekt“ ergeben, nie einen Dienst hängen lassen
  const kaputt = async (datei, bauen) => {
    mkdirSync(dirname(pfad(datei)), { recursive: true })
    await bauen(pfad(datei))
    eintraege.push({ datei, art: 'defekt' })
  }
  await kaputt('defekt/leer.jpg', (p) => writeFileSync(p, Buffer.alloc(0)))
  await kaputt('defekt/abgeschnitten.jpg', async (p) => {
    const buf = await flaeche(400, 300, '#dc2626').jpeg().toBuffer()
    writeFileSync(p, buf.subarray(0, Math.floor(buf.length / 2)))
  })
  await kaputt('defekt/exif-laenge.jpg', async (p) => {
    // gültiges JPEG mit EXIF, dann die Länge des EXIF-Segments (APP1) auf 0xFFFF verbogen
    await flaeche(200, 150, '#7c3aed').jpeg().toFile(p)
    schreibeMetadaten(exiftool, [{ datei: p, args: ['-Make=Galeria', '-Model=Defekt'] }])
    const buf = readFileSync(p)
    const app1 = buf.indexOf(Buffer.from([0xff, 0xe1]))
    if (app1 < 0) throw new Error('kein APP1-Segment')
    buf[app1 + 2] = 0xff
    buf[app1 + 3] = 0xff
    writeFileSync(p, buf)
  })
  await kaputt('defekt/kein-bild.png', (p) => writeFileSync(p, 'Das ist Text, kein Bild.\n'))

  // 6. Videos: H.264/AAC, hochkant mit Drehung, „Handy“-MOV mit Zeitzone und GPS, VP9, sehr kurz
  if (ffmpeg) {
    mkdirSync(join(ziel, 'videos'), { recursive: true })
    const src = (w, h, sek) => [
      '-f',
      'lavfi',
      '-i',
      `testsrc2=size=${w}x${h}:rate=25:duration=${sek}`
    ]
    const ton = (sek) => ['-f', 'lavfi', '-i', `sine=frequency=440:duration=${sek}`]
    const h264 = ['-c:v', 'libopenh264', '-pix_fmt', 'yuv420p', '-b:v', '400k']
    const videosListe = [
      {
        e: {
          datei: 'videos/h264-aac.mp4',
          breite: 320,
          hoehe: 240,
          dauerMs: 2000,
          ton: true,
          aufnahme: { utc: '2023-06-10T14:00:00Z' }
        },
        args: [...src(320, 240, 2), ...ton(2), ...h264, '-c:a', 'aac', '-shortest'],
        meta: ['-QuickTime:CreateDate=2023:06:10 14:00:00']
      },
      {
        // gespeichert quer, angezeigt hochkant (wie ein Handyvideo)
        e: {
          datei: 'videos/hochkant.mp4',
          breite: 240,
          hoehe: 320,
          roh: { breite: 320, hoehe: 240 },
          drehung: 90,
          dauerMs: 1000,
          ton: false
        },
        args: [...src(320, 240, 1), ...h264],
        meta: ['-Rotation=90']
      },
      {
        e: {
          datei: 'videos/handy.mov',
          breite: 320,
          hoehe: 240,
          dauerMs: 1000,
          ton: true,
          aufnahme: { lokal: '2024-08-01T10:00:00', offset: '+02:00', utc: '2024-08-01T08:00:00Z' },
          gps: ORTE.muenchen
        },
        args: [...src(320, 240, 1), ...ton(1), ...h264, '-c:a', 'aac', '-shortest', '-f', 'mov'],
        meta: [
          '-QuickTime:CreateDate=2024:08:01 08:00:00',
          '-Keys:CreationDate=2024:08:01 10:00:00+02:00',
          `-Keys:GPSCoordinates=${ORTE.muenchen.lat}, ${ORTE.muenchen.lon}, 520`
        ]
      },
      {
        e: { datei: 'videos/vp9-opus.webm', breite: 320, hoehe: 240, dauerMs: 1000, ton: true },
        args: [
          ...src(320, 240, 1),
          ...ton(1),
          '-c:v',
          'libvpx-vp9',
          '-b:v',
          '300k',
          '-c:a',
          'libopus',
          '-shortest'
        ],
        meta: []
      },
      {
        e: { datei: 'videos/sehr-kurz.mp4', breite: 320, hoehe: 240, dauerMs: 400, ton: false },
        args: [...src(320, 240, 0.4), ...h264],
        meta: []
      }
    ]
    // HEVC nur, wo der Rechner einen Encoder hat (Windows: Media Foundation) – sonst vermerken
    if (OS === 'win') {
      videosListe.push({
        e: { datei: 'videos/hevc.mov', breite: 320, hoehe: 240, dauerMs: 1000, ton: false },
        args: [...src(320, 240, 1), '-c:v', 'hevc_mf', '-pix_fmt', 'nv12', '-f', 'mov'],
        meta: [],
        optional: true
      })
    }
    const vmeta = []
    const fehlend = []
    for (const v of videosListe) {
      const fehler = ffmpegLauf(ffmpeg, [...v.args, pfad(v.e.datei)])
      if (fehler) {
        rmSync(pfad(v.e.datei), { force: true })
        if (v.optional) {
          fehlend.push({ datei: v.e.datei, grund: fehler.split('\n').pop() })
          continue
        }
        throw new Error(`ffmpeg für ${v.e.datei}: ${fehler}`)
      }
      eintraege.push({ art: 'video', ...v.e })
      if (v.meta.length) vmeta.push({ datei: pfad(v.e.datei), args: v.meta })
    }
    schreibeMetadaten(exiftool, vmeta)
    if (fehlend.length) eintraege.push(...fehlend.map((x) => ({ ...x, art: 'fehlt' })))
  }

  // ExifTool legt mit -overwrite_original keine Sicherungen an; wäre doch eine da, ist das ein Fehler
  const reste = []
  const suche = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) suche(join(d, e.name))
      else if (/_original$|\.tmp$/.test(e.name)) reste.push(join(d, e.name))
    }
  }
  suche(ziel)
  if (reste.length) throw new Error(`Nebenprodukte im Testordner: ${reste.join(', ')}`)

  const manifest = {
    hinweis: 'Synthetische Testbibliothek (scripts/testbilder.mjs) – keine echten Fotos.',
    erzeugt: new Date().toISOString(),
    orte: ORTE,
    quadranten: QUADRANTEN,
    eintraege: eintraege.map((e) => JSON.parse(JSON.stringify(e)))
  }
  writeFileSync(join(ziel, 'testbilder.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8')
  return manifest
}

// nur als Programm ausführen, nicht beim Import (Labortest)
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const argv = process.argv.slice(2)
  const ziel = argv.find((a) => !a.startsWith('--'))
  if (!ziel) {
    console.error('Aufruf: node scripts/testbilder.mjs <zielordner> [--gross] [--ohne-videos]')
    process.exit(2)
  }
  const t0 = Date.now()
  erzeugeTestbilder(resolve(ziel), {
    gross: argv.includes('--gross'),
    videos: !argv.includes('--ohne-videos')
  }).then(
    (m) => {
      const zahl = (art) => m.eintraege.filter((e) => e.art === art).length
      console.log(
        `Testbibliothek in ${resolve(ziel)}: ${zahl('bild')} Bilder, ${zahl('video')} Videos, ` +
          `${zahl('defekt')} defekte Dateien (${((Date.now() - t0) / 1000).toFixed(1)} s)`
      )
      for (const e of m.eintraege.filter((x) => x.art === 'fehlt')) {
        console.log(`  – ${e.datei} fehlt: ${e.grund}`)
      }
    },
    (err) => {
      console.error(`Testbilder: ${err.message}`)
      process.exit(1)
    }
  )
}
