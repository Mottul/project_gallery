// Labortest mit dem gebündelten ExifTool (npm run exiftool:fetch); ohne es übersprungen.
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { GRUNDFELD_TAGS } from '@shared/grundfelder'
import { ExifToolPool, ExifToolProzess, leseTags, pfadVergleich } from './exiftool'

const BIN = join(
  process.cwd(),
  'resources',
  'exiftool',
  process.platform === 'win32' ? 'win' : 'linux',
  process.platform === 'win32' ? 'exiftool.exe' : 'exiftool'
)

describe.skipIf(!existsSync(BIN))('ExifTool im stay_open-Betrieb (Labor)', () => {
  let dir: string
  let pool: ExifToolPool
  const datei = (rel: string): string => join(dir, ...rel.split('/'))

  beforeAll(async () => {
    sharp.cache({ files: 0 })
    dir = mkdtempSync(join(tmpdir(), 'galeria-exif-'))
    mkdirSync(join(dir, 'namen'))
    for (const rel of ['a.jpg', 'namen/Sonne 🌞.jpg', 'namen/-rf.jpg']) {
      await sharp({ create: { width: 40, height: 30, channels: 3, background: '#4ade80' } })
        .jpeg()
        .toFile(datei(rel))
    }
    writeFileSync(datei('leer.jpg'), '')
    pool = new ExifToolPool(BIN, 2)
    const schreiber = new ExifToolProzess(BIN)
    const r = await schreiber.ausfuehren([
      '-overwrite_original',
      '-DateTimeOriginal=2024:07:14 18:30:05',
      '-OffsetTimeOriginal=+02:00',
      '-Orientation#=6',
      datei('namen/Sonne 🌞.jpg')
    ])
    expect(r.ausgabe).toMatch(/1 image files updated/)
    schreiber.beenden()
  }, 60_000)

  afterAll(() => {
    pool?.beenden()
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  })

  it('liest Grundfelder vieler Dateien – auch mit Emoji und führendem Bindestrich', async () => {
    const pfade = [
      'a.jpg',
      'namen/Sonne 🌞.jpg',
      'namen/-rf.jpg',
      'leer.jpg',
      'gibt-es-nicht.jpg'
    ].map(datei)
    const r = await leseTags(pool, pfade, GRUNDFELD_TAGS, 2)
    expect([...r.keys()]).toEqual(pfade)
    const sonne = r.get(datei('namen/Sonne 🌞.jpg'))
    expect(sonne).toMatchObject({
      'EXIF:DateTimeOriginal': '2024:07:14 18:30:05',
      'EXIF:OffsetTimeOriginal': '+02:00',
      'EXIF:Orientation': 6,
      'Composite:ImageSize': '40 30',
      'File:FileType': 'JPEG'
    })
    expect(r.get(datei('namen/-rf.jpg'))).toMatchObject({ 'File:FileType': 'JPEG' })
    expect(r.get(datei('leer.jpg'))).toMatchObject({ 'ExifTool:Error': 'File is empty' })
    // nicht gefunden: ExifTool liefert nichts – null
    expect(r.get(datei('gibt-es-nicht.jpg'))).toBeNull()
  })

  it('Zeitlimit: der Befehl scheitert, der nächste läuft mit neuem Prozess', async () => {
    const p = new ExifToolProzess(BIN)
    await expect(p.ausfuehren(['-ver'], 1)).rejects.toMatchObject({ code: 'ZEITLIMIT' })
    const r = await p.ausfuehren(['-ver'])
    expect(r.ausgabe.trim()).toMatch(/^\d+\.\d+$/)
    p.beenden()
  })

  it('lehnt Zeilenumbrüche in Argumenten ab (keine eingeschleusten Optionen)', async () => {
    const p = new ExifToolProzess(BIN)
    await expect(p.ausfuehren(['-Title=a\n-delete_original!'])).rejects.toThrow(/Zeilenumbruch/)
    p.beenden()
  })

  it('pfadVergleich passt ExifTool-Schreibweise und eigene zusammen', () => {
    expect(pfadVergleich('C:\\Bilder\\Sonne.jpg', true)).toBe(
      pfadVergleich('C:/bilder/SONNE.jpg', true)
    )
    expect(pfadVergleich('/home/x/A.jpg', false)).not.toBe(pfadVergleich('/home/x/a.jpg', false))
  })
})
