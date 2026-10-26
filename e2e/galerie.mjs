// Bibliothek in der echten App (Phase 1.1, 1.3): Ordner hinzufügen über den Dialog des main,
// Einlesen im Bilddienst, Ablehnung überlappender Ordner, Modus, Vorschaubilder (thumb://,
// verschlüsselter Cache, „privat“ nur im Speicher), Abgleich nach Änderungen von außen, Neustart
// mit vorhandenem Index und Cache, Entfernen mit Rückfrage (keine Reste). Testbibliothek aus
// scripts/testbilder.mjs.

import assert from 'node:assert/strict'
import { copyFileSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { QUADRANTEN } from '../scripts/testbilder.mjs'
import {
  erwarteteBilder,
  launchApp,
  runSteps,
  stubConfirmSequence,
  stubOrdnerDialog,
  testbibliothek,
  waitFor
} from './harness.mjs'

const bib = await testbibliothek()
const erwartet = erwarteteBilder(bib.manifest)
// eigener Benutzerordner, damit ein Neustart ihn wiederverwenden kann
const userData = mkdtempSync(join(tmpdir(), 'galeria-e2e-'))
let ctx = await launchApp({ userData })

const zustand = () => ctx.page.evaluate(() => window.api.library.state())
const ordner = async () => (await zustand()).folders
/** Wartet, bis der (einzige) Ordner fertig eingelesen ist und `pruef` stimmt. */
async function eingelesen(pruef = () => true, ms = 30_000) {
  const f = await waitFor(async () => {
    const [o] = await ordner()
    return o && o.status === 'bereit' && o.lastScan && pruef(o) ? o : null
  }, ms)
  assert.ok(f, `nicht fertig eingelesen: ${JSON.stringify(await ordner())}`)
  return f
}
/** Alle Bilder mit Details (über die Brücke, wie die Oberfläche) */
const alleBilder = () =>
  ctx.page.evaluate(async () =>
    window.api.library.details(await window.api.library.query({ feld: 'name', richtung: 'auf' }))
  )
/** Vorschau über thumb:// holen – im main: net.fetch geht durch denselben Handler wie die Seite */
const thumb = async (id, stufe) => {
  const r = await ctx.app.evaluate(async ({ net }, url) => {
    const a = await net.fetch(url)
    return {
      status: a.status,
      typ: a.headers.get('content-type'),
      daten: Buffer.from(await a.arrayBuffer()).toString('base64')
    }
  }, `thumb://id/${id}/${stufe}`)
  return { ...r, daten: Buffer.from(r.daten, 'base64') }
}
/** Dateien des Vorschau-Caches im lokalen Datenordner des Laufs */
const cacheDateien = () =>
  readdirSync(join(userData, 'lokal'), { recursive: true })
    .map(String)
    .filter((p) => p.endsWith('.gbv'))
    .map((p) => join(userData, 'lokal', p))
const defektErwartet = bib.manifest.eintraege
  .filter((e) => e.art === 'defekt')
  .map((e) => e.datei.split('/').pop())
  .sort()

const menue = async (eintrag) => {
  await ctx.page.getByRole('button', { name: 'Aktionen für „bib“' }).click()
  await ctx.page
    .getByRole('menu')
    .getByRole(eintrag.rolle ?? 'menuitem', { name: eintrag.name })
    .click()
}

try {
  await runSteps('Galerie – Bibliothek', [
    [
      'Leere Galerie bietet „Ordner hinzufügen“',
      async () => {
        await ctx.page
          .getByRole('heading', { name: 'Noch keine Ordner' })
          .waitFor({ timeout: 15_000 })
        assert.deepEqual(await ordner(), [])
      }
    ],
    [
      `Ordner hinzufügen: Dialog im main, ${erwartet} Bilder eingelesen (Videos und Sonstiges nicht)`,
      async () => {
        await stubOrdnerDialog(ctx.app, bib.dir)
        await ctx.page.getByRole('main').getByRole('button', { name: 'Ordner hinzufügen' }).click()
        const o = await eingelesen((x) => x.count === erwartet)
        assert.equal(o.name, 'bib')
        assert.equal(o.missing, 0)
        assert.equal(o.mode, 'normal')
        // der Dialog fragte nach einem Ordner
        const opts = await ctx.app.evaluate(() => globalThis.__ordnerDialog)
        assert.deepEqual(opts.properties, ['openDirectory'])
        await ctx.page.getByRole('listitem', { name: 'bib' }).waitFor({ timeout: 5_000 })
        await ctx.page
          .getByRole('heading', { name: `${erwartet} Bilder` })
          .waitFor({ timeout: 5_000 })
      }
    ],
    [
      'Vorschaubilder erscheinen (thumb://), aufgerichtet; kaputte Dateien gelten als defekt',
      async () => {
        assert.ok(
          await waitFor(async () => (await zustand()).thumbPending === 0, 50_000),
          `noch offen: ${(await zustand()).thumbPending}`
        )
        // in der Tabelle geladen (nicht nur das Element da)
        const geladen = await waitFor(async () => {
          const n = await ctx.page.$$eval(
            'table[aria-label="Bilder"] tbody img',
            (imgs) => imgs.filter((i) => i.complete && i.naturalWidth > 0).length
          )
          return n >= 5 ? n : null
        }, 15_000)
        assert.ok(geladen, 'keine Vorschaubilder in der Tabelle')
        const bilder = await alleBilder()
        // Ausrichtung 6 (gespeichert gedreht): aufgerichtet 256 × 171, Motiv richtig herum
        const a6 = bilder.find((b) => b.name === 'ausrichtung-6.jpg')
        const r = await thumb(a6.id, 256)
        assert.equal(r.status, 200)
        assert.equal(r.typ, 'image/jpeg')
        const { data, info } = await sharp(r.daten).raw().toBuffer({ resolveWithObject: true })
        assert.deepEqual([info.width, info.height], [256, 171])
        const px = (fx, fy) => {
          const o = (Math.floor(fy * info.height) * info.width + Math.floor(fx * info.width)) * 3
          return [data[o], data[o + 1], data[o + 2]]
        }
        const nah = (ist, soll) => ist.every((v, i) => Math.abs(v - soll[i]) <= 40)
        for (const [ecke, fx, fy] of [
          ['obenLinks', 0.25, 0.25],
          ['obenRechts', 0.75, 0.25],
          ['untenLinks', 0.25, 0.75],
          ['untenRechts', 0.75, 0.75]
        ]) {
          assert.ok(nah(px(fx, fy), QUADRANTEN[ecke]), `${ecke}: ${px(fx, fy)}`)
        }
        // 768 = längste Kante (Bild 640 × 480 bleibt 640: nie vergrößert)
        const d = bilder.find((b) => b.name === 'dubrovnik.jpg')
        const gross = await sharp((await thumb(d.id, 768)).daten).metadata()
        assert.deepEqual([gross.width, gross.height], [640, 480])
        // kaputte Dateien: defekt, kein Vorschaubild; alle anderen mit Platzhalterfarbe
        assert.deepEqual(
          bilder
            .filter((b) => b.status === 'defekt')
            .map((b) => b.name)
            .sort(),
          defektErwartet
        )
        // bekannt, aber ohne Vorschau: 204 (kein Konsolenfehler in der Seite), unbekannt wäre 404
        const kaputt = bilder.find((b) => b.status === 'defekt')
        assert.equal((await thumb(kaputt.id, 256)).status, 204)
        const ohneFarbe = bilder.filter((b) => b.status === 'ok' && !/^#[0-9a-f]{6}$/.test(b.color))
        assert.deepEqual(ohneFarbe, [])
      }
    ],
    [
      'Cache nur verschlüsselt: keine JPEG-/WebP-Signatur, nichts im Roaming-Profil',
      async () => {
        const dateien = cacheDateien()
        assert.equal(dateien.length, 2 * (erwartet - defektErwartet.length))
        for (const f of dateien) {
          const b = readFileSync(f)
          assert.equal(b.subarray(0, 4).toString('latin1'), 'GBV1', f)
          assert.ok(!b.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff])), f)
          for (const marke of ['JFIF', 'Exif', 'WEBP', 'RIFF']) {
            assert.ok(!b.includes(marke, 0, 'latin1'), `${marke} in ${f}`)
          }
        }
        // im lokalen Datenordner, nicht in userData (Roaming)
        assert.ok(
          !readdirSync(userData, { recursive: true })
            .map(String)
            .some((p) => p.endsWith('.gbv') && !p.startsWith('lokal'))
        )
      }
    ],
    [
      'Unterordner eines Bibliotheksordners wird mit Hinweis abgelehnt',
      async () => {
        await stubOrdnerDialog(ctx.app, join(bib.dir, 'orte'))
        await ctx.page
          .getByRole('navigation', { name: 'Ordner' })
          .getByRole('button', { name: 'Ordner hinzufügen' })
          .click()
        await ctx.page.getByText('liegt schon in „bib“').waitFor({ timeout: 5_000 })
        assert.equal((await ordner()).length, 1)
        await ctx.page.getByRole('button', { name: 'Hinweis schließen' }).click()
      }
    ],
    [
      'Abbrechen im Dialog ändert nichts',
      async () => {
        await stubOrdnerDialog(ctx.app, null)
        await ctx.page
          .getByRole('navigation', { name: 'Ordner' })
          .getByRole('button', { name: 'Ordner hinzufügen' })
          .click()
        await waitFor(
          async () =>
            !(await ctx.page
              .getByRole('navigation', { name: 'Ordner' })
              .getByRole('button', { name: 'Ordner hinzufügen' })
              .isDisabled()),
          5_000
        )
        assert.equal((await ordner()).length, 1)
        assert.equal(await ctx.page.getByRole('status').count(), 0)
      }
    ],
    [
      'Modus „Nur lesen“ über das Menü (Menü liegt ganz im Fenster)',
      async () => {
        await ctx.page.getByRole('button', { name: 'Aktionen für „bib“' }).click()
        // ganz sichtbar: im Fenster UND nicht von einem Scrollbereich abgeschnitten – an allen vier
        // Ecken (etwas nach innen) liegt das Menü selbst obenauf
        const sichtbar = await ctx.page.getByRole('menu').evaluate((m) => {
          const r = m.getBoundingClientRect()
          const ecken = [
            [r.left + 4, r.top + 4],
            [r.right - 4, r.top + 4],
            [r.left + 4, r.bottom - 4],
            [r.right - 4, r.bottom - 4]
          ]
          const imFenster =
            r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight
          return {
            imFenster,
            ecken: ecken.map(([x, y]) => m.contains(document.elementFromPoint(x, y)))
          }
        })
        assert.deepEqual(sichtbar, { imFenster: true, ecken: [true, true, true, true] })
        await ctx.page.keyboard.press('Escape')
        await menue({ rolle: 'menuitemradio', name: /^Nur lesen/ })
        assert.ok(await waitFor(async () => (await ordner())[0].mode === 'nur-lesen', 5_000))
        await ctx.page
          .getByRole('listitem', { name: 'bib' })
          .getByText('nur lesen')
          .waitFor({ timeout: 5_000 })
      }
    ],
    [
      'Modus „privat“: Cache-Dateien sofort weg, Vorschau aus dem Arbeitsspeicher, Platte bleibt leer',
      async () => {
        const vorher = cacheDateien().length
        assert.ok(vorher > 0)
        const [o] = await ordner()
        const modus = (m) =>
          ctx.page.evaluate(([id, mm]) => window.api.library.setFolderMode(id, mm), [o.id, m])
        await modus('privat')
        assert.deepEqual(cacheDateien(), [])
        const d = (await alleBilder()).find((b) => b.name === 'dubrovnik.jpg')
        const r = await thumb(d.id, 768)
        assert.equal(r.status, 200)
        assert.deepEqual(
          [(await sharp(r.daten).metadata()).width, (await thumb(d.id, 256)).status],
          [640, 200]
        )
        // die Tabelle zeigt weiter Bilder – aus dem Speicher
        await ctx.page.reload()
        assert.ok(
          await waitFor(async () => {
            const n = await ctx.page.$$eval(
              'table[aria-label="Bilder"] tbody img',
              (imgs) => imgs.filter((i) => i.complete && i.naturalWidth > 0).length
            )
            return n >= 5
          }, 30_000),
          'keine Vorschaubilder aus dem Speicher'
        )
        assert.deepEqual(cacheDateien(), [], 'unter „privat“ entstand etwas auf der Platte')
        // zurück auf „nur lesen“: der Cache entsteht neu
        await modus('nur-lesen')
        assert.ok(
          await waitFor(
            async () => (await zustand()).thumbPending === 0 && cacheDateien().length === vorher,
            50_000
          ),
          `Cache nicht neu angelegt: ${cacheDateien().length} von ${vorher}`
        )
      }
    ],
    [
      'Datei von außen dazu, eine weg: „Neu einlesen“ gleicht ab (1 fehlt)',
      async () => {
        copyFileSync(join(bib.dir, 'orte', 'muenchen.jpg'), join(bib.dir, 'neu von außen.jpg'))
        rmSync(join(bib.dir, 'orte', 'paris.jpg'))
        const vorher = (await ordner())[0].lastScan
        await menue({ name: 'Neu einlesen' })
        await eingelesen((o) => o.lastScan > vorher && o.count === erwartet && o.missing === 1)
        await ctx.page
          .getByRole('listitem', { name: 'bib' })
          .getByText('1 fehlt')
          .waitFor({ timeout: 5_000 })
      }
    ],
    [
      'Neustart: Ordner, Anzahl, Modus bleiben; der Index liegt im lokalen Datenordner',
      async () => {
        const vorher = await ordner()
        // Vorschaubilder überstehen den Neustart (Schlüssel per safeStorage): nichts neu erzeugt
        assert.ok(await waitFor(async () => (await zustand()).thumbPending === 0, 30_000))
        const stempel = new Map(cacheDateien().map((f) => [f, statSync(f).mtimeMs]))
        await ctx.close()
        ctx = await launchApp({ userData })
        await ctx.page.getByRole('listitem', { name: 'bib' }).waitFor({ timeout: 15_000 })
        const o = await eingelesen()
        assert.deepEqual(
          [o.path, o.count, o.missing, o.mode],
          [vorher[0].path, vorher[0].count, vorher[0].missing, vorher[0].mode]
        )
        const liste = readdirSync(join(userData, 'lokal'), { recursive: true }).map(String)
        assert.ok(
          liste.some((p) => /index[\\/]galerie\.db$/.test(p)),
          `kein Index unter lokal/: ${liste.join(', ')}`
        )
        // nicht im Roaming-Profil
        assert.ok(!readdirSync(userData).includes('galerie.db'))
        const d = (await alleBilder()).find((b) => b.name === 'dubrovnik.jpg')
        assert.equal((await thumb(d.id, 256)).status, 200)
        assert.ok(await waitFor(async () => (await zustand()).thumbPending === 0, 30_000))
        assert.deepEqual(
          new Map(cacheDateien().map((f) => [f, statSync(f).mtimeMs])),
          stempel,
          'Cache nach dem Neustart neu erzeugt (Schlüssel verloren?)'
        )
      }
    ],
    [
      'Entfernen fragt nach; „Abbrechen“ behält, „Entfernen“ entfernt – die Dateien bleiben',
      async () => {
        const dateienVorher = readdirSync(bib.dir, { recursive: true }).length
        await stubConfirmSequence(ctx.app, [1, 0])
        await menue({ name: /Aus der Galerie entfernen/ })
        await new Promise((r) => setTimeout(r, 500))
        assert.equal((await ordner()).length, 1)
        await menue({ name: /Aus der Galerie entfernen/ })
        assert.ok(await waitFor(async () => (await ordner()).length === 0, 5_000))
        await ctx.page
          .getByRole('heading', { name: 'Noch keine Ordner' })
          .waitFor({ timeout: 5_000 })
        assert.equal((await zustand()).total, 0)
        // keine Reste: auch die Vorschaubilder sind weg (Schicht D)
        assert.deepEqual(cacheDateien(), [])
        assert.equal(readdirSync(bib.dir, { recursive: true }).length, dateienVorher)
        assert.ok(statSync(join(bib.dir, 'neu von außen.jpg')).isFile())
      }
    ],
    [
      'Log ohne Inhalte: keine Koordinate, kein Titel, kein Stichwort, kein Dateiname',
      async () => {
        const log = readFileSync(join(userData, 'galeria-debug.log'), 'utf8')
        assert.match(log, /\[vorschau\]/, 'Gegenprobe: das Log enthält die Arbeit dieses Laufs')
        const verboten = [
          ...Object.values(bib.manifest.orte).flatMap((o) => [o.lat.toFixed(3), o.lon.toFixed(3)]),
          'Altstadt am Abend',
          'Tour Eiffel',
          'Weihnachten',
          'dubrovnik',
          'ausrichtung-6',
          'Übersicht'
        ]
        assert.deepEqual(
          verboten.filter((v) => log.includes(v)),
          []
        )
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
  rmSync(userData, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  bib.aufraeumen()
}
