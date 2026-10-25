// Labor (Skill bild-labor): ExifTool im -stay_open-Betrieb messen – Kaltstart, Lesen von 1.000
// Dateien (Stapelgrößen, mit/ohne -fast2), Schreiben von 100 Dateien, Unicode-Namen, Pfade über
// 260 Zeichen, Pixel und Dateidatum nach dem Schreiben. Nur synthetische Dateien.
//
// Aufruf: node scripts/labor/exiftool-durchsatz.mjs   (vorher npm run exiftool:fetch)
// Ergebnis: Konsole und JSON in <tmp>/galeria-labor-exiftool.json.

import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { werkzeug } from '../testbilder.mjs'

sharp.cache({ files: 0 })
const EXIFTOOL = werkzeug('exiftool')
if (!EXIFTOOL) throw new Error('ExifTool fehlt – zuerst npm run exiftool:fetch')

/** Kleiner Client für `exiftool -stay_open True -@ -`: je Befehl ein -execute<n>, Ende an {ready<n>}. */
function stayOpen(extraArgs = []) {
  const p = spawn(EXIFTOOL, [
    '-stay_open',
    'True',
    '-@',
    '-',
    '-common_args',
    '-charset',
    'filename=utf8',
    ...extraArgs
  ])
  let puffer = ''
  let fehler = ''
  let wartend = null
  let nr = 0
  p.stdout.setEncoding('utf8')
  p.stderr.setEncoding('utf8')
  p.stderr.on('data', (d) => (fehler += d))
  p.stdout.on('data', (d) => {
    puffer += d
    const m = wartend && puffer.match(new RegExp(`\\{ready${wartend.nr}\\}\\r?\\n?`))
    if (m) {
      const ausgabe = puffer.slice(0, m.index)
      puffer = puffer.slice(m.index + m[0].length)
      const w = wartend
      wartend = null
      w.resolve({ ausgabe, fehler: fehler.trim() })
      fehler = ''
    }
  })
  return {
    befehl(args) {
      nr++
      return new Promise((resolve) => {
        wartend = { nr, resolve }
        p.stdin.write([...args, `-execute${nr}`].join('\n') + '\n')
      })
    },
    beenden() {
      p.stdin.write('-stay_open\nFalse\n')
      return new Promise((r) => p.on('exit', r))
    }
  }
}

const sha = (buf) => createHash('sha256').update(buf).digest('hex')
const pixelHash = async (f) => sha(await sharp(f).raw().toBuffer())
const ms = (t0) => Math.round(performance.now() - t0)

async function main() {
  const dir = join(tmpdir(), `galeria-labor-exiftool-${process.pid}`)
  const ergebnis = {}
  try {
    mkdirSync(dir, { recursive: true })
    // Vorlage: 640 × 480 mit typischen Kamera-Metadaten, dann 1.000 Kopien (jede 10. mit Umlauten/Emoji)
    const vorlage = join(dir, 'vorlage.jpg')
    await sharp({
      create: {
        width: 640,
        height: 480,
        channels: 3,
        background: '#557799',
        noise: { type: 'gaussian', mean: 120, sigma: 30 }
      }
    })
      .jpeg({ quality: 85 })
      .toFile(vorlage)
    spawnSync(EXIFTOOL, [
      '-overwrite_original',
      '-q',
      '-Make=Galeria',
      '-Model=Testkamera A',
      '-DateTimeOriginal=2024:05:01 12:00:00',
      '-GPSLatitude=48.1374',
      '-GPSLatitudeRef=N',
      '-GPSLongitude=11.5755',
      '-GPSLongitudeRef=E',
      '-XMP-dc:Subject=Test',
      vorlage
    ])
    const dateien = []
    for (let i = 0; i < 1000; i++) {
      const name = i % 10 === 0 ? `Grüße 🌞 ${i}.jpg` : `bild-${String(i).padStart(4, '0')}.jpg`
      const f = join(dir, 'bib', name)
      if (i === 0) mkdirSync(join(dir, 'bib'))
      copyFileSync(vorlage, f)
      dateien.push(f)
    }

    // Kaltstart: erster Aufruf nach dem Laden ist unter Windows langsamer (Perl-Laufzeit von der Platte)
    let t0 = performance.now()
    spawnSync(EXIFTOOL, ['-ver'])
    const kalt = ms(t0)
    t0 = performance.now()
    spawnSync(EXIFTOOL, ['-ver'])
    ergebnis.start = { erstesMalMs: kalt, wiederholtMs: ms(t0) }
    console.log(
      `Start eines ExifTool-Prozesses: erstes Mal ${kalt} ms, danach ${ergebnis.start.wiederholtMs} ms`
    )

    // Lesen von 1.000 Dateien in einem stay_open-Prozess, verschiedene Stapelgrößen
    ergebnis.lesen = []
    for (const [stapel, fast] of [
      [1, false],
      [50, false],
      [200, false],
      [200, true]
    ]) {
      const et = stayOpen()
      await et.befehl(['-ver']) // Prozess warm
      t0 = performance.now()
      let gelesen = 0
      for (let i = 0; i < dateien.length; i += stapel) {
        const r = await et.befehl([
          '-json',
          '-n',
          '-G1',
          ...(fast ? ['-fast2'] : []),
          ...dateien.slice(i, i + stapel)
        ])
        gelesen += JSON.parse(r.ausgabe).length
      }
      const dauer = ms(t0)
      await et.beenden()
      if (gelesen !== dateien.length) throw new Error(`nur ${gelesen} gelesen`)
      ergebnis.lesen.push({
        stapel,
        fast2: fast,
        ms: dauer,
        jeSekunde: Math.round((dateien.length / dauer) * 1000)
      })
      console.log(
        `Lesen 1.000 Dateien, Stapel ${stapel}${fast ? ', -fast2' : ''}: ${dauer} ms (${ergebnis.lesen.at(-1).jeSekunde}/s)`
      )
    }

    // Mehrere stay_open-Prozesse parallel (je einer pro Spur im Bilddienst)
    for (const anzahl of [2, 3, 4]) {
      const prozesse = Array.from({ length: anzahl }, () => stayOpen())
      await Promise.all(prozesse.map((et) => et.befehl(['-ver'])))
      t0 = performance.now()
      let next = 0
      await Promise.all(
        prozesse.map(async (et) => {
          while (next < dateien.length) {
            const teil = dateien.slice(next, next + 50)
            next += 50
            await et.befehl(['-json', '-n', '-G1', ...teil])
          }
        })
      )
      const dauer = ms(t0)
      await Promise.all(prozesse.map((et) => et.beenden()))
      ergebnis.lesen.push({
        stapel: 50,
        prozesse: anzahl,
        ms: dauer,
        jeSekunde: Math.round((dateien.length / dauer) * 1000)
      })
      console.log(
        `Lesen 1.000 Dateien, Stapel 50, ${anzahl} Prozesse parallel: ${dauer} ms (${ergebnis.lesen.at(-1).jeSekunde}/s)`
      )
    }

    // Unicode-Namen: kommen sie unverändert zurück?
    {
      const et = stayOpen()
      const uni = dateien.filter((f) => f.includes('🌞')).slice(0, 5)
      const r = JSON.parse((await et.befehl(['-json', '-n', ...uni])).ausgabe)
      await et.beenden()
      ergebnis.unicode = r.every(
        (x, i) =>
          x.SourceFile.replace(/\//g, '\\') === uni[i] ||
          x.SourceFile === uni[i].replace(/\\/g, '/')
      )
      console.log(
        `Unicode-Namen (Umlaute, Emoji) gelesen und unverändert zurückgemeldet: ${ergebnis.unicode}`
      )
    }

    // Schreiben von 100 Dateien (je Datei ein Befehl, wie im Stapel), Pixel und Datum prüfen
    {
      const ziel = dateien.slice(0, 100)
      const vorher = await Promise.all(ziel.slice(0, 5).map(pixelHash))
      const datumVorher = ziel.slice(0, 5).map((f) => statSync(f).mtimeMs)
      const et = stayOpen()
      await et.befehl(['-ver'])
      t0 = performance.now()
      let fehler = 0
      for (const [i, f] of ziel.entries()) {
        const r = await et.befehl([
          '-overwrite_original',
          '-P',
          `-XMP-dc:Title=Titel ${i} – Grüße`,
          '-XMP-xmp:Rating=4',
          f
        ])
        if (!/1 image files updated/.test(r.ausgabe)) fehler++
      }
      const dauer = ms(t0)
      const kontrolle = JSON.parse(
        (await et.befehl(['-json', '-XMP-dc:Title', ziel[3]])).ausgabe
      )[0]
      await et.beenden()
      const nachher = await Promise.all(ziel.slice(0, 5).map(pixelHash))
      ergebnis.schreiben = {
        dateien: ziel.length,
        ms: dauer,
        jeSekunde: Math.round((ziel.length / dauer) * 1000),
        fehler,
        pixelGleich: vorher.every((h, i) => h === nachher[i]),
        datumBehaltenMitP: ziel
          .slice(0, 5)
          .every((f, i) => Math.abs(statSync(f).mtimeMs - datumVorher[i]) < 2000),
        wertGelesen: kontrolle.Title
      }
      console.log(
        `Schreiben 100 Dateien: ${dauer} ms (${ergebnis.schreiben.jeSekunde}/s), Fehler ${fehler}, Pixel gleich: ${ergebnis.schreiben.pixelGleich}, Datum mit -P behalten: ${ergebnis.schreiben.datumBehaltenMitP}, Wert: „${kontrolle.Title}“`
      )
    }

    // Pfade über 260 Zeichen (Windows MAX_PATH)
    {
      let tief = join(dir, 'lang')
      while (tief.length < 280) tief = join(tief, 'Unterordner mit langem Namen')
      mkdirSync(tief, { recursive: true })
      const f = join(tief, 'Bild über 260 Zeichen.jpg')
      copyFileSync(vorlage, f)
      const et = stayOpen()
      const lesen = JSON.parse((await et.befehl(['-json', '-n', '-Model', f])).ausgabe || '[]')
      const schreiben = await et.befehl(['-overwrite_original', '-XMP-dc:Title=Lang', f])
      const zurueck = JSON.parse((await et.befehl(['-json', '-XMP-dc:Title', f])).ausgabe || '[]')
      await et.beenden()
      ergebnis.langePfade = {
        laenge: f.length,
        lesen: lesen[0]?.Model === 'Testkamera A',
        schreiben: /1 image files updated/.test(schreiben.ausgabe) && zurueck[0]?.Title === 'Lang',
        meldung: (schreiben.fehler || '').split('\n')[0]
      }
      console.log(
        `Pfad mit ${f.length} Zeichen: lesen ${ergebnis.langePfade.lesen}, schreiben ${ergebnis.langePfade.schreiben}${ergebnis.langePfade.meldung ? ` (${ergebnis.langePfade.meldung})` : ''}`
      )
    }

    const datei = join(tmpdir(), 'galeria-labor-exiftool.json')
    writeFileSync(datei, JSON.stringify(ergebnis, null, 2))
    console.log(`\nJSON: ${datei}`)
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
