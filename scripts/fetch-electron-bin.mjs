// Aus der Mottulbox übernommen (project_mega/scripts/fetch-electron-bin.mjs, Stand 0cc14cb).
// Laedt die Electron-Laufzeit-Binary direkt aus dem GitHub-Release und legt
// node_modules/electron/{dist, path.txt} an -- in reinem Node, ohne electron's
// eigenen install.js / @electron/get.
//
// Hintergrund: Install-Skripte von Abhaengigkeiten laufen nicht (.npmrc: ignore-scripts),
// electrons eigenes install.js also auch nicht -- ohne Binary wirft electron-vite
// "Electron uninstall". Dieser Schritt laeuft deshalb vor dev, start und e2e (und in der CI)
// -- genau wie der ffmpeg-Downloader.
//
// Idempotent: liegt die Binary schon vor, passiert nichts (npm install bleibt schnell).
//
// Geprüft wird gegen die SHA-256-Summe aus electron/checksums.json: Die Datei kommt mit dem
// npm-Paket, das die Lock-Datei per integrity absichert -- ein verändertes Zip fällt so auf.

import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { spawnSync } from 'node:child_process'
import { Buffer } from 'node:buffer'
import https from 'node:https'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)

let elDir
try {
  elDir = dirname(require.resolve('electron/package.json'))
} catch {
  console.log('[electron-bin] electron nicht installiert — uebersprungen.')
  process.exit(0)
}

const version = JSON.parse(readFileSync(join(elDir, 'package.json'), 'utf8')).version
const platform = process.platform // win32 | darwin | linux
const arch = process.arch // x64 | arm64 | ...

// Name der ausfuehrbaren Datei je Plattform; [0] ist der Wurzeleintrag im dist/.
const BIN_NAME =
  platform === 'win32'
    ? 'electron.exe'
    : platform === 'darwin'
      ? 'Electron.app/Contents/MacOS/Electron'
      : 'electron'
const ROOT_ENTRY = BIN_NAME.split('/')[0]

const distPath = join(elDir, 'dist')
const pathTxt = join(elDir, 'path.txt')

// Schon vorhanden? -> nichts tun.
if (existsSync(pathTxt) && existsSync(join(distPath, ROOT_ENTRY))) {
  console.log(`[electron-bin] Electron ${version} bereits vorhanden — uebersprungen.`)
  process.exit(0)
}

const zipName = `electron-v${version}-${platform}-${arch}.zip`
const url = `https://github.com/electron/electron/releases/download/v${version}/${zipName}`

/** Erwartete Prüfsumme aus dem npm-Paket; ohne Eintrag kein Download. */
function expectedSha256() {
  const file = join(elDir, 'checksums.json')
  const sums = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {}
  const sum = sums[zipName]
  if (typeof sum !== 'string' || !/^[0-9a-f]{64}$/.test(sum)) {
    throw new Error(`keine Prüfsumme für ${zipName} in electron/checksums.json`)
  }
  return sum
}

function sha256Of(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}

function download(u, dest, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 6) return reject(new Error('Zu viele Redirects'))
    https
      .get(u, { headers: { 'User-Agent': 'galeria-beata-build' } }, (res) => {
        const status = res.statusCode ?? 0
        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume()
          resolve(download(res.headers.location, dest, redirects + 1))
          return
        }
        if (status !== 200) {
          res.resume()
          reject(new Error(`HTTP ${status} bei ${u}`))
          return
        }
        const total = Number(res.headers['content-length'] || 0)
        let got = 0
        let lastPct = -1
        res.on('data', (c) => {
          got += c.length
          if (total) {
            const pct = Math.floor((got / total) * 100)
            if (pct >= lastPct + 10) {
              lastPct = pct
              process.stdout.write(
                `\r[electron-bin]   ${pct}% (${(got / 1048576) | 0}/${(total / 1048576) | 0} MB)`
              )
            }
          }
        })
        // WICHTIG: Abbrüche des Response-Streams explizit behandeln. Ohne diese
        // Handler löst der Promise bei einem Verbindungsabriss NIE auf -- der
        // Event-Loop leert sich und Node beendet sich still mit Exit 0
        // ("hing bei 99%", keine Meldung).
        res.on('aborted', () =>
          reject(new Error('Verbindung abgebrochen (Download unvollständig)'))
        )
        res.on('error', (err) => reject(new Error(`Download-Fehler: ${err.message}`)))
        const out = createWriteStream(dest)
        res.pipe(out)
        out.on('finish', () => {
          if (total) process.stdout.write('\n')
          out.close(() => {
            // Vollständigkeit hart prüfen -- ein abgerissener Stream kann trotzdem
            // ein 'finish' der Datei auslösen.
            if (total && got !== total) {
              reject(new Error(`Download unvollständig (${got} von ${total} Bytes)`))
            } else resolve()
          })
        })
        out.on('error', reject)
      })
      .on('error', reject)
  })
}

/** Download mit bis zu 3 Versuchen (transiente Netzfehler/Abbrüche). */
async function downloadWithRetry(u, dest) {
  for (let attempt = 1; ; attempt++) {
    try {
      await download(u, dest)
      return
    } catch (err) {
      rmSync(dest, { force: true })
      if (attempt >= 3) throw err
      console.warn(
        `\n[electron-bin] Versuch ${attempt} fehlgeschlagen (${err.message}) -- neuer Versuch …`
      )
    }
  }
}

/** Promise mit Zeitwächter. Ein hängender Schritt beendet den Prozess sonst
 *  still mit Exit 0 (leerer Event-Loop) -- der Timer hält ihn wach und meldet
 *  klar, statt lautlos ohne Binary zurückzukehren. */
function withTimeout(promise, ms, label) {
  let timer
  const guard = new Promise((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} hängt (nach ${Math.round(ms / 1000)}s abgebrochen)`)),
      ms
    )
  })
  return Promise.race([promise, guard]).finally(() => clearTimeout(timer))
}

/** Zip entpacken. Unter Windows NATIV (Expand-Archive, sonst tar): extract-zip
 *  hängt dort in manchen Node-Versionen und der Prozess endet still mit Exit 0,
 *  bevor das Entpacken fertig ist ("Download vollständig, entpacke …", dann
 *  nichts). spawnSync blockiert bis zum Ende -> kein stiller Abbruch möglich.
 *  mac/Linux: weiterhin extract-zip, aber mit Zeitwächter. */
function unzip(zip, destDir) {
  if (process.platform === 'win32') {
    // Ohne Fortschrittsbalken: Er bremst Expand-Archive und landet als CLIXML in der Ausgabe.
    const psScript =
      `$ProgressPreference = 'SilentlyContinue'; Expand-Archive -LiteralPath '${zip.replace(/'/g, "''")}' ` +
      `-DestinationPath '${destDir.replace(/'/g, "''")}' -Force`
    const encoded = Buffer.from(psScript, 'utf16le').toString('base64')
    const ps = spawnSync(
      'powershell',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
      { stdio: 'inherit' }
    )
    if (!ps.error && ps.status === 0) return Promise.resolve()
    console.warn('[electron-bin] Expand-Archive nicht nutzbar, versuche tar …')
    const t = spawnSync('tar', ['-xf', zip, '-C', destDir], { stdio: 'inherit' })
    if (!t.error && t.status === 0) return Promise.resolve()
    console.warn('[electron-bin] tar nicht nutzbar, versuche extract-zip …')
  }
  return loadExtract().then((extract) =>
    withTimeout(extract(zip, { dir: destDir }), 180000, 'Entpacken (extract-zip)')
  )
}

/** Den Zip-Entpacker aus electrons eigenen Abhängigkeiten holen (für dessen install.js
 *  ohnehin vorhanden). Neuere Electron-Versionen bringen statt `extract-zip` den
 *  Ersatz `@electron-internal/extract-zip` mit (ESM, gleiche Signatur) -> beide versuchen. */
async function loadExtract() {
  for (const name of ['@electron-internal/extract-zip', 'extract-zip']) {
    let file
    try {
      file = require.resolve(name, { paths: [elDir] })
    } catch {
      continue
    }
    const mod = await import(pathToFileURL(file).href)
    const fn = mod.default ?? mod.extract
    if (typeof fn === 'function') return fn
  }
  throw new Error('kein Zip-Entpacker gefunden (@electron-internal/extract-zip bzw. extract-zip)')
}

async function main() {
  const tmp = join(tmpdir(), `electron-bin-${Date.now()}`)
  mkdirSync(tmp, { recursive: true })
  const zip = join(tmp, 'electron.zip')
  try {
    console.log(`[electron-bin] lade Electron ${version} (${platform}-${arch}) …`)
    const expected = expectedSha256()
    await downloadWithRetry(url, zip)
    const actual = sha256Of(zip)
    if (actual !== expected) {
      throw new Error(`Prüfsumme stimmt nicht (${zipName}: ${actual}, erwartet ${expected})`)
    }
    console.log('[electron-bin] Download vollständig, Prüfsumme stimmt, entpacke …')
    rmSync(distPath, { recursive: true, force: true })
    mkdirSync(distPath, { recursive: true })
    await unzip(zip, distPath)
    if (!existsSync(join(distPath, ROOT_ENTRY))) {
      throw new Error(`${ROOT_ENTRY} nach dem Entpacken nicht gefunden (Virenscanner?)`)
    }
    // path.txt -- exakt der Binary-Name, OHNE Zeilenumbruch (electron-vite trimmt nicht).
    writeFileSync(pathTxt, BIN_NAME)
    console.log('[electron-bin] fertig.')
  } finally {
    try {
      rmSync(tmp, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  }
}

main().catch((err) => {
  console.error(`\n[electron-bin] Konnte Electron-Binary nicht installieren: ${err.message}`)
  console.error('  Erneut versuchen:  npm run electron:bin')
  console.error(
    '  Fehlt die exe nach dem Entpacken: Projektordner in den Virenscanner-Ausnahmen eintragen.'
  )
  // Ohne Binary startet nichts -> dev/start/e2e hier abbrechen statt später kryptisch.
  process.exit(1)
})
