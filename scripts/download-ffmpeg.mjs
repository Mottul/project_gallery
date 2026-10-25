// Lädt ffmpeg und ffprobe (Video-Standbilder, Dauer, Codecs; Phase 6 auch HEIC) nach
// resources/ffmpeg/<win|linux>/ – nicht im Git, im Paket über extraResources.
//
// Nach dem Muster der Mottulbox (project_mega/scripts/download-ffmpeg.mjs), aber FEST GEPINNT wie
// ein Lockfile: ein bestimmter Build von BtbN/FFmpeg-Builds mit SHA-256 hier im Skript. BtbN hält
// die täglichen Builds nur rund zwei Wochen vor, die zum Monatsende dauerhaft – deshalb ein
// Monats-Build. LGPL-Variante: Die Galerie kodiert keine Videos, braucht also weder x264 noch
// x265 (GPL); Dekoder sind alle dabei. Windows (das Paket) als „shared“: ffmpeg und ffprobe teilen
// sich die DLLs – 150 statt 257 MB ausgepackt (statisch je 134 MB). Linux (nur CI) statisch, das
// braucht keine Bibliothekspfade.
//
// Neue Version (Skill abhaengigkeiten): einen Monats-Build wählen, der ≥ 7 Tage alt ist, Tag,
// Dateinamen und SHA-256 aus dessen checksums.sha256 unten eintragen, dann
// `npm run ffmpeg:fetch -- --force`; danach Labortests und E2E.
//
// Aufruf: node scripts/download-ffmpeg.mjs [--force]   (ohne --force: nur, wenn nicht schon da)

import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync
} from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  arbeitsordner,
  aufraeumen,
  auspacken,
  finde,
  ladeGeprueft,
  ordnerTauschen
} from './lib/laden.mjs'

const BUILD = {
  tag: 'autobuild-2026-09-30-13-08',
  version: 'n9.0.2-17-g2a571b6068',
  win: {
    datei: 'ffmpeg-n9.0.2-17-g2a571b6068-win64-lgpl-shared-9.0.zip',
    sha256: '7157177b8a6cb2174c1650ba8c71b363f2c78cba5330f88c4c02cf5b2b880646'
  },
  linux: {
    datei: 'ffmpeg-n9.0.2-17-g2a571b6068-linux64-lgpl-9.0.tar.xz',
    sha256: '2d41cbea0ca1a15029b638330740f78d6f5aeb062355bf425433fc938705350a'
  }
}

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const os = process.platform === 'win32' ? 'win' : 'linux'
const exe = os === 'win' ? '.exe' : ''
const BINS = [`ffmpeg${exe}`, `ffprobe${exe}`]
const ziel = join(ROOT, 'resources', 'ffmpeg', os)
const pin = BUILD[os]

function vorhanden() {
  try {
    const stand = JSON.parse(readFileSync(join(ziel, 'stand.json'), 'utf8'))
    return stand.datei === pin.datei && BINS.every((b) => existsSync(join(ziel, b)))
  } catch {
    return false
  }
}

async function main() {
  console.log(`=== ffmpeg ${BUILD.version} (LGPL) für ${os} ===`)
  if (!process.argv.includes('--force') && vorhanden()) {
    console.log(`  ✓ bereits vorhanden in ${ziel} (mit --force neu laden)`)
    return
  }
  const tmp = arbeitsordner('galeria-ffmpeg')
  try {
    const archiv = join(tmp, pin.datei)
    const url = `https://github.com/BtbN/FFmpeg-Builds/releases/download/${BUILD.tag}/${pin.datei}`
    await ladeGeprueft(url, archiv, pin.sha256)
    const aus = join(tmp, 'aus')
    mkdirSync(aus)
    auspacken(archiv, aus)

    // neben dem Ziel vollständig aufbauen, dann tauschen
    const neu = `${ziel}.neu`
    aufraeumen(neu)
    mkdirSync(neu, { recursive: true })
    for (const bin of BINS) {
      const quelle = finde(aus, bin)
      if (!quelle) throw new Error(`${bin} nicht im Archiv`)
      copyFileSync(quelle, join(neu, bin))
      if (os !== 'win') chmodSync(join(neu, bin), 0o755)
    }
    // Windows-shared: die DLLs liegen neben den exe (ohne ffplay und seine SDL-Bibliothek)
    if (os === 'win') {
      const bin = dirname(finde(aus, BINS[0]))
      for (const dll of readdirSync(bin).filter((n) => /\.dll$/i.test(n) && !/^SDL/i.test(n))) {
        copyFileSync(join(bin, dll), join(neu, dll))
      }
    }
    // Lizenztext gehört mit ins Paket (LGPL)
    const lizenz = finde(aus, 'LICENSE.txt')
    if (lizenz) copyFileSync(lizenz, join(neu, 'LICENSE.txt'))

    const v = spawnSync(join(neu, `ffmpeg${exe}`), ['-hide_banner', '-version'], {
      encoding: 'utf8'
    })
    const version = (v.stdout ?? '').split('\n')[0].trim()
    if (!version.includes(BUILD.version.split('-')[0])) {
      throw new Error(`ffmpeg startet nicht wie erwartet: ${version || v.error?.message}`)
    }
    writeFileSync(
      join(neu, 'stand.json'),
      JSON.stringify({ tag: BUILD.tag, datei: pin.datei, sha256: pin.sha256, version }, null, 2) +
        '\n'
    )
    mkdirSync(dirname(ziel), { recursive: true })
    ordnerTauschen(neu, ziel)
    console.log(`  ✓ ${version}`)
    console.log(`  ✓ abgelegt in ${ziel}`)
  } finally {
    aufraeumen(tmp)
  }
}

main().catch((err) => {
  console.error(`\n[ffmpeg] nicht geladen: ${err.message}`)
  process.exit(1)
})
