// Ortsdaten für „nächster Ort“ (Phase 2.2) aus GeoNames bauen: cities1000 (Orte ab 1.000
// Einwohnern, entschieden 29.10.2026) plus deutsche Namen aus alternateNamesV2 →
// resources/geo/orte.tsv.gz (kompakt, rund 3 MB) und resources/geo/orte.json (Stand, Quelle,
// Lizenz, Anzahl, SHA-256 der Datei – die App prüft sie beim Laden).
//
// GeoNames erzeugt seine Dateien täglich neu – eine feste Prüfsumme wie bei ExifTool und ffmpeg
// geht darum nicht. Stattdessen liegt das ERGEBNIS im Repository (im Pull Request sichtbar,
// SHA-256 in orte.json); die Prüfsummen der geladenen Quellen hält orte.json fest. Neu bauen nur
// bewusst (neue Orte, Korrekturen), mit einem eigenen Pull Request: npm run orte:bauen
//
// Lizenz: GeoNames (https://www.geonames.org), CC BY 4.0 – Hinweis in resources/geo/LIZENZ.txt
// und in „Über“.
//
// Gemessen (29.10.2026): 171.731 Orte, ohne Ortsteile und Wüstungen 162.057; deutsche Namen für
// rund 22.000 (5.200 weichen ab: München, Wien, Prag, Rom …); alternateNamesV2 205 MB gepackt,
// 787 MB entpackt, Durchlauf rund 45 s.

import { createHash } from 'node:crypto'
import { createReadStream, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'
import { arbeitsordner, aufraeumen, auspacken, download, sha256File } from './lib/laden.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const ZIEL = join(ROOT, 'resources', 'geo')
const QUELLE = 'https://download.geonames.org/export/dump/'

/** Nicht als Ort taugt: Ortsteil, historisch, aufgegeben, zerstört (GeoNames-Featurecodes) */
const OHNE = new Set(['PPLX', 'PPLH', 'PPLQ', 'PPLW', 'PPLCH'])

/** Text für die TSV-Datei: keine Tabs, Zeilenumbrüche, Steuerzeichen */
const sauber = (s) => s.replace(/[\p{Cc}]/gu, ' ').trim()

async function main() {
  const tmp = arbeitsordner('galeria-orte')
  try {
    const quellen = {}
    for (const datei of ['cities1000.zip', 'alternateNamesV2.zip']) {
      console.log(`  ↓ ${QUELLE}${datei}`)
      await download(QUELLE + datei, join(tmp, datei))
      quellen[datei] = await sha256File(join(tmp, datei))
      auspacken(join(tmp, datei), tmp)
    }

    // Orte: geonameid, name, asciiname, alternatenames, lat, lon, class, code, land, …, Einwohner
    const orte = new Map()
    for (const z of readFileSync(join(tmp, 'cities1000.txt'), 'utf8').split('\n')) {
      const f = z.split('\t')
      if (f.length < 15 || f[6] !== 'P' || OHNE.has(f[7])) continue
      const lat = Number(f[4])
      const lon = Number(f[5])
      if (!Number.isFinite(lat) || !Number.isFinite(lon) || !/^[A-Z]{2}$/.test(f[8])) continue
      orte.set(f[0], { name: sauber(f[1]), lat, lon, land: f[8], einw: Number(f[14]) || 0 })
    }

    // deutsche Namen: bevorzugt markierte, sonst der erste; nie umgangssprachlich oder historisch
    const de = new Map()
    const rl = createInterface({ input: createReadStream(join(tmp, 'alternateNamesV2.txt')) })
    for await (const z of rl) {
      const f = z.split('\t')
      if (f[2] !== 'de' || !orte.has(f[1]) || f[6] === '1' || f[7] === '1') continue
      const bevorzugt = f[4] === '1'
      const alt = de.get(f[1])
      if (!alt || (bevorzugt && !alt.bevorzugt)) de.set(f[1], { name: sauber(f[3]), bevorzugt })
    }

    const zeilen = []
    for (const [id, o] of orte) {
      const name = de.get(id)?.name || o.name
      if (!name) continue
      zeilen.push([name, o.lat.toFixed(4), o.lon.toFixed(4), o.land, o.einw].join('\t'))
    }
    zeilen.sort()
    const daten = gzipSync(zeilen.join('\n') + '\n', { level: 9 })
    mkdirSync(ZIEL, { recursive: true })
    writeFileSync(join(ZIEL, 'orte.tsv.gz'), daten)
    const info = {
      stand: new Date().toISOString().slice(0, 10),
      quelle: 'GeoNames cities1000 + alternateNamesV2 (Sprache de)',
      lizenz: 'CC BY 4.0 – https://www.geonames.org',
      orte: zeilen.length,
      deutscheNamen: [...de.keys()].filter((id) => orte.has(id)).length,
      sha256: createHash('sha256').update(daten).digest('hex'),
      quellen
    }
    writeFileSync(join(ZIEL, 'orte.json'), JSON.stringify(info, null, 2) + '\n')
    console.log(
      `Ortsdaten: ${info.orte} Orte, ${info.deutscheNamen} deutsche Namen, ` +
        `${(daten.length / 1e6).toFixed(1)} MB → ${ZIEL}`
    )
  } finally {
    aufraeumen(tmp)
  }
}

main().catch((err) => {
  console.error(err.message)
  process.exit(1)
})
