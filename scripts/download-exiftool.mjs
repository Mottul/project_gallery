// Lädt ExifTool (Metadaten lesen und schreiben) nach resources/exiftool/<win|linux>/ – nicht im
// Git, im Paket über extraResources (nur Windows). Linux braucht es für die Labortests der CI.
//
// Version und SHA-256 stehen FEST hier (wie ein Lockfile). Quelle ist die offizielle: Die
// Download-Links auf exiftool.org zeigen auf das ExifTool-Projekt bei SourceForge (dort bleiben
// auch ältere Versionen liegen), die Prüfsummen veröffentlicht exiftool.org/checksums.txt.
//
// Neue Version (Skill abhaengigkeiten): Release-Notes lesen (geänderte Tags beim Schreiben?),
// Version ≥ 7 Tage alt, Dateinamen und SHA2-256 aus exiftool.org/checksums.txt unten eintragen,
// dann `npm run exiftool:fetch -- --force`, Labortests und E2E.
//
// Aufbau des Windows-Archivs (13.x): `exiftool-<v>_64/exiftool(-k).exe` und daneben der Ordner
// `exiftool_files` mit der Perl-Laufzeit. Die exe wird zu `exiftool.exe` umbenannt – mit „(-k)“
// im Namen wartet sie am Ende auf einen Tastendruck. Linux: das Perl-Skript `exiftool` mit `lib/`
// aus dem Quell-Archiv (Perl ist auf den CI-Rechnern vorhanden).
//
// Aufruf: node scripts/download-exiftool.mjs [--force]   (ohne --force: nur, wenn nicht schon da)

import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync
} from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { arbeitsordner, aufraeumen, auspacken, ladeGeprueft, ordnerTauschen } from './lib/laden.mjs'

const EXIFTOOL = {
  version: '13.59',
  win: {
    datei: 'exiftool-13.59_64.zip',
    sha256: '44b512b25af500724ba579d0a53c8fc5851628b692dd5e5d94ae4a15c2cba9ec'
  },
  linux: {
    datei: 'Image-ExifTool-13.59.tar.gz',
    sha256: '668ea3acececb7235fbd0f4900e72d5f12c9b07e5c778fd36cb1e9b5828fd65a'
  }
}

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const os = process.platform === 'win32' ? 'win' : 'linux'
const ziel = join(ROOT, 'resources', 'exiftool', os)
const pin = EXIFTOOL[os]
const BIN = os === 'win' ? 'exiftool.exe' : 'exiftool'

function vorhanden() {
  try {
    const stand = JSON.parse(readFileSync(join(ziel, 'stand.json'), 'utf8'))
    return stand.datei === pin.datei && existsSync(join(ziel, BIN))
  } catch {
    return false
  }
}

/** Gebündeltes ExifTool aufbauen: Windows-exe samt Perl-Laufzeit bzw. Perl-Skript samt lib/. */
function aufbauen(aus, neu) {
  // feste Pfade statt Suche: im Quell-Archiv heißt auch ein Ordner „ExifTool“ (lib/Image/ExifTool)
  const top = join(
    aus,
    os === 'win' ? `exiftool-${EXIFTOOL.version}_64` : `Image-ExifTool-${EXIFTOOL.version}`
  )
  if (os === 'win') {
    const exe = join(top, 'exiftool(-k).exe')
    const files = join(top, 'exiftool_files')
    if (!existsSync(exe) || !existsSync(files)) {
      throw new Error(`exiftool(-k).exe oder exiftool_files fehlt in ${top}`)
    }
    copyFileSync(exe, join(neu, BIN))
    cpSync(files, join(neu, 'exiftool_files'), { recursive: true })
  } else {
    const skript = join(top, 'exiftool')
    const lib = join(top, 'lib')
    if (!existsSync(skript) || !existsSync(lib))
      throw new Error(`exiftool oder lib/ fehlt in ${top}`)
    copyFileSync(skript, join(neu, BIN))
    chmodSync(join(neu, BIN), 0o755)
    cpSync(lib, join(neu, 'lib'), { recursive: true })
  }
  // Lizenz (Perl-Lizenz: Artistic/GPL) – steht im README des Archivs
  const readme = join(top, os === 'win' ? 'README.txt' : 'README')
  if (existsSync(readme)) copyFileSync(readme, join(neu, 'README.txt'))
}

async function main() {
  console.log(`=== ExifTool ${EXIFTOOL.version} für ${os} ===`)
  if (!process.argv.includes('--force') && vorhanden()) {
    console.log(`  ✓ bereits vorhanden in ${ziel} (mit --force neu laden)`)
    return
  }
  const tmp = arbeitsordner('galeria-exiftool')
  try {
    const archiv = join(tmp, pin.datei)
    const url = `https://sourceforge.net/projects/exiftool/files/${pin.datei}/download`
    await ladeGeprueft(url, archiv, pin.sha256)
    const aus = join(tmp, 'aus')
    mkdirSync(aus)
    auspacken(archiv, aus)

    const neu = `${ziel}.neu`
    aufraeumen(neu)
    mkdirSync(neu, { recursive: true })
    aufbauen(aus, neu)

    // Startet die gebündelte Fassung und meldet die erwartete Version? (Windows: der erste Start
    // entpackt nichts mehr, seit 12.88 liegt die Perl-Laufzeit offen in exiftool_files)
    const v = spawnSync(join(neu, BIN), ['-ver'], { encoding: 'utf8', timeout: 60_000 })
    const version = (v.stdout ?? '').trim()
    if (version !== EXIFTOOL.version) {
      throw new Error(
        `ExifTool meldet „${version || v.error?.message || v.stderr}“ statt ${EXIFTOOL.version}`
      )
    }
    writeFileSync(
      join(neu, 'stand.json'),
      JSON.stringify({ version, datei: pin.datei, sha256: pin.sha256 }, null, 2) + '\n'
    )
    mkdirSync(dirname(ziel), { recursive: true })
    ordnerTauschen(neu, ziel)
    console.log(`  ✓ ExifTool ${version}`)
    console.log(`  ✓ abgelegt in ${ziel}`)
  } finally {
    aufraeumen(tmp)
  }
}

main().catch((err) => {
  console.error(`\n[exiftool] nicht geladen: ${err.message}`)
  process.exit(1)
})
