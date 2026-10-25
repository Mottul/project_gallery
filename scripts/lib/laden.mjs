// Gemeinsame Bausteine der Download-Skripte für gebündelte Programme (ffmpeg, ExifTool): laden mit
// Umleitungen und Wiederholungen, SHA-256 gegen einen FEST im Skript stehenden Wert prüfen (wie ein
// Lockfile – eine veränderte Quelle kann so nichts unterschieben), auspacken, Ordner atomar tauschen.
// Download-Teil nach scripts/fetch-electron-bin.mjs (aus der Mottulbox): Abbrüche des Streams
// führen zu einem Fehler statt zu einem still halb geladenen Archiv.

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdtempSync,
  readdirSync,
  renameSync,
  rmSync
} from 'node:fs'
import https from 'node:https'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const USER_AGENT = 'galeria-beata-build'

function downloadOnce(url, dest, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 8) return reject(new Error('Zu viele Umleitungen'))
    if (!url.startsWith('https://')) return reject(new Error(`Nur https: ${url}`))
    https
      .get(url, { headers: { 'User-Agent': USER_AGENT } }, (res) => {
        const status = res.statusCode ?? 0
        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume()
          resolve(downloadOnce(new URL(res.headers.location, url).href, dest, redirects + 1))
          return
        }
        if (status !== 200) {
          res.resume()
          reject(new Error(`HTTP ${status} bei ${url}`))
          return
        }
        const total = Number(res.headers['content-length'] || 0)
        let got = 0
        res.on('data', (c) => (got += c.length))
        res.on('aborted', () => reject(new Error('Verbindung abgebrochen')))
        res.on('error', (err) => reject(new Error(`Download-Fehler: ${err.message}`)))
        const out = createWriteStream(dest)
        res.pipe(out)
        out.on('finish', () =>
          out.close(() =>
            total && got !== total
              ? reject(new Error(`Download unvollständig (${got} von ${total} Bytes)`))
              : resolve()
          )
        )
        out.on('error', reject)
      })
      .on('error', reject)
  })
}

/** Laden mit bis zu 3 Versuchen (vorübergehende Netzfehler). */
export async function download(url, dest) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await downloadOnce(url, dest)
    } catch (err) {
      rmSync(dest, { force: true })
      if (attempt >= 3) throw err
      console.warn(`  … Versuch ${attempt} fehlgeschlagen (${err.message}), neuer Versuch`)
      await new Promise((r) => setTimeout(r, 2000 * attempt))
    }
  }
}

/** SHA-256 einer Datei (gestreamt – Archive sind über 100 MB groß). */
export function sha256File(file) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    createReadStream(file)
      .on('data', (c) => hash.update(c))
      .on('end', () => resolve(hash.digest('hex')))
      .on('error', reject)
  })
}

/** Laden und gegen die feste Prüfsumme prüfen; wirft, wenn sie nicht stimmt. */
export async function ladeGeprueft(url, dest, sha256) {
  console.log(`  ↓ ${url}`)
  await download(url, dest)
  const ist = await sha256File(dest)
  if (ist !== sha256) {
    rmSync(dest, { force: true })
    throw new Error(`Prüfsumme stimmt nicht (${ist}, erwartet ${sha256}) – nicht übernommen`)
  }
  console.log(`  ✓ Prüfsumme stimmt (${ist.slice(0, 12)}…)`)
}

function run(cmd, args) {
  const r = spawnSync(cmd, args, { stdio: 'inherit' })
  if (r.error || r.status !== 0) {
    throw new Error(`${cmd} fehlgeschlagen (${r.error?.message ?? `Code ${r.status}`})`)
  }
}

/** Archiv (.zip, .tar.gz, .tar.xz) nach destDir auspacken. */
export function auspacken(archiv, destDir) {
  if (archiv.endsWith('.zip')) {
    if (process.platform === 'win32') {
      // Ohne Fortschrittsbalken: er bremst Expand-Archive stark (Muster fetch-electron-bin.mjs)
      run('powershell', [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `$ProgressPreference = 'SilentlyContinue'; Expand-Archive -Force -LiteralPath '${archiv.replace(/'/g, "''")}' -DestinationPath '${destDir.replace(/'/g, "''")}'`
      ])
    } else {
      run('unzip', ['-q', '-o', archiv, '-d', destDir])
    }
  } else if (archiv.endsWith('.tar.xz')) {
    run('tar', ['-xJf', archiv, '-C', destDir])
  } else if (archiv.endsWith('.tar.gz')) {
    run('tar', ['-xzf', archiv, '-C', destDir])
  } else {
    throw new Error(`Unbekanntes Archiv: ${archiv}`)
  }
}

/** Datei oder Ordner mit diesem Namen irgendwo unter dir (Archive haben einen Versionsordner). */
export function finde(dir, name) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.name.toLowerCase() === name.toLowerCase()) return p
    if (e.isDirectory()) {
      const tiefer = finde(p, name)
      if (tiefer) return tiefer
    }
  }
  return null
}

/** Frischer Arbeitsordner im Temp-Verzeichnis; `aufraeumen` löscht ihn. */
export function arbeitsordner(prefix) {
  return mkdtempSync(join(tmpdir(), `${prefix}-`))
}

export function aufraeumen(dir) {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  } catch {
    // Temp-Ordner bleibt liegen – kein Grund, den Lauf scheitern zu lassen
  }
}

/**
 * Fertig vorbereiteten Ordner `neu` an die Stelle von `ziel` setzen: erst den alten beiseite, dann
 * umbenennen, dann den alten löschen. Ein abgebrochener Lauf hinterlässt nie eine halbe
 * Installation; läuft das Programm gerade (Windows sperrt die exe), scheitert es vor dem Tausch.
 */
export function ordnerTauschen(neu, ziel) {
  const alt = `${ziel}.alt-${Date.now()}`
  if (existsSync(ziel)) renameSync(ziel, alt)
  try {
    renameSync(neu, ziel)
  } catch (err) {
    if (existsSync(alt)) renameSync(alt, ziel)
    throw err
  }
  aufraeumen(alt)
}
