// Grundfelder und Sortieren in der echten App (Phase 1.2): ExifTool im Bilddienst liest Maße,
// Ausrichtung, Format und Aufnahmedatum der Testbibliothek; die Abfrage liefert Kennungen in der
// gewählten Reihenfolge (Name, Aufnahmedatum, Änderungsdatum, Größe, Typ); die Oberfläche wählt
// die Sortierung und merkt sie sich. Am Ende: Nach dem Beenden bleibt kein ExifTool zurück.

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import {
  erwarteteBilder,
  launchApp,
  root,
  runSteps,
  sleep,
  Skip,
  stubOrdnerDialog,
  testbibliothek,
  waitFor
} from './harness.mjs'

const bib = await testbibliothek()
const erwartet = erwarteteBilder(bib.manifest)
const bilder = bib.manifest.eintraege.filter((e) => e.art === 'bild')
const defektNamen = bib.manifest.eintraege
  .filter((e) => e.art === 'defekt')
  .map((e) => e.datei.split('/').pop())
const name = (e) => e.datei.split('/').pop()
const FELDER = ['aufnahme', 'name', 'geaendert', 'groesse', 'typ']

// Gebündeltes ExifTool der Entwicklungs-App (exiftool/binPath.ts)
const EXIFTOOL_DIR = join(root, 'resources', 'exiftool', 'win')

/** Prozesse, deren Programm im ExifTool-Ordner liegt: „pid (gestartet hh:mm:ss)“. */
function exiftoolProzesse() {
  const out = execFileSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      'Get-Process | Where-Object { $_.Path -and $_.Path.StartsWith($env:E2E_EXIFTOOL_DIR, ' +
        "'OrdinalIgnoreCase') } | ForEach-Object { \"$($_.Id) (gestartet $($_.StartTime.ToString('HH:mm:ss')))\" }"
    ],
    { encoding: 'utf8', env: { ...process.env, E2E_EXIFTOOL_DIR: EXIFTOOL_DIR } }
  )
  return out
    .split(/\r?\n/)
    .map((z) => z.trim())
    .filter(Boolean)
}

// schon vor dem Start übrig (aus einem vorigen Skript)? Dann zählt das hier nicht mit.
const prozesseVorher = process.platform === 'win32' ? exiftoolProzesse() : []
const startZeit = new Date().toTimeString().slice(0, 8)
let ctx = await launchApp()
const api = {
  zustand: () => ctx.page.evaluate(() => window.api.library.state()),
  query: (feld, richtung = 'auf') =>
    ctx.page.evaluate((s) => window.api.library.query(s), { feld, richtung }),
  details: (ids) => ctx.page.evaluate((x) => window.api.library.details(x), ids)
}
/** Details aller Dateien in der Reihenfolge einer Sortierung */
const liste = async (feld, richtung = 'auf') => api.details(await api.query(feld, richtung))
/** Namen der Tabellenzeilen in der Oberfläche */
/** Namen der Kacheln in der Oberfläche (virtualisiert: nur die gerade gezeigten, in Reihenfolge) */
const tabelle = () =>
  ctx.page.$$eval('[role="listbox"][aria-label="Bilder"] [role="option"]', (el) =>
    el.map((x) => x.getAttribute('aria-label'))
  )
/** Zeigt die Oberfläche den Anfang dieser Reihenfolge? */
const zeigtAnfang = async (namen) => {
  const t = await tabelle()
  return t.length > 0 && JSON.stringify(t) === JSON.stringify(namen.slice(0, t.length))
}
const zeilenUeber = new Map()
let prozesseWaehrend = []

try {
  await runSteps('Sortieren – Grundfelder und Reihenfolge', [
    [
      `Ordner einlesen, Metadaten aller ${erwartet} Dateien gelesen`,
      async () => {
        await stubOrdnerDialog(ctx.app, bib.dir)
        await ctx.page.getByRole('main').getByRole('button', { name: 'Ordner hinzufügen' }).click()
        const z = await waitFor(async () => {
          const s = await api.zustand()
          const [o] = s.folders
          return o?.status === 'bereit' && o.count === erwartet && s.metaPending === 0 ? s : null
        }, 60_000)
        assert.ok(z, `nicht fertig: ${JSON.stringify(await api.zustand())}`)
        const alle = await liste('name')
        assert.equal(alle.length, erwartet)
        assert.ok(
          alle.every((b) => b.metaRead),
          'nicht alle Metadaten gelesen'
        )
        for (const b of alle) zeilenUeber.set(b.name, b)
        // ExifTool läuft (Gegenprobe für die Prüfung nach dem Beenden)
        if (process.platform === 'win32') prozesseWaehrend = exiftoolProzesse()
      }
    ],
    [
      'Format nach Inhalt und aufgerichtete Maße für jedes Bild',
      async () => {
        const fehler = []
        for (const e of bilder) {
          const b = zeilenUeber.get(name(e))
          if (!b) {
            fehler.push(`${e.datei}: fehlt`)
            continue
          }
          if (b.format !== e.format) fehler.push(`${e.datei}: Format ${b.format} statt ${e.format}`)
          if (b.width !== e.breite || b.height !== e.hoehe)
            fehler.push(`${e.datei}: ${b.width}×${b.height} statt ${e.breite}×${e.hoehe}`)
          if (e.ausrichtung && b.orientation !== e.ausrichtung)
            fehler.push(`${e.datei}: Ausrichtung ${b.orientation}`)
          if (e.kamera && b.cameraModel !== e.kamera.modell)
            fehler.push(`${e.datei}: Kamera ${b.cameraModel}`)
        }
        assert.deepEqual(fehler, [])
        // PNG mit Endung .jpg: Format png, Endung bleibt jpg
        assert.equal(zeilenUeber.get('png-als.jpg').ext, 'jpg')
        assert.equal(zeilenUeber.get('ausrichtung-6.jpg').width, 300)
      }
    ],
    [
      'Aufnahmedatum: EXIF mit Zeitzone; ohne Datum die Dateizeit; kaputte Dateien ohne Absturz',
      async () => {
        const fehler = []
        for (const e of bilder) {
          const b = zeilenUeber.get(name(e))
          if (e.aufnahme) {
            if (b.takenAt !== e.aufnahme.lokal || b.takenSource !== 'exif')
              fehler.push(`${e.datei}: ${b.takenAt} (${b.takenSource})`)
            if (b.takenOffset !== (e.aufnahme.offset ?? null))
              fehler.push(`${e.datei}: Zone ${b.takenOffset}`)
          } else if (!b.takenSource.startsWith('datei-')) {
            fehler.push(`${e.datei}: Quelle ${b.takenSource} ohne Datum in der Datei`)
          }
        }
        assert.deepEqual(fehler, [])
        assert.equal(zeilenUeber.get('dubrovnik.jpg').takenOffset, '+02:00')
        for (const e of bib.manifest.eintraege.filter((x) => x.art === 'defekt')) {
          const b = zeilenUeber.get(name(e))
          assert.ok(b?.metaRead, `${e.datei} nicht als gelesen markiert`)
          assert.match(b.takenAt, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d$/)
        }
      }
    ],
    [
      'Name: natürlich, ohne Groß/Klein, Umlaute richtig',
      async () => {
        const n = (await liste('name')).map((b) => b.name)
        const vor = (a, b) =>
          assert.ok(n.indexOf(a) < n.indexOf(b), `„${a}“ nicht vor „${b}“: ${n.join(' | ')}`)
        vor('-rf.jpg', 'bild 1.jpg')
        vor('bild 1.jpg', 'Bild 2.jpg')
        vor('Bild 2.jpg', 'Bild 10.jpg')
        vor('Sonne 🌞.jpg', 'Übersicht äöü ß.jpg')
      }
    ],
    [
      'Aufnahmedatum: Kameradaten in der erwarteten Reihenfolge, Zeiten aufsteigend',
      async () => {
        const l = await liste('aufnahme')
        const zeiten = l.map((b) => b.takenAt)
        assert.deepEqual(zeiten, [...zeiten].sort(), 'Aufnahmezeiten nicht aufsteigend')
        const mitDatum = bilder.filter((e) => e.aufnahme)
        const erwarteteFolge = [...mitDatum]
          .sort((a, b) => (a.aufnahme.lokal < b.aufnahme.lokal ? -1 : 1))
          .map(name)
        const menge = new Set(erwarteteFolge)
        assert.deepEqual(
          l.map((b) => b.name).filter((x) => menge.has(x)),
          erwarteteFolge
        )
      }
    ],
    [
      'Änderungsdatum und Größe aufsteigend; Typ nach Endung gruppiert',
      async () => {
        const mtimes = (await liste('geaendert')).map((b) => b.mtime)
        assert.deepEqual(
          mtimes,
          [...mtimes].sort((a, b) => a - b)
        )
        const groessen = (await liste('groesse')).map((b) => b.size)
        assert.deepEqual(
          groessen,
          [...groessen].sort((a, b) => a - b)
        )
        const endungen = (await liste('typ')).map((b) => b.ext)
        assert.deepEqual(endungen, [...endungen].sort(), 'Endungen nicht gruppiert/aufsteigend')
        assert.ok(new Set(endungen).size > 4)
      }
    ],
    [
      'Absteigend ist genau aufsteigend rückwärts (jedes Feld)',
      async () => {
        for (const feld of FELDER) {
          const auf = await api.query(feld, 'auf')
          assert.deepEqual(await api.query(feld, 'ab'), [...auf].reverse(), feld)
        }
      }
    ],
    [
      'Ungültige Anfragen werden im main abgelehnt',
      async () => {
        for (const s of [{ feld: 'id; DROP TABLE images', richtung: 'auf' }, { feld: 'name' }]) {
          await assert.rejects(
            ctx.page.evaluate((x) => window.api.library.query(x), s),
            /Sortierung/
          )
        }
        await assert.rejects(
          ctx.page.evaluate(() =>
            window.api.library.details(Array.from({ length: 1001 }, (_, i) => i + 1))
          ),
          /Kennungen/
        )
        await assert.rejects(
          ctx.page.evaluate(() => window.api.library.details(['1'])),
          /Kennung/
        )
      }
    ],
    [
      'Oberfläche: „Sortieren nach“ und Richtung ändern die Reihenfolge der Kacheln',
      async () => {
        const auswahl = ctx.page.getByRole('combobox', { name: 'Sortieren nach' })
        assert.equal(await auswahl.inputValue(), 'aufnahme')
        const nachDatum = (await liste('aufnahme')).map((b) => b.name)
        assert.ok(await waitFor(async () => (await tabelle())[0] === nachDatum[0], 10_000))
        await auswahl.selectOption('name')
        const nachName = (await liste('name')).map((b) => b.name)
        assert.ok(
          await waitFor(() => zeigtAnfang(nachName), 5_000),
          `Tabelle: ${(await tabelle()).slice(0, 5).join(' | ')}`
        )
        const richtung = ctx.page.getByRole('button', { name: 'Absteigend' })
        assert.equal(await richtung.getAttribute('aria-pressed'), 'false')
        await richtung.click()
        assert.ok(
          await waitFor(async () => (await tabelle())[0] === nachName.at(-1), 5_000),
          `Tabelle: ${(await tabelle()).slice(0, 5).join(' | ')}`
        )
      }
    ],
    [
      'Sortierung bleibt nach dem Neuladen',
      async () => {
        await ctx.page.reload()
        const auswahl = ctx.page.getByRole('combobox', { name: 'Sortieren nach' })
        await auswahl.waitFor({ timeout: 10_000 })
        assert.equal(await auswahl.inputValue(), 'name')
        assert.equal(
          await ctx.page.getByRole('button', { name: 'Absteigend' }).getAttribute('aria-pressed'),
          'true'
        )
        const ab = (await liste('name', 'ab')).map((b) => b.name)
        assert.ok(await waitFor(async () => (await tabelle())[0] === ab[0], 10_000))
      }
    ],
    [
      'Weitere Metadaten (2.1): Objektiv, Belichtung, GPS, Bewertung, Texte, Stichwörter wie in der Datei',
      async () => {
        const fehler = []
        for (const e of bilder) {
          const b = zeilenUeber.get(name(e))
          const soll = {
            gps: e.gps ? [e.gps.lat, e.gps.lon] : null,
            rating: e.bewertung ?? null,
            title: e.titel ?? null,
            description: e.beschreibung ?? null,
            colorLabel: e.farblabel ?? null,
            lens: e.objektiv ?? null,
            keywords: [
              ...new Set([...(e.stichwoerter ?? []), ...(e.iptcStichwoerter ?? [])])
            ].sort()
          }
          const ist = {
            gps: b.gps ? [b.gps.lat, b.gps.lon].map((x) => Math.round(x * 1e4) / 1e4) : null,
            rating: b.rating,
            title: b.title,
            description: b.description,
            colorLabel: b.colorLabel,
            lens: b.lens,
            keywords: [...b.keywords].sort()
          }
          if (JSON.stringify(ist) !== JSON.stringify(soll))
            fehler.push(`${e.datei}: ${JSON.stringify(ist)} statt ${JSON.stringify(soll)}`)
        }
        assert.deepEqual(fehler, [])
        const d = zeilenUeber.get('dubrovnik.jpg')
        assert.deepEqual([d.aperture, d.exposure, d.iso, d.focal], [8, 0.004, 100, 35])
        // XMP und IPTC zusammengeführt, „Weihnachten“ nur einmal
        assert.deepEqual([...zeilenUeber.get('muenchen.jpg').keywords].sort(), [
          'Familie',
          'Weihnachten',
          'Winter'
        ])
      }
    ],
    [
      'Orte (2.2): nächster Ort aus GPS (deutsch); nach Ort A–Z, ohne Standort am Ende – auch absteigend',
      async () => {
        const ort = (e) => zeilenUeber.get(name(e)).place
        for (const e of bilder.filter((x) => x.gps)) {
          assert.deepEqual(ort(e), { name: e.gps.ort, country: e.gps.land, source: 'gps' }, e.datei)
        }
        const mitOrt = ['dubrovnik.jpg', 'muenchen.jpg', 'paris.jpg', 'paris-texas.jpg']
        const ohne = bilder.filter((e) => !e.gps).map(name)
        const auf = (await liste('ort', 'auf')).map((b) => b.name)
        assert.deepEqual(auf.slice(0, 4), mitOrt)
        const ab = (await liste('ort', 'ab')).map((b) => b.name)
        assert.deepEqual(ab.slice(0, 4), [...mitOrt].reverse())
        // ohne Standort immer am Ende (in beiden Richtungen), innerhalb nach Aufnahme
        for (const r of [auf, ab]) {
          assert.deepEqual(new Set(r.slice(4)), new Set([...ohne, ...defektNamen]))
        }
        const imRaster = await ctx.page
          .getByRole('combobox', { name: 'Sortieren nach' })
          .selectOption('ort')
        assert.deepEqual(imRaster, ['ort'])
      }
    ],
    [
      'Info-Panel im Betrachter: Felder lesbar, „Alle Felder“ frisch aus der Datei',
      async () => {
        await ctx.page.getByRole('combobox', { name: 'Sortieren nach' }).selectOption('name')
        // das Raster baut sich nach dem Wechsel neu auf: warten, bis vorn das erste nach Name steht
        const ab =
          (await ctx.page
            .getByRole('button', { name: 'Absteigend' })
            .getAttribute('aria-pressed')) === 'true'
        const erstes = (await liste('name', ab ? 'ab' : 'auf'))[0].name
        assert.ok(
          await waitFor(
            async () =>
              (await ctx.page
                .getByRole('listbox', { name: 'Bilder' })
                .getByRole('option')
                .first()
                .getAttribute('aria-label')
                .catch(() => null)) === erstes,
            5_000
          ),
          'Raster zeigt die Sortierung nach Name nicht'
        )
        const kachel = ctx.page
          .getByRole('listbox', { name: 'Bilder' })
          .getByRole('option', { name: 'dubrovnik.jpg', exact: true })
        await kachel.scrollIntoViewIfNeeded()
        await kachel.dblclick()
        const betrachter = ctx.page.getByRole('dialog', { name: 'Betrachter' })
        await betrachter.waitFor({ timeout: 5_000 })
        await betrachter.getByRole('button', { name: 'Info' }).click()
        const info = betrachter.getByRole('complementary', { name: 'Informationen zum Bild' })
        await info.waitFor({ timeout: 3_000 })
        const text = await info.innerText()
        for (const erwartet of [
          'Altstadt am Abend',
          'Blick über die Stadtmauer',
          'Galeria 35mm F1.8',
          'f/8 · 1/250 s · ISO 100 · 35 mm',
          '42,6507° N, 18,0944° O',
          'Urlaub',
          'Rot' // Farblabel „Red“ auf Deutsch
        ]) {
          assert.ok(
            text.includes(erwartet),
            `fehlt im Info-Panel: ${erwartet}
${text}`
          )
        }
        await info.getByLabel('5 von 5 Sternen').waitFor({ timeout: 2_000 })
        await info.getByRole('button', { name: 'Alle Felder' }).click()
        const anzahl = info.getByLabel('Anzahl der Felder')
        await anzahl.waitFor({ timeout: 10_000 })
        assert.ok(parseInt((await anzahl.innerText()).replace('.', ''), 10) > 20)
        await info.getByRole('searchbox', { name: 'Feld suchen' }).fill('LensModel')
        assert.ok((await info.innerText()).includes('Galeria 35mm F1.8'))
        // keine Pfade im Panel (der Ordner der Testbibliothek)
        assert.ok(!(await info.innerText()).includes(bib.dir), 'Pfad im Info-Panel')
        // im Suchfeld gilt Esc dem Feld – erst heraus, dann schließen
        await info.getByRole('searchbox', { name: 'Feld suchen' }).blur()
        await ctx.page.keyboard.press('Escape')
        await betrachter.waitFor({ state: 'detached', timeout: 3_000 })
      }
    ],
    [
      'Statusleiste ohne „liest Metadaten“, wenn alles gelesen ist',
      async () => {
        assert.equal(await ctx.page.getByText(/liest Metadaten/).count(), 0)
      }
    ],
    [
      'keine Konsolenfehler im Hauptfenster',
      async () => {
        assert.deepEqual(ctx.errors, [])
      }
    ]
  ])
} finally {
  await ctx.close()
}

try {
  await runSteps('Sortieren – nach dem Beenden', [
    [
      'kein ExifTool-Prozess bleibt zurück',
      async () => {
        if (process.platform !== 'win32') throw new Skip('nur unter Windows geprüft')
        assert.deepEqual(prozesseVorher, [], 'schon vor dem Start lief ein ExifTool')
        assert.ok(prozesseWaehrend.length > 0, 'während des Laufs lief kein ExifTool (Gegenprobe)')
        const rest = await waitFor(async () => {
          const p = exiftoolProzesse()
          return p.length === 0 ? [] : null
        }, 10_000)
        if (!rest) {
          const p = exiftoolProzesse()
          // aufräumen, damit der nächste Lauf nicht scheitert
          for (const z of p) {
            try {
              process.kill(Number.parseInt(z, 10))
            } catch {
              /* schon weg */
            }
          }
          await sleep(200)
          assert.fail(
            `ExifTool läuft nach dem Beenden weiter: ${p.join(', ')}; App gestartet ${startZeit}, ` +
              `während des Laufs: ${prozesseWaehrend.join(', ')}`
          )
        }
      }
    ]
  ])
} finally {
  bib.aufraeumen()
}
