// Labortest der Vorschaubilder (Skill bild-labor) mit der synthetischen Testbibliothek und dem
// gebündelten ffmpeg: Größen, Ausrichtung pixelgenau, Farbraum (P3, CMYK) mit Gegenprobe,
// Transparenz, BMP, kaputte Dateien, Datei-Prüfung (Verknüpfung nach außen) und ffmpeg ohne Netz.
// Ohne ExifTool/ffmpeg (npm run exiftool:fetch / ffmpeg:fetch) übersprungen.

import { mkdirSync, mkdtempSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  BMP_FARBEN,
  erzeugeTestbilder,
  QUADRANTEN,
  werkzeug,
  type Eintrag,
  type Manifest,
  type Rgb
} from '../../../../scripts/testbilder.mjs'
import { pruefeDatei } from '../dateien/pruefeDatei'
import { ANZEIGE_MAX, bmpAlsPng, erzeugeAnzeige, erzeugeVorschau, type Vorschau } from './vorschau'

const ffmpeg = werkzeug('ffmpeg')
const bereit = Boolean(werkzeug('exiftool') && ffmpeg)

/** Pixel (x, y) eines dekodierten Bildes als RGB */
async function pixel(bild: Buffer, punkte: [number, number][]): Promise<Rgb[]> {
  const { data, info } = await sharp(bild)
    .removeAlpha()
    .toColourspace('srgb')
    .raw()
    .toBuffer({ resolveWithObject: true })
  return punkte.map(([fx, fy]) => {
    const o = (Math.floor(fy * info.height) * info.width + Math.floor(fx * info.width)) * 3
    return [data[o], data[o + 1], data[o + 2]]
  })
}
const nah = (ist: Rgb, soll: Rgb, tol: number): boolean =>
  ist.every((v, i) => Math.abs(v - soll[i]) <= tol)

describe.skipIf(!bereit)('Vorschaubilder (Labor)', () => {
  let basis: string
  let ziel: string
  let manifest: Manifest
  const pfad = (datei: string): string => join(ziel, ...datei.split('/'))
  const eintrag = (endung: string): Eintrag =>
    manifest.eintraege.find((e) => e.datei.endsWith(endung)) as Eintrag
  const vorschau = async (e: Eintrag): Promise<Vorschau> =>
    erzeugeVorschau(
      e.format === 'bmp'
        ? await bmpAlsPng(ffmpeg as string, pfad(e.datei))
        : await readFile(pfad(e.datei))
    )

  beforeAll(async () => {
    sharp.cache({ files: 0 })
    basis = mkdtempSync(join(tmpdir(), 'galeria-vorschau-'))
    ziel = join(basis, 'bib')
    manifest = await erzeugeTestbilder(ziel, { videos: false })
  }, 120_000)

  afterAll(() => {
    if (basis) rmSync(basis, { recursive: true, force: true, maxRetries: 5 })
  })

  it('jedes Bild: zwei Stufen, Seitenverhältnis wie aufgerichtet, Durchschnittsfarbe', async () => {
    for (const e of manifest.eintraege.filter((x) => x.art === 'bild')) {
      const v = await vorschau(e)
      const g = await sharp(v.gross).metadata()
      const k = await sharp(v.klein).metadata()
      const lang = Math.max(e.breite as number, e.hoehe as number)
      expect(Math.max(g.width, g.height), e.datei).toBe(Math.min(768, lang))
      expect(Math.max(k.width, k.height), e.datei).toBe(Math.min(256, lang))
      const soll = (e.breite as number) / (e.hoehe as number)
      expect(Math.abs(g.width / g.height - soll), e.datei).toBeLessThan(0.02)
      // mit Alpha-Kanal (PNG mit Transparenz, GIF) als WebP, damit Transparenz bleibt, sonst JPEG
      const quelle =
        e.format === 'bmp'
          ? null
          : await sharp(pfad(e.datei))
              .metadata()
              .catch(() => null)
      expect(g.format, e.datei).toBe(quelle?.hasAlpha ? 'webp' : 'jpeg')
      expect(v.farbe, e.datei).toMatch(/^#[0-9a-f]{6}$/)
    }
    expect((await sharp((await vorschau(eintrag('alpha.png'))).klein).metadata()).hasAlpha).toBe(
      true
    )
  })

  it('Ausrichtung 1–8: aufgerichtet liegt das Motiv richtig (pixelgenau, beide Stufen)', async () => {
    for (let n = 1; n <= 8; n++) {
      const v = await vorschau(eintrag(`ausrichtung-${n}.jpg`))
      for (const stufe of [v.gross, v.klein]) {
        const [ol, or, ul, ur] = await pixel(stufe, [
          [0.25, 0.25],
          [0.75, 0.25],
          [0.25, 0.75],
          [0.75, 0.75]
        ])
        expect(nah(ol, QUADRANTEN.obenLinks, 40), `${n} oben links ${ol}`).toBe(true)
        expect(nah(or, QUADRANTEN.obenRechts, 40), `${n} oben rechts ${or}`).toBe(true)
        expect(nah(ul, QUADRANTEN.untenLinks, 40), `${n} unten links ${ul}`).toBe(true)
        expect(nah(ur, QUADRANTEN.untenRechts, 40), `${n} unten rechts ${ur}`).toBe(true)
      }
    }
  })

  it('Display-P3: nach sRGB umgerechnet bleibt das Rot kräftig (Gegenprobe ohne Profil)', async () => {
    const e = eintrag('p3-rot.jpg')
    const [mitte] = await pixel((await vorschau(e)).klein, [[0.5, 0.5]])
    expect(nah(mitte, [255, 0, 0], 12), `Vorschau ${mitte}`).toBe(true)
    // Gegenprobe: die gespeicherten Werte ohne Profil gelesen sind deutlich blasser – ein
    // Verfahren, das das Profil wegwirft, fiele hier auf
    const roh = await sharp(pfad(e.datei), { ignoreIcc: true }).jpeg().toBuffer()
    const [ohne] = await pixel(roh, [[0.5, 0.5]])
    expect(nah(ohne, [255, 0, 0], 12), `ohne Profil ${ohne}`).toBe(false)
  })

  it('CMYK wird nach sRGB umgerechnet (Farbe nah am Original #e11d48)', async () => {
    const [mitte] = await pixel((await vorschau(eintrag('cmyk.jpg'))).klein, [[0.5, 0.5]])
    expect(nah(mitte, [225, 29, 72], 30), `${mitte}`).toBe(true)
  })

  it('Anzeige-Fassung (Betrachter): TIFF wird JPEG in voller Größe; Ausrichtung angewandt', async () => {
    const tif = await erzeugeAnzeige(await readFile(pfad(eintrag('bild.tif').datei)))
    const m = await sharp(tif).metadata()
    expect([m.format, m.width, m.height]).toEqual(['jpeg', 400, 300])
    const a6 = await erzeugeAnzeige(await readFile(pfad(eintrag('ausrichtung-6.jpg').datei)))
    const [ol, ur] = await pixel(a6, [
      [0.25, 0.25],
      [0.75, 0.75]
    ])
    expect((await sharp(a6).metadata()).width).toBe(300)
    expect(nah(ol, QUADRANTEN.obenLinks, 40), `${ol}`).toBe(true)
    expect(nah(ur, QUADRANTEN.untenRechts, 40), `${ur}`).toBe(true)
    // nie größer als bildschirmgroß
    const riesig = await erzeugeAnzeige(
      await sharp({ create: { width: 6000, height: 1000, channels: 3, background: '#888' } })
        .png()
        .toBuffer()
    )
    expect((await sharp(riesig).metadata()).width).toBe(ANZEIGE_MAX)
  })

  it('BMP per ffmpeg: richtig herum (oben/unten), Maße stimmen', async () => {
    const v = await vorschau(eintrag('bild.bmp'))
    const [oben, unten] = await pixel(v.klein, [
      [0.5, 0.2],
      [0.5, 0.8]
    ])
    expect(nah(oben, BMP_FARBEN.oben, 12), `oben ${oben}`).toBe(true)
    expect(nah(unten, BMP_FARBEN.unten, 12), `unten ${unten}`).toBe(true)
  })

  it('kaputte Dateien: sharp lehnt jede ab (→ defekt), auch die leere', async () => {
    for (const e of manifest.eintraege.filter((x) => x.art === 'defekt')) {
      await expect(erzeugeVorschau(await readFile(pfad(e.datei))), e.datei).rejects.toThrow()
    }
    // kein BMP: ffmpeg scheitert mit „defekt“, nicht mit Zeitlimit
    await expect(bmpAlsPng(ffmpeg as string, pfad('defekt/kein-bild.png'))).rejects.toMatchObject({
      code: 'DEFEKT'
    })
  })

  it('Datei-Prüfung: unverändert ok; geändert, Ordner statt Datei, Verknüpfung nach außen nicht', async () => {
    const e = eintrag('dubrovnik.jpg')
    const p = pfad(e.datei)
    const st = statSync(p)
    const mtime = Math.trunc(st.mtimeMs)
    await expect(pruefeDatei(p, ziel, st.size, mtime)).resolves.toBeUndefined()
    await expect(pruefeDatei(p, ziel, st.size + 1, mtime)).rejects.toMatchObject({
      code: 'GEAENDERT'
    })
    await expect(pruefeDatei(p, ziel, st.size, mtime + 1)).rejects.toMatchObject({
      code: 'GEAENDERT'
    })
    await expect(pruefeDatei(join(ziel, 'orte'), ziel, 0, 0)).rejects.toMatchObject({
      code: 'KEINE_DATEI'
    })
    await expect(pruefeDatei(join(ziel, 'weg.jpg'), ziel, 1, 1)).rejects.toMatchObject({
      code: 'ENOENT'
    })
    // Junction (Windows, ohne Adminrechte) bzw. Ordner-Symlink im Bibliotheksordner nach außen
    const aussen = join(basis, 'aussen')
    mkdirSync(aussen)
    writeFileSync(join(aussen, 'geheim.jpg'), await readFile(p))
    symlinkSync(aussen, join(ziel, 'verknuepft'), 'junction')
    const geheim = statSync(join(aussen, 'geheim.jpg'))
    await expect(
      pruefeDatei(
        join(ziel, 'verknuepft', 'geheim.jpg'),
        ziel,
        geheim.size,
        Math.trunc(geheim.mtimeMs)
      )
    ).rejects.toMatchObject({ code: 'AUSSERHALB' })
  })

  it('ffmpeg öffnet nur die Datei: eine „BMP“-Playlist zum Spion-Server bleibt ohne Anfrage', async () => {
    let anfragen = 0
    const spion = createServer((_req, res) => {
      anfragen++
      res.end('x')
    })
    await new Promise<void>((r) => spion.listen(0, '127.0.0.1', r))
    const port = (spion.address() as { port: number }).port
    try {
      const falle = join(basis, 'falle.bmp')
      writeFileSync(
        falle,
        `#EXTM3U\n#EXT-X-TARGETDURATION:1\n#EXTINF:1,\nhttp://127.0.0.1:${port}/x.bmp\n#EXT-X-ENDLIST\n`
      )
      await expect(bmpAlsPng(ffmpeg as string, falle)).rejects.toMatchObject({ code: 'DEFEKT' })
      // Gegenprobe: der Spion zählt, wenn man ihn anfragt
      await fetch(`http://127.0.0.1:${port}/gegenprobe`)
      expect(anfragen).toBe(1)
    } finally {
      spion.close()
    }
  })
})
