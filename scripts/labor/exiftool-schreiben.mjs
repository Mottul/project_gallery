// Labor (Skill bild-labor, Phase 3): Schreiben mit dem gebündelten ExifTool messen, bevor der
// Schreibweg feststeht. Je Format: Was lässt sich schreiben, was kommt beim Lesen wieder heraus,
// bleiben die Pixel gleich, was sieht der Windows-Explorer? Dazu: Zeilenumbruch im Wert (#[CSTR]),
// Schreiben in eine Nachbardatei (-o) und Dateizeiten nach dem Ersetzen. Nur synthetische Dateien.
//
// Aufruf: node scripts/labor/exiftool-schreiben.mjs   (vorher npm run exiftool:fetch)

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  chmodSync,
  copyFileSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { werkzeug } from '../testbilder.mjs'

sharp.cache({ files: 0 })
const EXIFTOOL = werkzeug('exiftool')
if (!EXIFTOOL) throw new Error('ExifTool fehlt – zuerst npm run exiftool:fetch')
const ORDNER = mkdtempSync(join(tmpdir(), 'galeria-labor-schreiben-'))

/** Ein Aufruf mit Argumenten über stdin – wie der Betrieb im Wrapper, Argument je Zeile */
function et(args) {
  const r = spawnSync(EXIFTOOL, ['-charset', 'filename=utf8', '-@', '-'], {
    input: args.join('\n') + '\n',
    encoding: 'utf8',
    windowsHide: true
  })
  return { aus: r.stdout, err: r.stderr, code: r.status }
}

const roh = async (p) => {
  const { data, info } = await sharp(p, { animated: false })
    .raw()
    .toBuffer({ resolveWithObject: true })
  return (
    `${info.width}x${info.height}:` + createHash('sha256').update(data).digest('hex').slice(0, 12)
  )
}

const FELDER = [
  '-use',
  'MWG',
  '-XMP-dc:Title=Titel Ä',
  '-IPTC:ObjectName=Titel Ä',
  '-EXIF:XPTitle=Titel Ä',
  '-MWG:Description=Beschreibung Ö',
  '-MWG:Keywords=Meer',
  '-MWG:Keywords=Süden',
  '-EXIF:XPKeywords=Meer;Süden',
  '-EXIF:XPComment=Beschreibung Ö',
  '-XMP-xmp:Rating=4',
  '-EXIF:Rating=4',
  '-EXIF:RatingPercent=75',
  '-XMP-xmp:Label=Red',
  '-EXIF:DateTimeOriginal=2021:06:05 14:03:02',
  '-EXIF:CreateDate=2021:06:05 14:03:02',
  '-EXIF:OffsetTimeOriginal=+02:00',
  '-XMP-photoshop:DateCreated=2021:06:05 14:03:02+02:00',
  '-EXIF:GPSLatitude=42.65',
  '-EXIF:GPSLatitudeRef=N',
  '-EXIF:GPSLongitude=18.09',
  '-EXIF:GPSLongitudeRef=E',
  '-MWG:City=Dubrovnik',
  '-MWG:Country=Kroatien',
  '-MWG:Creator=Testperson',
  '-MWG:Copyright=(c) Testperson',
  '-Orientation#=6'
]
const LESEN = [
  '-json',
  '-n',
  '-G0',
  '-XMP:Title',
  '-IPTC:ObjectName',
  '-EXIF:XPTitle',
  '-XMP:Description',
  '-IPTC:Caption-Abstract',
  '-EXIF:ImageDescription',
  '-XMP:Subject',
  '-IPTC:Keywords',
  '-EXIF:XPKeywords',
  '-XMP:Rating',
  '-EXIF:Rating',
  '-EXIF:RatingPercent',
  '-XMP:Label',
  '-EXIF:DateTimeOriginal',
  '-EXIF:OffsetTimeOriginal',
  '-XMP:DateCreated',
  '-Composite:GPSLatitude',
  '-Composite:GPSLongitude',
  '-XMP:City',
  '-XMP:Country',
  '-XMP:Creator',
  '-EXIF:Artist',
  '-EXIF:Copyright',
  '-EXIF:Orientation'
]

const bild = () =>
  sharp({ create: { width: 640, height: 480, channels: 3, background: { r: 40, g: 120, b: 200 } } })

const FORMATE = {
  jpg: (p) => bild().jpeg().toFile(p),
  png: (p) => bild().png().toFile(p),
  webp: (p) => bild().webp().toFile(p),
  gif: (p) => bild().gif().toFile(p),
  avif: (p) => bild().avif().toFile(p),
  tif: (p) => bild().tiff().toFile(p)
}

console.log('ExifTool', et(['-ver']).aus.trim())
const ergebnis = {}
for (const [ext, machen] of Object.entries(FORMATE)) {
  const p = join(ORDNER, `quelle.${ext}`)
  await machen(p)
  const ziel = join(ORDNER, `ziel.${ext}`)
  const hashArgs = ['-api', 'ImageHashType=SHA256', '-ImageDataHash', '-s3']
  const h0 = et([...hashArgs, p])
    .aus.trim()
    .slice(0, 12)
  const pix0 = await roh(p)
  const t0 = performance.now()
  const r = et(['-o', ziel, ...FELDER, p])
  const ms = performance.now() - t0
  const lesen = r.err.match(/Error|Warning/) ? r.err.trim().split('\n').slice(0, 4) : []
  let gelesen = null
  let pix1 = null
  let h1 = null
  try {
    gelesen = JSON.parse(et([...LESEN, ziel]).aus)[0]
    pix1 = await roh(ziel)
    h1 = et([...hashArgs, ziel])
      .aus.trim()
      .slice(0, 12)
  } catch (e) {
    gelesen = { fehler: String(e).slice(0, 80) }
  }
  delete gelesen?.SourceFile
  ergebnis[ext] = { ms: Math.round(ms), aus: r.aus.trim(), meldungen: lesen, gelesen }
  console.log(`\n── ${ext}: ${Math.round(ms)} ms  ${r.aus.trim().replace(/\s+/g, ' ')}`)
  if (lesen.length) console.log('   ', lesen.join(' | ').slice(0, 300))
  console.log(
    '    Pixel gleich:',
    pix0 === pix1,
    ' ImageDataHash gleich:',
    h0 !== '' && h0 === h1,
    `(${h0 || 'keiner'})`
  )
  console.log(
    '   ',
    Object.keys(gelesen ?? {}).length,
    'Tags:',
    Object.keys(gelesen ?? {})
      .map((k) => k.replace(/^[^:]+:/, ''))
      .join(' ')
  )
}

// Explorer: Was zeigt das Eigenschaftssystem von Windows?
if (process.platform === 'win32') {
  const felder = [
    'System.Title',
    'System.Comment',
    'System.Keywords',
    'System.Rating',
    'System.Photo.DateTaken',
    'System.Author',
    'System.Copyright'
  ]
  const ps1 = join(ORDNER, 'lesen.ps1')
  writeFileSync(
    ps1,
    `$s = New-Object -ComObject Shell.Application
$o = $s.Namespace('${ORDNER}')
foreach ($d in $o.Items()) {
  if ($d.Name -notlike 'ziel.*') { continue }
  $z = $d.Name
  foreach ($f in ${felder.map((f) => `'${f}'`).join(',')}) {
    $w = $d.ExtendedProperty($f)
    if ($w -is [array]) { $w = $w -join ';' }
    $z += " | $($f.Replace('System.','').Replace('Photo.','')): $w"
  }
  Write-Output $z
}`,
    'utf8'
  )
  const r = spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ps1], {
    encoding: 'utf8'
  })
  console.log('\n── Explorer (Eigenschaftssystem)\n' + r.stdout + r.stderr.slice(0, 300))
}

// Zeilenumbruch und versuchte Argument-Einschleusung im Wert
{
  const p = join(ORDNER, 'zeile.jpg')
  await bild().jpeg().toFile(p)
  const opfer = join(ORDNER, 'opfer.jpg')
  await bild().jpeg().toFile(opfer)
  const wert = 'erste Zeile\\n-delete_original!\\n' + opfer.replaceAll('\\', '\\\\')
  const r = et(['-overwrite_original', `#[CSTR]-XMP-dc:Description=${wert}`, p])
  const g = JSON.parse(et(['-json', '-XMP:Description', p]).aus)[0]
  console.log(
    '\n── #[CSTR]:',
    r.aus.trim(),
    '| Wert:',
    JSON.stringify(g.Description ?? g['XMP:Description']),
    '| Opfer da:',
    statSync(opfer).size > 0
  )
  // ohne CSTR, roher Zeilenumbruch: der Rest würde zum Argument (Gegenprobe)
  const p2 = join(ORDNER, 'zeile2.jpg')
  await bild().jpeg().toFile(p2)
  const r2 = et([
    '-overwrite_original',
    '-XMP-dc:Description=erste\n-XMP-dc:Title=eingeschleust',
    p2
  ])
  console.log(
    '    roh:',
    r2.aus.trim(),
    JSON.stringify(JSON.parse(et(['-json', '-XMP:Title', p2]).aus)[0])
  )
}

// Dateizeiten: -overwrite_original gegen -o + Umbenennen
{
  const zeiten = (p) => {
    const s = statSync(p)
    return {
      erstellt: new Date(s.birthtimeMs).toISOString(),
      geaendert: new Date(s.mtimeMs).toISOString()
    }
  }
  const a = join(ORDNER, 'zeit-a.jpg')
  await bild().jpeg().toFile(a)
  const vor = zeiten(a)
  await new Promise((r) => setTimeout(r, 1200))
  et(['-overwrite_original', '-XMP-xmp:Rating=3', a])
  console.log('\n── -overwrite_original  vor', vor, 'nach', zeiten(a))

  const b = join(ORDNER, 'zeit-b.jpg')
  await bild().jpeg().toFile(b)
  const vorB = zeiten(b)
  await new Promise((r) => setTimeout(r, 1200))
  const tmp = join(ORDNER, '.zeit-b.jpg.galerie-tmp-1')
  const r = et(['-o', tmp, '-XMP-xmp:Rating=3', b])
  renameSync(tmp, b)
  console.log('── -o + Umbenennen     vor', vorB, 'nach', zeiten(b), r.aus.trim())

  const c = join(ORDNER, 'zeit-c.jpg')
  await bild().jpeg().toFile(c)
  const vorC = zeiten(c)
  await new Promise((r) => setTimeout(r, 1200))
  const tmp2 = join(ORDNER, '.zeit-c.jpg.galerie-tmp-1')
  const r2 = et(['-o', tmp2, '-P', '-XMP-xmp:Rating=3', c])
  renameSync(tmp2, c)
  console.log('── -o -P + Umbenennen  vor', vorC, 'nach', zeiten(c), r2.aus.trim())
}

// Schreibgeschützt: Was tun -overwrite_original und Umbenennen?
{
  const p = join(ORDNER, 'nur-lesen.jpg')
  await bild().jpeg().toFile(p)
  chmodSync(p, 0o444)
  const inhalt = createHash('sha256').update(readFileSync(p)).digest('hex')
  const r = et(['-overwrite_original', '-XMP-xmp:Rating=3', p])
  console.log(
    '\n── schreibgeschützt, -overwrite_original:',
    r.aus.trim(),
    '|',
    r.err.trim().slice(0, 120),
    '| geändert:',
    createHash('sha256').update(readFileSync(p)).digest('hex') !== inhalt
  )
  const tmp = join(ORDNER, '.nur-lesen.jpg.galerie-tmp-1')
  et(['-o', tmp, '-XMP-xmp:Rating=3', p])
  try {
    renameSync(tmp, p)
    console.log('    Umbenennen darüber: gelang')
  } catch (e) {
    console.log('    Umbenennen darüber:', e.code)
  }
  chmodSync(p, 0o666)
}

// Zeit je Schreibvorgang bei üblicher Dateigröße
{
  const p = join(ORDNER, 'gross.jpg')
  await sharp({
    create: {
      width: 6000,
      height: 4000,
      channels: 3,
      noise: { type: 'gaussian', mean: 120, sigma: 40 }
    }
  })
    .jpeg({ quality: 90 })
    .toFile(p)
  const mb = (statSync(p).size / 1e6).toFixed(1)
  const t0 = performance.now()
  et(['-o', join(ORDNER, 'gross2.jpg'), '-XMP-xmp:Rating=3', p])
  const t1 = performance.now()
  et(['-api', 'ImageHashType=SHA256', '-ImageDataHash', '-s3', p])
  const t2 = performance.now()
  await roh(p)
  const t3 = performance.now()
  copyFileSync(p, join(ORDNER, 'gross3.jpg'))
  const t4 = performance.now()
  console.log(
    `\n── ${mb} MB (24 MP): -o ${Math.round(t1 - t0)} ms (mit Kaltstart), ImageDataHash ${Math.round(t2 - t1)} ms (mit Kaltstart), sharp roh ${Math.round(t3 - t2)} ms, Kopie ${Math.round(t4 - t3)} ms`
  )
}

rmSync(ORDNER, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
