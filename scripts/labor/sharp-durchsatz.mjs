// Labor (Skill bild-labor): Vorschaubilder mit sharp messen – Durchsatz und Spitzenspeicher bei
// 24-MP-JPEGs, je nach Gleichzeitigkeit, dazu sehr große Bilder. Läuft unter Electrons eigener
// Node-Laufzeit (ELECTRON_RUN_AS_NODE), also wie später im Bilddienst (utilityProcess). Jede
// Einstellung in einem eigenen Prozess, damit der Spitzenspeicher (maxRSS) getrennt bleibt.
//
// Aufruf: node scripts/labor/sharp-durchsatz.mjs [--bilder 24] [--schnell]
//   --schnell  nur die wichtigsten Einstellungen
// Ergebnis: Tabelle auf der Konsole und JSON in <tmp>/galeria-labor-sharp.json.

import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { cpus, tmpdir, totalmem } from 'node:os'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const SKRIPT = fileURLToPath(import.meta.url)

/** Vorschaubilder wie im Bilddienst geplant: aufrichten, 768 px, daraus 256 px. */
async function vorschau(sharp, datei, schnell) {
  const gross = await sharp(datei, { failOn: 'error' })
    .rotate()
    .resize(768, 768, { fit: 'inside', withoutEnlargement: true, fastShrinkOnLoad: schnell })
    .jpeg({ quality: 80 })
    .toBuffer()
  const klein = await sharp(gross)
    .resize(256, 256, { fit: 'inside' })
    .jpeg({ quality: 80 })
    .toBuffer()
  return gross.length + klein.length
}

/** Kind: misst eine Einstellung und gibt JSON aus. */
async function kind(args) {
  const sharp = require('sharp')
  sharp.cache({ files: 0 }) // Befund aus dem Labor: sonst bleiben Dateien offen
  const [dir, parallel, conc, schnell] = [
    args[0],
    Number(args[1]),
    Number(args[2]),
    args[3] === '1'
  ]
  if (conc > 0) sharp.concurrency(conc)
  const dateien = readdirSync(dir)
    .filter((n) => n.endsWith('.jpg'))
    .map((n) => join(dir, n))
  // Aufwärmen (Bibliotheken laden), nicht mitgezählt
  await vorschau(sharp, dateien[0], schnell)
  const t0 = performance.now()
  let next = 0
  const arbeiter = Array.from({ length: parallel }, async () => {
    while (next < dateien.length) await vorschau(sharp, dateien[next++], schnell)
  })
  await Promise.all(arbeiter)
  const ms = performance.now() - t0
  process.stdout.write(
    JSON.stringify({
      bilder: dateien.length,
      ms: Math.round(ms),
      jeSekunde: +(dateien.length / (ms / 1000)).toFixed(2),
      maxRssMb: Math.round(process.resourceUsage().maxRSS / 1024)
    })
  )
}

function lauf(dir, parallel, conc, schnell, uvThreads) {
  const r = spawnSync(
    require('electron'),
    [SKRIPT, '--kind', dir, String(parallel), String(conc), schnell ? '1' : '0'],
    {
      encoding: 'utf8',
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', UV_THREADPOOL_SIZE: String(uvThreads) },
      timeout: 600_000
    }
  )
  if (r.status !== 0) throw new Error(r.stderr || r.error?.message)
  return JSON.parse(r.stdout)
}

/** Fotoähnliche Testbilder: Rauschen, weichgezeichnet, mit Verlauf – nie echte Fotos. */
async function vorbereiten(dir, anzahl) {
  const sharp = require('sharp')
  mkdirSync(dir, { recursive: true })
  const basen = []
  for (let i = 0; i < 4; i++) {
    const datei = join(dir, `basis-${i}.jpg`)
    const rauschen = await sharp({
      create: {
        width: 6000,
        height: 4000,
        channels: 3,
        background: '#808080',
        noise: { type: 'gaussian', mean: 110 + i * 10, sigma: 45 }
      }
    })
      .blur(1.2)
      .png({ compressionLevel: 0 })
      .toBuffer()
    await sharp(rauschen).jpeg({ quality: 90 }).toFile(datei)
    basen.push(datei)
  }
  for (let i = 0; i < anzahl; i++)
    copyFileSync(basen[i % 4], join(dir, `foto-${String(i).padStart(3, '0')}.jpg`))
  for (const b of basen) rmSync(b)
  return statSync(join(dir, 'foto-000.jpg')).size
}

async function grosseBilder(dir) {
  const sharp = require('sharp')
  const out = []
  for (const [name, w, h] of [
    ['panorama-30000x2000.jpg', 30000, 2000],
    ['riesig-12000x9000.jpg', 12000, 9000]
  ]) {
    const sub = join(dir, name.replace('.jpg', ''))
    mkdirSync(sub, { recursive: true })
    await sharp({
      create: {
        width: w,
        height: h,
        channels: 3,
        background: '#808080',
        noise: { type: 'gaussian', mean: 120, sigma: 40 }
      }
    })
      .blur(1.2)
      .jpeg({ quality: 90 })
      .toFile(join(sub, name))
    const r = lauf(sub, 1, 0, true, 4)
    out.push({
      name,
      megapixel: +((w * h) / 1e6).toFixed(0),
      mb: +(statSync(join(sub, name)).size / 1e6).toFixed(1),
      ms: r.ms,
      maxRssMb: r.maxRssMb
    })
  }
  return out
}

async function main() {
  const argv = process.argv.slice(2)
  if (argv[0] === '--kind') return kind(argv.slice(1))
  const anzahl = argv.includes('--bilder') ? Number(argv[argv.indexOf('--bilder') + 1]) : 24
  const schnellModus = argv.includes('--schnell')
  const dir = join(tmpdir(), `galeria-labor-sharp-${process.pid}`)
  try {
    console.log(
      `Rechner: ${cpus()[0].model.trim()}, ${cpus().length} Threads, ${Math.round(totalmem() / 2 ** 30)} GB`
    )
    const t0 = performance.now()
    const groesse = await vorbereiten(join(dir, 'fotos'), anzahl)
    console.log(
      `${anzahl} Testfotos 6000 × 4000 (24 MP), je ${(groesse / 1e6).toFixed(1)} MB, erzeugt in ${((performance.now() - t0) / 1000).toFixed(0)} s\n`
    )

    const einstellungen = schnellModus
      ? [
          [1, 0, true, 4],
          [4, 0, true, 4],
          [4, 1, true, 4]
        ]
      : [
          // [parallel, sharp.concurrency (0 = Vorgabe), fastShrinkOnLoad, UV_THREADPOOL_SIZE]
          [1, 0, true, 4],
          [2, 0, true, 4],
          [4, 0, true, 4],
          [6, 0, true, 6],
          [12, 0, true, 12],
          [4, 1, true, 4],
          [6, 1, true, 6],
          [12, 1, true, 12],
          [4, 2, true, 4],
          [4, 0, false, 4],
          [4, 1, false, 4]
        ]
    const ergebnisse = []
    console.log('parallel  concurrency  fastShrink  uvThreads   Bilder/s   Spitzenspeicher')
    for (const [p, c, s, uv] of einstellungen) {
      const r = lauf(join(dir, 'fotos'), p, c, s, uv)
      ergebnisse.push({
        parallel: p,
        concurrency: c || 'Vorgabe',
        fastShrinkOnLoad: s,
        uvThreads: uv,
        ...r
      })
      console.log(
        `${String(p).padStart(8)}  ${String(c || 'Vorgabe').padStart(11)}  ${String(s).padStart(10)}  ${String(uv).padStart(9)}  ${String(r.jeSekunde).padStart(9)}   ${r.maxRssMb} MB`
      )
    }
    console.log('\nSehr große Bilder (eine Vorschau, parallel 1):')
    const gross = await grosseBilder(join(dir, 'gross'))
    for (const g of gross)
      console.log(
        `  ${g.name} (${g.megapixel} MP, ${g.mb} MB): ${g.ms} ms, Spitzenspeicher ${g.maxRssMb} MB`
      )
    const datei = join(tmpdir(), 'galeria-labor-sharp.json')
    writeFileSync(
      datei,
      JSON.stringify(
        {
          rechner: {
            cpu: cpus()[0].model.trim(),
            threads: cpus().length,
            gb: Math.round(totalmem() / 2 ** 30)
          },
          ergebnisse,
          gross
        },
        null,
        2
      )
    )
    console.log(`\nJSON: ${datei}`)
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
