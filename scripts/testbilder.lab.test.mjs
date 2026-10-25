// Labortest der Testbibliothek (Skill bild-labor): erzeugt sie mit den gebündelten Werkzeugen und
// prüft mit sharp, ExifTool und ffprobe nach, dass jede Datei hält, was testbilder.json verspricht.
// Ohne gebündeltes ExifTool/ffmpeg (npm run exiftool:fetch / ffmpeg:fetch) übersprungen.

import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { erzeugeTestbilder, QUADRANTEN, werkzeug } from './testbilder.mjs'

const exiftool = werkzeug('exiftool')
const ffprobe = werkzeug('ffprobe')
const bereit = Boolean(exiftool && ffprobe && werkzeug('ffmpeg'))

/** ExifTool-JSON für viele Dateien in einem Lauf (Pfade im UTF-8-Argumentfile). */
function exifJson(dateien, extra = []) {
  const argfile = join(tmpdir(), `galeria-lab-${process.pid}.args`)
  writeFileSync(argfile, dateien.join('\n') + '\n', 'utf8')
  try {
    const r = spawnSync(
      exiftool,
      ['-charset', 'filename=utf8', '-json', '-n', ...extra, '-@', argfile],
      { encoding: 'utf8', timeout: 60_000 }
    )
    if (r.error) throw r.error
    return JSON.parse(r.stdout || '[]')
  } finally {
    rmSync(argfile, { force: true })
  }
}

function probe(datei) {
  const r = spawnSync(
    ffprobe,
    ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', `file:${datei}`],
    { encoding: 'utf8', timeout: 30_000 }
  )
  if (r.status !== 0) throw new Error(r.stderr)
  return JSON.parse(r.stdout)
}

describe.skipIf(!bereit)('Testbibliothek (Labor)', () => {
  let ziel
  let manifest
  const pfad = (datei) => join(ziel, ...datei.split('/'))
  const art = (a) => manifest.eintraege.filter((e) => e.art === a)

  beforeAll(async () => {
    // Befund: libvips hält gelesene Dateien im Cache offen – unter Windows lassen sie sich dann
    // nicht löschen oder umbenennen (hier: der Temp-Ordner; in der App: Bilder des Nutzers)
    sharp.cache({ files: 0 })
    ziel = join(mkdtempSync(join(tmpdir(), 'galeria-lab-')), 'bib')
    manifest = await erzeugeTestbilder(ziel)
  }, 120_000)

  afterAll(() => {
    if (ziel) rmSync(join(ziel, '..'), { recursive: true, force: true, maxRetries: 5 })
  })

  it('jede Datei aus dem Manifest liegt da, und nur diese (plus testbilder.json)', () => {
    const liste = []
    const suche = (d, rel) => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const r = rel ? `${rel}/${e.name}` : e.name
        if (e.isDirectory()) suche(join(d, e.name), r)
        else liste.push(r)
      }
    }
    suche(ziel, '')
    const erwartet = manifest.eintraege.filter((e) => e.art !== 'fehlt').map((e) => e.datei)
    expect(liste.sort()).toEqual([...erwartet, 'testbilder.json'].sort())
    // nur Optionales darf fehlen (HEVC ohne Encoder auf dem Rechner)
    expect(art('fehlt').map((e) => e.datei)).toEqual(art('fehlt').length ? ['videos/hevc.mov'] : [])
  })

  it('Ausrichtung 1–8: aufgerichtet liegt das Motiv richtig (sharp .rotate())', async () => {
    const tags = exifJson(
      art('bild')
        .filter((e) => e.ausrichtung)
        .map((e) => pfad(e.datei))
    )
    for (let n = 1; n <= 8; n++) {
      const e = manifest.eintraege.find((x) => x.ausrichtung === n)
      const { data, info } = await sharp(pfad(e.datei))
        .rotate()
        .raw()
        .toBuffer({ resolveWithObject: true })
      expect([info.width, info.height], `Ausrichtung ${n}`).toEqual([e.breite, e.hoehe])
      const farbe = (x, y) => [
        ...data.subarray((y * info.width + x) * 3, (y * info.width + x) * 3 + 3)
      ]
      const nah = (ist, soll) => ist.every((v, i) => Math.abs(v - soll[i]) <= 30)
      const w = info.width
      const h = info.height
      const proben = {
        obenLinks: farbe(w / 4, h / 4),
        obenRechts: farbe((3 * w) / 4, h / 4),
        untenLinks: farbe(w / 4, (3 * h) / 4),
        untenRechts: farbe((3 * w) / 4, (3 * h) / 4)
      }
      for (const [ecke, ist] of Object.entries(proben)) {
        expect(nah(ist, QUADRANTEN[ecke]), `Ausrichtung ${n}, ${ecke}: ${ist}`).toBe(true)
      }
      expect(tags.find((t) => t.SourceFile.endsWith(`ausrichtung-${n}.jpg`)).Orientation).toBe(n)
    }
  })

  it('Metadaten stehen so in den Dateien, wie das Manifest sagt (auch mit Umlauten und Emoji)', () => {
    const mitMeta = art('bild').filter((e) => e.aufnahme || e.gps || e.titel || e.stichwoerter)
    const tags = exifJson(mitMeta.map((e) => pfad(e.datei)))
    expect(tags).toHaveLength(mitMeta.length)
    for (const e of mitMeta) {
      const t = tags.find((x) => x.SourceFile.endsWith(e.datei.split('/').pop()))
      expect(t, e.datei).toBeDefined()
      if (e.aufnahme) {
        expect(t.DateTimeOriginal, e.datei).toBe(
          e.aufnahme.lokal.replace('T', ' ').replace(/-/g, ':')
        )
        expect(t.OffsetTimeOriginal, e.datei).toBe(e.aufnahme.offset)
      }
      if (e.gps) {
        expect(t.GPSLatitude, e.datei).toBeCloseTo(e.gps.lat, 4)
        expect(t.GPSLongitude, e.datei).toBeCloseTo(e.gps.lon, 4)
      } else {
        expect(t.GPSLatitude, e.datei).toBeUndefined()
      }
      if (e.kamera) expect(t.Model).toBe(e.kamera.modell)
      if (e.bewertung !== undefined) expect(t.Rating).toBe(e.bewertung)
      if (e.titel) expect(t.Title).toBe(e.titel)
      if (e.stichwoerter) expect([t.Subject].flat()).toEqual(e.stichwoerter)
    }
  })

  it('Formate: sharp erkennt Format, Maße, Farbraum, Tiefe und Einzelbilder', async () => {
    const formate = art('bild').filter((e) => e.datei.startsWith('formate/'))
    for (const e of formate) {
      const m = await sharp(pfad(e.datei), { animated: true }).metadata()
      // AVIF meldet sharp als „heif“ mit AV1-Kompression
      expect(m.format === 'heif' ? 'avif' : m.format, e.datei).toBe(e.format)
      expect([m.width, m.pageHeight ?? m.height], e.datei).toEqual([e.breite, e.hoehe])
      if (e.bilder) expect(m.pages, e.datei).toBe(e.bilder)
      if (e.farbraum === 'cmyk') expect(m.space).toBe('cmyk')
      if (e.farbraum === 'p3') expect(m.icc, e.datei).toBeDefined()
      if (e.datei.endsWith('16bit.png')) expect(m.depth).toBe('ushort')
    }
  })

  it('Kaputte Dateien: sharp lehnt alle ab; ExifTool allein erkennt nicht jede', async () => {
    expect(statSync(pfad('defekt/leer.jpg')).size).toBe(0)
    for (const e of art('defekt')) {
      await expect(
        sharp(pfad(e.datei), { failOn: 'truncated' }).raw().toBuffer(),
        e.datei
      ).rejects.toThrow()
    }
    const t0 = Date.now()
    const tags = exifJson(art('defekt').map((e) => pfad(e.datei)))
    expect(Date.now() - t0).toBeLessThan(30_000)
    const von = (name) => tags.find((t) => t.FileName === name)
    expect(von('leer.jpg').Error).toBe('File is empty')
    expect(von('exif-laenge.jpg').Warning).toMatch(/format error/i)
    // Befund: ExifTool liest nur den Kopf – ein abgeschnittenes JPEG sieht für ExifTool gesund
    // aus, und der Typ kommt aus dem Inhalt, nicht aus der Endung. „Defekt“ entscheidet sharp.
    expect(von('abgeschnitten.jpg').Error ?? von('abgeschnitten.jpg').Warning).toBeUndefined()
    expect(von('kein-bild.png').FileType).toBe('TXT')
  })

  it('Videos: Dauer, Maße, Drehung, Ton; Handy-MOV mit Zeitzone und GPS', () => {
    for (const e of art('video')) {
      const p = probe(pfad(e.datei))
      const video = p.streams.find((s) => s.codec_type === 'video')
      const dauerMs = Number(p.format.duration) * 1000
      expect(Math.abs(dauerMs - e.dauerMs), `${e.datei}: ${dauerMs} ms`).toBeLessThan(150)
      const roh = e.roh ?? { breite: e.breite, hoehe: e.hoehe }
      expect([video.width, video.height], e.datei).toEqual([roh.breite, roh.hoehe])
      expect(
        p.streams.some((s) => s.codec_type === 'audio'),
        e.datei
      ).toBe(e.ton)
      const drehung = (video.side_data_list ?? []).find((d) => d.rotation !== undefined)?.rotation
      expect(Math.abs(drehung ?? 0), e.datei).toBe(e.drehung ?? 0)
    }
    const [handy] = exifJson([pfad('videos/handy.mov')])
    expect(handy.CreationDate).toBe('2024:08:01 10:00:00+02:00')
    expect(handy.CreateDate).toBe('2024:08:01 08:00:00')
    expect(String(handy.GPSCoordinates)).toMatch(/^48\.1374 11\.5755/)
  })

  it('Ohne Werkzeug oder in einen vollen Ordner: klare Meldung statt halber Bibliothek', async () => {
    await expect(erzeugeTestbilder(ziel)).rejects.toThrow(/nicht leer/)
    expect(existsSync(join(ziel, 'testbilder.json'))).toBe(true)
  })
})
