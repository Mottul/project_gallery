// Überwachen in der echten App (Phase 1.6): Änderungen von außen erscheinen ohne „Neu einlesen“ –
// neue, geänderte und gelöschte Dateien, ein umbenannter Unterordner (Bilder behalten Kennung und
// Vorschaubild), viele Dateien auf einmal; Versteckte bleiben draußen. Der Bibliotheksordner selbst
// verschwindet und kommt wieder (Fokus). Ein Ordner über einen UNC-Pfad (Netzlaufwerk, Windows:
// \\localhost\<Laufwerk>$, falls erreichbar) wird nicht überwacht, sondern periodisch abgeglichen.
// Log ohne Dateinamen. Testbibliothek aus scripts/testbilder.mjs.

import assert from 'node:assert/strict'
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import {
  erwarteteBilder,
  launchApp,
  runSteps,
  sleep,
  Skip,
  stubOrdnerDialog,
  testbibliothek,
  waitFor
} from './harness.mjs'

sharp.cache({ files: 0 })
const bib = await testbibliothek()
const erwartet = erwarteteBilder(bib.manifest)
const userData = mkdtempSync(join(tmpdir(), 'galeria-e2e-'))
const ctx = await launchApp({ userData })
const { app, page } = ctx

const zustand = () => page.evaluate(() => window.api.library.state())
const bibOrdner = async () => (await zustand()).folders.find((f) => f.path === bib.dir)
const alleBilder = () =>
  page.evaluate(async () =>
    window.api.library.details(await window.api.library.query({ feld: 'name', richtung: 'auf' }))
  )
const bildNamens = async (name) => (await alleBilder()).find((b) => b.name === name)
/** Vorschaubild über thumb:// im main (derselbe Handler wie die Seite) */
const thumb = (id) =>
  app.evaluate(async ({ net }, url) => {
    const a = await net.fetch(url)
    return { status: a.status, daten: Buffer.from(await a.arrayBuffer()).toString('base64') }
  }, `thumb://id/${id}/256`)
const cacheDateien = () =>
  readdirSync(join(userData, 'lokal'), { recursive: true })
    .map(String)
    .filter((p) => p.endsWith('.gbv'))
    .map((p) => join(userData, 'lokal', p))
/** Fenster bekommt den Fokus (wie beim Zurückwechseln in die App) */
const fokus = () =>
  app.evaluate(({ app: a, BrowserWindow }) =>
    a.emit('browser-window-focus', {}, BrowserWindow.getAllWindows()[0])
  )
const fertig = async (pruef = () => true, ms = 30_000) => {
  const o = await waitFor(async () => {
    const z = await zustand()
    const f = z.folders.find((x) => x.path === bib.dir)
    return f && f.status === 'bereit' && z.thumbPending === 0 && z.metaPending === 0 && pruef(f)
      ? f
      : null
  }, ms)
  assert.ok(o, `nicht so weit: ${JSON.stringify(await bibOrdner())}`)
  return o
}
const einfarbig = (farbe) =>
  sharp({ create: { width: 64, height: 48, channels: 3, background: farbe } }).jpeg()

let netzDir = null

try {
  await runSteps('Überwachen', [
    [
      'Ordner hinzugefügt: eingelesen und live überwacht',
      async () => {
        await page.getByRole('heading', { name: 'Noch keine Ordner' }).waitFor({ timeout: 15_000 })
        await stubOrdnerDialog(app, bib.dir)
        await page.getByRole('main').getByRole('button', { name: 'Ordner hinzufügen' }).click()
        const o = await fertig((f) => f.count === erwartet, 60_000)
        assert.equal(o.watch, 'live')
      }
    ],
    [
      'Datei von außen dazu: erscheint mit Vorschaubild, ohne „Neu einlesen“',
      async () => {
        const vorher = (await bibOrdner()).lastScan
        await einfarbig('#ff0000').toFile(join(bib.dir, 'neu von außen.jpg'))
        await fertig((f) => f.count === erwartet + 1)
        const b = await bildNamens('neu von außen.jpg')
        assert.ok(b, 'neue Datei nicht im Index')
        assert.equal((await thumb(b.id)).status, 200)
        assert.match(b.color, /^#f[0-9a-f]0[0-9a-f]0[0-9a-f]$/i, `Farbe ${b.color}`)
        // ein Teil-Abgleich, kein ganzer
        assert.equal((await bibOrdner()).lastScan, vorher)
        // die Oberfläche zieht nach (das Raster ist virtualisiert – die neue Datei kann unten
        // stehen, die Statusleiste zählt alle)
        await page
          .locator('footer')
          .getByText(`${erwartet + 1} Bilder`, { exact: true })
          .waitFor({ timeout: 5_000 })
      }
    ],
    [
      'Datei von außen geändert: gleiche Kennung, neues Vorschaubild',
      async () => {
        const vorher = await bildNamens('neu von außen.jpg')
        const altesBild = (await thumb(vorher.id)).daten
        await einfarbig('#0000ff').toFile(join(bib.dir, 'neu von außen.jpg'))
        const b = await waitFor(async () => {
          const x = await bildNamens('neu von außen.jpg')
          return x && x.mtime !== vorher.mtime && /^#0[0-9a-f]0[0-9a-f]f/i.test(x.color ?? '')
            ? x
            : null
        }, 20_000)
        assert.ok(b, `nicht neu gelesen: ${JSON.stringify(await bildNamens('neu von außen.jpg'))}`)
        assert.equal(b.id, vorher.id)
        assert.notEqual((await thumb(b.id)).daten, altesBild)
      }
    ],
    [
      'Datei von außen gelöscht: verschwindet, „1 fehlt“',
      async () => {
        rmSync(join(bib.dir, 'neu von außen.jpg'))
        await fertig((f) => f.count === erwartet && f.missing === 1)
        await page
          .getByRole('treeitem', { name: 'bib', exact: true })
          .getByText('1 fehlt')
          .waitFor({ timeout: 5_000 })
      }
    ],
    [
      'Unterordner umbenannt: Bilder behalten Kennung und Vorschaubild, nichts fehlt dazu',
      async () => {
        const vorher = (await alleBilder()).filter((b) =>
          ['dubrovnik.jpg', 'muenchen.jpg', 'paris.jpg'].includes(b.name)
        )
        assert.equal(vorher.length, 3)
        const cacheVorher = new Map(cacheDateien().map((f) => [f, statSync(f).mtimeMs]))
        renameSync(join(bib.dir, 'orte'), join(bib.dir, 'Orte 2024'))
        await page.getByRole('treeitem', { name: /Orte 2024/ }).waitFor({ timeout: 15_000 })
        const o = await fertig((f) => f.count === erwartet)
        assert.equal(o.missing, 1, 'umbenannte Bilder gelten als fehlend')
        const nachher = await alleBilder()
        for (const b of vorher) {
          assert.equal(nachher.find((x) => x.name === b.name)?.id, b.id, b.name)
        }
        // keine Vorschau neu erzeugt (der Cache ist unverändert)
        assert.deepEqual(new Map(cacheDateien().map((f) => [f, statSync(f).mtimeMs])), cacheVorher)
      }
    ],
    [
      '120 Dateien auf einmal hineinkopiert: alle da; Versteckte bleiben draußen',
      async () => {
        const quelle = join(bib.dir, 'Orte 2024', 'dubrovnik.jpg')
        mkdirSync(join(bib.dir, 'Stapel'))
        mkdirSync(join(bib.dir, '.versteckt'))
        writeFileSync(join(bib.dir, '.versteckt', 'x.jpg'), readFileSync(quelle))
        for (let i = 0; i < 120; i++) {
          writeFileSync(join(bib.dir, 'Stapel', `kopie-${i}.jpg`), readFileSync(quelle))
          if (i % 20 === 0) await sleep(10)
        }
        copyFileSync(quelle, join(bib.dir, '.versteckt', 'y.jpg'))
        await fertig((f) => f.count === erwartet + 120, 60_000)
        await sleep(1_000)
        assert.equal((await bibOrdner()).count, erwartet + 120)
      }
    ],
    [
      'Bibliotheksordner verschwindet: „nicht erreichbar“; wieder da und Fokus: abgeglichen, wieder live',
      async () => {
        const weg = `${bib.dir}-weg`
        const vorher = (await bibOrdner()).count
        renameSync(bib.dir, weg)
        try {
          await fokus()
          assert.ok(
            await waitFor(async () => (await bibOrdner())?.status === 'nicht-erreichbar', 15_000),
            JSON.stringify(await bibOrdner())
          )
          await page
            .getByRole('treeitem', { name: 'bib', exact: true })
            .getByText('nicht erreichbar')
            .waitFor({ timeout: 5_000 })
          // die Bilder bleiben im Index
          assert.equal((await bibOrdner()).count, vorher)
        } finally {
          renameSync(weg, bib.dir)
        }
        await fokus()
        const o = await fertig((f) => f.watch === 'live', 30_000)
        assert.equal(o.count, vorher)
        // und überwacht wieder
        await einfarbig('#00ff00').toFile(join(bib.dir, 'nach der Rückkehr.jpg'))
        await fertig((f) => f.count === vorher + 1)
      }
    ],
    [
      'Netzlaufwerk (UNC-Pfad): nicht überwacht, „Abgleich alle 5 min“',
      async () => {
        if (process.platform !== 'win32') throw new Skip('nur Windows')
        // derselbe Ordner wäre eine Überlappung – eine Kopie in einem eigenen Ordner
        const basis = mkdtempSync(join(tmpdir(), 'galeria-netz-'))
        mkdirSync(join(basis, 'netz'))
        copyFileSync(join(bib.dir, 'Orte 2024', 'paris.jpg'), join(basis, 'netz', 'p.jpg'))
        const lokal = join(basis, 'netz')
        const unc = `\\\\localhost\\${lokal[0]}$${lokal.slice(2)}`
        try {
          statSync(unc)
        } catch {
          rmSync(basis, { recursive: true, force: true })
          throw new Skip(`${unc} nicht erreichbar (Admin-Freigabe)`)
        }
        netzDir = basis
        await stubOrdnerDialog(app, unc)
        await page
          .getByRole('navigation', { name: 'Bibliothek und Ordner' })
          .getByRole('button', { name: 'Ordner hinzufügen' })
          .click()
        const f = await waitFor(async () => {
          const x = (await zustand()).folders.find((o) => o.path === unc)
          return x?.status === 'bereit' && x.count === 1 ? x : null
        }, 30_000)
        assert.ok(f, JSON.stringify((await zustand()).folders))
        assert.equal(f.watch, 'periodisch')
        await page
          .getByRole('treeitem', { name: 'netz', exact: true })
          .getByText('Abgleich alle 5 min')
          .waitFor({ timeout: 5_000 })
      }
    ],
    [
      'Log ohne Dateinamen; Teil-Abgleiche stehen darin',
      async () => {
        const log = readFileSync(join(userData, 'galeria-debug.log'), 'utf8')
        assert.match(log, /\[bibliothek\] Ordner \d+ abgeglichen \(\d+ Pfade\)/)
        assert.match(log, /verschoben/)
        for (const n of [
          'neu von außen',
          'Orte 2024',
          'kopie-',
          'nach der Rückkehr',
          'dubrovnik'
        ]) {
          assert.ok(!log.includes(n), `Log nennt „${n}“`)
        }
      }
    ],
    [
      'keine Konsolenfehler',
      async () => {
        assert.deepEqual(ctx.errors, [])
      }
    ]
  ])
} finally {
  await ctx.close()
  bib.aufraeumen()
  rmSync(userData, { recursive: true, force: true, maxRetries: 5 })
  if (netzDir) rmSync(netzDir, { recursive: true, force: true, maxRetries: 5 })
}
