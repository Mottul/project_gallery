// Labortest mit dem gebündelten ExifTool: der ganze Schreibweg an echten Dateien (ohne Electron).
import { createHash } from 'node:crypto'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { grundfelderAus } from '@shared/grundfelder'
import {
  abweichend,
  alteWerte,
  tagsFuer,
  werteAus,
  WERTE_TAGS,
  type MetaAenderung
} from '@shared/metaFields'
import { zwischenName } from '@shared/scanRegeln'
import { ExifToolPool, leseTags } from '../exiftool/exiftool'
import type { SchreibErgebnis } from './protokoll'
import { bildKennung, schreibe } from './schreiben'

const BIN = join(
  process.cwd(),
  'resources',
  'exiftool',
  process.platform === 'win32' ? 'win' : 'linux',
  process.platform === 'win32' ? 'exiftool.exe' : 'exiftool'
)

const pixel = async (p: string): Promise<string> => {
  const { data } = await sharp(p, { animated: true }).raw().toBuffer({ resolveWithObject: true })
  return createHash('sha256').update(data).digest('hex')
}
const inhalt = (p: string): string => createHash('sha256').update(readFileSync(p)).digest('hex')

describe.skipIf(!existsSync(BIN))('Schreibweg (Labor)', () => {
  let dir: string
  let pool: ExifToolPool
  let nr = 0

  const bild = () =>
    sharp({ create: { width: 64, height: 48, channels: 3, background: { r: 40, g: 120, b: 200 } } })
  const FORMATE: Record<string, (p: string) => Promise<unknown>> = {
    jpeg: (p) => bild().jpeg().toFile(p),
    png: (p) => bild().png().toFile(p),
    webp: (p) => bild().webp().toFile(p),
    gif: (p) => bild().gif().toFile(p),
    avif: (p) => bild().avif().toFile(p),
    tiff: (p) => bild().tiff().toFile(p)
  }
  const ENDUNG: Record<string, string> = { jpeg: 'jpg', tiff: 'tif' }

  async function neu(format = 'jpeg', name?: string): Promise<string> {
    const p = join(dir, name ?? `b${++nr}.${ENDUNG[format] ?? format}`)
    await FORMATE[format](p)
    return p
  }
  const datei = (p: string) => {
    const st = statSync(p)
    return { pfad: p, ordner: dir, size: st.size, mtime: Math.trunc(st.mtimeMs) }
  }
  const schreiben = (
    p: string,
    a: MetaAenderung,
    format = 'jpeg',
    sicherung: string | null = null
  ): Promise<SchreibErgebnis> =>
    schreibe(
      {
        datei: datei(p),
        tags: tagsFuer(a, format),
        sicherung,
        zwischen: zwischenName(p, ++nr)
      },
      pool
    )
  const lesen = async (p: string, a: MetaAenderung, format = 'jpeg') => {
    const tags = tagsFuer(a, format)
    const r = await leseTags(
      pool,
      [p],
      tags.map((t) => `-${t.tag}`)
    )
    return r.get(p) as Record<string, unknown>
  }
  const reste = (): string[] => readdirSync(dir).filter((n) => n.includes('galerie-tmp'))

  beforeAll(() => {
    sharp.cache({ files: 0 })
    dir = mkdtempSync(join(tmpdir(), 'galeria-schreiben-'))
    pool = new ExifToolPool(BIN, 2)
  })
  afterAll(() => {
    pool.beenden()
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  })

  const VOLL = {
    bewertung: 4,
    farblabel: 'Red',
    titel: 'Süden 🌞 "x" \\ #1',
    beschreibung: 'erste Zeile\nzweite Zeile mit ä',
    stichwoerter: ['Meer', 'Süden 🌞', 'Familie'],
    aufnahme: { lokal: '2021-06-05T14:03:02', offset: '+02:00' },
    standort: { breite: -33.8568, laenge: 151.2153 },
    ort: 'Köln',
    region: 'Nordrhein-Westfalen',
    land: 'Deutschland',
    ortsteil: 'Altstadt',
    urheber: 'Testperson Ä',
    copyright: '© 2021 Testperson'
  } satisfies MetaAenderung

  it.each(Object.keys(FORMATE))(
    '%s: Werte stehen drin, Pixel gleich, kein Rest',
    async (format) => {
      const p = await neu(format)
      const pix = await pixel(p)
      const kennung = await bildKennung(pool, p)
      const r = await schreiben(p, VOLL, format)
      expect(r).toMatchObject({ ok: true })
      expect(abweichend(tagsFuer(VOLL, format), await lesen(p, VOLL, format))).toEqual([])
      expect(await pixel(p)).toBe(pix)
      expect(await bildKennung(pool, p)).toBe(kennung)
      expect(reste()).toEqual([])
      // die frisch gelesenen Grundfelder kommen gleich mit
      if (r.ok) {
        expect(r.roh?.['XMP:Rating']).toBe(4)
        expect(r.size).toBe(statSync(p).size)
      }
    }
  )

  it.each(Object.keys(FORMATE))(
    '%s: Was hineinging, kommt als dieselben Felder heraus',
    async (f) => {
      const p = await neu(f)
      expect(await schreiben(p, VOLL, f)).toMatchObject({ ok: true })
      const r = await leseTags(
        pool,
        [p],
        WERTE_TAGS.map((t) => `-${t.tag}`)
      )
      expect(werteAus(r.get(p) as Record<string, unknown>)).toEqual(VOLL)
    }
  )

  it.each(Object.keys(FORMATE))('%s: Der Index liest dasselbe', async (f) => {
    const p = await neu(f)
    const r = await schreiben(p, VOLL, f)
    if (!r.ok) throw new Error(r.code)
    const g = grundfelderAus(r.roh, { btime: null, mtime: r.mtime })
    expect(g.bewertung).toBe(4)
    expect(g.stichwoerter).toEqual(VOLL.stichwoerter)
    expect(g.aufnahme.lokal).toBe(VOLL.aufnahme.lokal)
    expect(g.aufnahme.offset).toBe(VOLL.aufnahme.offset)
    expect(g.gps?.breite).toBeCloseTo(VOLL.standort.breite, 5)
    expect(g.gps?.laenge).toBeCloseTo(VOLL.standort.laenge, 5)
    expect(g.ortMeta?.name).toBe('Köln')
  })

  it('Standort entfernen: kein GPS-Tag bleibt, auch keiner, den die App nicht zeigt', async () => {
    const p = await neu()
    await schreibe(
      {
        datei: datei(p),
        tags: [
          { tag: 'EXIF:GPSLatitude', wert: 42.65 },
          { tag: 'EXIF:GPSLatitudeRef', wert: 'N' },
          { tag: 'EXIF:GPSLongitude', wert: 18.09 },
          { tag: 'EXIF:GPSLongitudeRef', wert: 'E' },
          { tag: 'EXIF:GPSAltitude', wert: 12 },
          { tag: 'EXIF:GPSImgDirection', wert: 90 },
          { tag: 'EXIF:GPSDateStamp', wert: '2021:06:05' },
          { tag: 'XMP-exif:GPSLatitude', wert: 42.65 },
          { tag: 'XMP-exif:GPSLongitude', wert: 18.09 }
        ],
        sicherung: null,
        zwischen: zwischenName(p, ++nr)
      },
      pool
    )
    const pix = await pixel(p)
    const alles = await pool.ausfuehren(['-json', '-n', '-G0', '-a', p])
    expect(alles.ausgabe).toContain('GPSImgDirection')
    expect(await schreiben(p, { standort: null })).toMatchObject({ ok: true })
    const danach = await pool.ausfuehren(['-json', '-n', '-G0', '-a', p])
    expect(danach.ausgabe).not.toMatch(/GPS/)
    expect(await pixel(p)).toBe(pix)
  })

  it('Rückgängig bringt Listen und GPS zurück', async () => {
    const p = await neu()
    await schreiben(p, { stichwoerter: ['alt', 'älter'], standort: { breite: 1.5, laenge: 2.5 } })
    const a: MetaAenderung = { stichwoerter: ['neu'], standort: null }
    const vorher = alteWerte(tagsFuer(a, 'jpeg'), await lesen(p, a))
    expect(await schreiben(p, a)).toMatchObject({ ok: true })
    const r = await schreibe(
      { datei: datei(p), tags: vorher, sicherung: null, zwischen: zwischenName(p, ++nr) },
      pool
    )
    expect(r).toMatchObject({ ok: true })
    if (!r.ok) return
    const g = grundfelderAus(r.roh, { btime: null, mtime: r.mtime })
    expect(g.stichwoerter).toEqual(['alt', 'älter'])
    expect(g.gps?.breite).toBeCloseTo(1.5, 5)
    expect(g.gps?.laenge).toBeCloseTo(2.5, 5)
  })

  it('Stichwörter ersetzen: Entfernte verschwinden aus XMP, IPTC und Windows', async () => {
    const p = await neu()
    await schreiben(p, { stichwoerter: ['weg', 'bleibt'] })
    await schreiben(p, { stichwoerter: ['bleibt'] })
    const ist = await lesen(p, { stichwoerter: ['x'] })
    expect(ist['XMP:Subject']).toBe('bleibt')
    expect(ist['IPTC:Keywords']).toBe('bleibt')
    expect(ist['EXIF:XPKeywords']).toBe('bleibt')
    expect(await schreiben(p, { stichwoerter: [] })).toMatchObject({ ok: true })
    expect(await lesen(p, { stichwoerter: ['x'] })).toEqual({ SourceFile: p.replaceAll('\\', '/') })
  })

  it('Datum ohne Zone und alte Sekundenbruchteile', async () => {
    const p = await neu()
    await schreibe(
      {
        datei: datei(p),
        tags: [
          { tag: 'EXIF:DateTimeOriginal', wert: '2020:01:02 03:04:05' },
          { tag: 'EXIF:SubSecTimeOriginal', wert: '123' },
          { tag: 'EXIF:OffsetTimeOriginal', wert: '+05:00' }
        ],
        sicherung: null,
        zwischen: zwischenName(p, ++nr)
      },
      pool
    )
    const r = await schreiben(p, { aufnahme: { lokal: '2021-06-05T14:03:02', offset: null } })
    if (!r.ok) throw new Error(r.code)
    const g = grundfelderAus(r.roh, { btime: null, mtime: r.mtime })
    expect(g.aufnahme.lokal).toBe('2021-06-05T14:03:02')
    expect(g.aufnahme.offset).toBeNull()
    expect(g.aufnahme.quelle).toBe('exif')
  })

  it('der Zeilenumbruch bleibt Text: kein zweites Argument, nichts gelöscht', async () => {
    const p = await neu()
    const opfer = await neu()
    const a = { beschreibung: `x\n-delete_original!\n-XMP-dc:Title=eingeschleust\n${opfer}` }
    expect(await schreiben(p, a)).toMatchObject({ ok: true })
    const ist = await lesen(p, { ...a, titel: 'y' })
    expect(ist['XMP:Description']).toBe(a.beschreibung)
    expect(ist['XMP:Title']).toBeUndefined()
    expect(existsSync(opfer)).toBe(true)
  })

  it('Umlaute auch in IPTC', async () => {
    const p = await neu()
    await schreiben(p, { titel: 'Fähre in Köln' })
    expect((await lesen(p, { titel: 'x' }))['IPTC:ObjectName']).toBe('Fähre in Köln')
  })

  it('ein zu langer Titel steht vollständig in XMP und EXIF', async () => {
    const p = await neu()
    const titel = 'ä'.repeat(100)
    expect(await schreiben(p, { titel })).toMatchObject({ ok: true })
    const ist = await lesen(p, { titel })
    expect(ist['XMP:Title']).toBe(titel)
    expect(ist['IPTC:ObjectName']).toBeUndefined()
  })

  it('Rückgängig mit den alten Werten stellt den Stand her – auch bei abweichenden Tags', async () => {
    const p = await neu()
    await schreiben(p, { titel: 'alt', bewertung: 2 })
    // ein Tag weicht ab, wie es von anderen Programmen vorkommt
    await schreibe(
      {
        datei: datei(p),
        tags: [{ tag: 'EXIF:XPTitle', wert: 'anders' }],
        sicherung: null,
        zwischen: zwischenName(p, ++nr)
      },
      pool
    )
    const pix = await pixel(p)
    const aenderung: MetaAenderung = { titel: 'neu', bewertung: 5, farblabel: 'Blue' }
    const tags = tagsFuer(aenderung, 'jpeg')
    const vorher = alteWerte(tags, await lesen(p, aenderung))
    expect(await schreiben(p, aenderung)).toMatchObject({ ok: true })
    const r = await schreibe(
      { datei: datei(p), tags: vorher, sicherung: null, zwischen: zwischenName(p, ++nr) },
      pool
    )
    expect(r).toMatchObject({ ok: true })
    const ist = await lesen(p, aenderung)
    expect(ist['XMP:Title']).toBe('alt')
    expect(ist['EXIF:XPTitle']).toBe('anders')
    expect(ist['XMP:Rating']).toBe(2)
    expect(ist['XMP:Label']).toBeUndefined()
    expect(await pixel(p)).toBe(pix)
  })

  it('Sicherung: das Original vor der Änderung, bytegleich; eine vorhandene bleibt', async () => {
    const p = await neu()
    const vorher = inhalt(p)
    const s = join(dir, 'sicherung', 'unter', 'a.jpg')
    expect(await schreiben(p, { bewertung: 3 }, 'jpeg', s)).toMatchObject({ ok: true })
    expect(inhalt(s)).toBe(vorher)
    expect(inhalt(p)).not.toBe(vorher)
    // gleicher Name noch einmal: nichts überschrieben, Schreiben geht trotzdem
    expect(await schreiben(p, { bewertung: 1 }, 'jpeg', s)).toMatchObject({ ok: true })
    expect(inhalt(s)).toBe(vorher)
  })

  it('Datei inzwischen geändert: nichts geschieht', async () => {
    const p = await neu()
    const d = { ...datei(p), size: 1 }
    const r = await schreibe(
      {
        datei: d,
        tags: tagsFuer({ bewertung: 3 }, 'jpeg'),
        sicherung: null,
        zwischen: zwischenName(p, ++nr)
      },
      pool
    )
    expect(r).toEqual({ ok: false, code: 'GEAENDERT' })
    expect(reste()).toEqual([])
  })

  it('schreibgeschützt: abgelehnt, unverändert', async () => {
    const p = await neu()
    const vorher = inhalt(p)
    chmodSync(p, 0o444)
    expect(await schreiben(p, { bewertung: 3 })).toEqual({ ok: false, code: 'SCHREIBGESCHUETZT' })
    chmodSync(p, 0o666)
    expect(inhalt(p)).toBe(vorher)
  })

  it('außerhalb des Ordners: abgelehnt', async () => {
    const p = await neu()
    const r = await schreibe(
      {
        datei: { ...datei(p), ordner: join(dir, 'anderer') },
        tags: tagsFuer({ bewertung: 3 }, 'jpeg'),
        sicherung: null,
        zwischen: zwischenName(p, ++nr)
      },
      pool
    )
    expect(r.ok).toBe(false)
  })

  it('kaputte Datei: abgelehnt, unverändert, kein Rest', async () => {
    const p = join(dir, 'kaputt.jpg')
    writeFileSync(p, Buffer.from('kein Bild'))
    const vorher = inhalt(p)
    expect((await schreiben(p, { bewertung: 3 })).ok).toBe(false)
    expect(inhalt(p)).toBe(vorher)
    expect(reste()).toEqual([])
  })

  it('die Kennung der Bilddaten trennt Pixel von Metadaten – auch ohne ImageDataHash', async () => {
    for (const format of ['jpeg', 'png', 'gif', 'tiff']) {
      const a = await neu(format)
      const b = await neu(format)
      expect(await bildKennung(pool, a), format).toBe(await bildKennung(pool, b))
      await schreiben(a, { bewertung: 3 }, format)
      expect(await bildKennung(pool, a), format).toBe(await bildKennung(pool, b))
      const anders = join(dir, `anders${++nr}.${ENDUNG[format] ?? format}`)
      const c = sharp({
        create: { width: 64, height: 48, channels: 3, background: { r: 200, g: 40, b: 40 } }
      })
      await c.toFormat(format as 'jpeg').toFile(anders)
      expect(await bildKennung(pool, anders), format).not.toBe(await bildKennung(pool, b))
    }
  })

  it('Pfad über 260 Zeichen: geschrieben oder sauber abgelehnt, nie halb', async () => {
    const tief = join(dir, ...Array.from({ length: 8 }, (_, i) => `${i}-${'o'.repeat(40)}`))
    mkdirSync(tief, { recursive: true })
    const p = join(tief, 'lang.jpg')
    renameSync(await neu(), p)
    expect(p.length).toBeGreaterThan(260)
    const vorher = inhalt(p)
    const r = await schreiben(p, { bewertung: 3 })
    console.log('  Pfad', p.length, 'Zeichen:', JSON.stringify({ ...r, roh: undefined }))
    if (!r.ok) expect(inhalt(p)).toBe(vorher)
    expect(readdirSync(tief)).toEqual(['lang.jpg'])
  })

  it('Unicode-Namen und Namen mit führendem Strich', async () => {
    for (const name of ['Süden 🌞.jpg', '-rf.jpg']) {
      const p = await neu('jpeg', name)
      expect(await schreiben(p, { bewertung: 2 })).toMatchObject({ ok: true })
    }
  })
})
