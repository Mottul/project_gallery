// Bibliothek in der echten App (Phase 1.1–1.4): Ordner hinzufügen über den Dialog des main und per
// Drag & Drop, Einlesen im Bilddienst, Ablehnung überlappender Ordner, Modus, Vorschaubilder
// (thumb://, verschlüsselter Cache, „privat“ nur im Speicher), Ordnerbaum, Raster und Liste
// (virtualisiert, Größe, Spalten, Ansicht je Ordner), Auswahl wie im Explorer, Abgleich nach
// Änderungen von außen, Neustart mit vorhandenem Index und Cache, Entfernen mit Rückfrage (keine
// Reste). Testbibliothek aus scripts/testbilder.mjs.

import assert from 'node:assert/strict'
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { QUADRANTEN } from '../scripts/testbilder.mjs'
import {
  erwarteteBilder,
  launchApp,
  runSteps,
  stubConfirm,
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
/** Ordnerbaum, Raster (virtualisiert: nur die gezeigten Kacheln), Statusleiste */
const baum = () => ctx.page.getByRole('tree', { name: 'Ordner' })
const raster = () => ctx.page.getByRole('listbox', { name: 'Bilder' })
const kacheln = () => raster().getByRole('option')
const kachelNamen = () => kacheln().evaluateAll((el) => el.map((e) => e.getAttribute('aria-label')))
const gewaehlteNamen = () =>
  raster()
    .locator('[role="option"][aria-selected="true"]')
    .evaluateAll((el) => el.map((e) => e.getAttribute('aria-label')))
const statusText = () => ctx.page.locator('footer').innerText()
/** Ordner für Drag & Drop (600 Kopien eines Testbilds, synthetisch) */
const vieleDir = join(mkdtempSync(join(tmpdir(), 'galeria-viele-')), 'viele')
/**
 * Echter Drop aus dem Betriebssystem, nachgestellt über das DevTools-Protokoll: Die Seite bekommt
 * Datei-Objekte mit Pfad – wie beim Ziehen aus dem Explorer.
 */
async function ablegen(pfade) {
  const box = await ctx.page.getByRole('main').boundingBox()
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2
  const cdp = await ctx.page.context().newCDPSession(ctx.page)
  const data = { items: [], files: pfade, dragOperationsMask: 1 }
  try {
    for (const type of ['dragEnter', 'dragOver', 'drop']) {
      await cdp.send('Input.dispatchDragEvent', { type, x, y, data })
    }
  } finally {
    await cdp.detach()
  }
}
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
        await ctx.page
          .getByRole('treeitem', { name: 'bib', exact: true })
          .waitFor({ timeout: 5_000 })
        await ctx.page
          .locator('footer')
          .getByText(`${erwartet} Bilder`, { exact: true })
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
            '[role="listbox"][aria-label="Bilder"] img',
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
      'Ordnerbaum: Unterordner mit Anzahl; ein Klick zeigt nur diesen Ordner samt allem darunter',
      async () => {
        const orte = baum().getByRole('treeitem', { name: 'orte', exact: true })
        await orte.waitFor({ timeout: 10_000 })
        assert.match(await orte.innerText(), /orte\s+4/)
        await orte.getByRole('button', { name: 'orte' }).click()
        assert.ok(await waitFor(async () => (await statusText()).includes('4 Bilder'), 5_000))
        assert.ok(
          await waitFor(
            async () =>
              JSON.stringify((await kachelNamen()).sort()) ===
              JSON.stringify(['dubrovnik.jpg', 'muenchen.jpg', 'paris-texas.jpg', 'paris.jpg']),
            5_000
          ),
          `Kacheln: ${await kachelNamen()}`
        )
        await ctx.page.getByRole('button', { name: /^Alle Bilder/ }).click()
        assert.ok(
          await waitFor(async () => (await statusText()).includes(`${erwartet} Bilder`), 5_000)
        )
      }
    ],
    [
      'Auswahl wie im Explorer: Klick, Strg, Umschalt, Strg+A, Esc – Statusleiste mit Anzahl und Summe',
      async () => {
        assert.ok(await waitFor(async () => !(await kachelNamen()).includes('Bild'), 10_000))
        const namen = await kachelNamen()
        const k = kacheln()
        await k.nth(0).click()
        assert.deepEqual(await gewaehlteNamen(), [namen[0]])
        await k.nth(2).click({ modifiers: ['Control'] })
        assert.deepEqual(await gewaehlteNamen(), [namen[0], namen[2]])
        // Umschalt: Bereich ab dem Anker (der letzte Klick)
        await k.nth(4).click({ modifiers: ['Shift'] })
        assert.deepEqual(await gewaehlteNamen(), [namen[2], namen[3], namen[4]])
        assert.ok(await waitFor(async () => (await statusText()).includes('3 ausgewählt'), 3_000))
        await raster().press('Control+a')
        assert.ok(
          await waitFor(
            async () =>
              new RegExp(`${erwartet} ausgewählt · [\\d.,]+ (Byte|KB|MB)`).test(await statusText()),
            5_000
          ),
          await statusText()
        )
        await raster().press('Escape')
        assert.deepEqual(await gewaehlteNamen(), [])
        assert.ok(await waitFor(async () => !(await statusText()).includes('ausgewählt'), 3_000))
      }
    ],
    [
      'Rahmen ziehen wählt die überfahrenen Kacheln',
      async () => {
        const namen = await kachelNamen()
        const tops = await kacheln().evaluateAll((el) =>
          el.map((e) => Math.round(e.getBoundingClientRect().top))
        )
        const spalten = tops.filter((t) => t === tops[0]).length
        assert.ok(spalten >= 2, `nur ${spalten} Spalte(n)`)
        const lb = await raster().boundingBox()
        const ziel = await kacheln()
          .nth(spalten + 1)
          .boundingBox()
        // von der freien Ecke oben links bis in die zweite Kachel der zweiten Zeile
        await ctx.page.mouse.move(lb.x + 4, lb.y + 4)
        await ctx.page.mouse.down()
        await ctx.page.mouse.move(ziel.x + ziel.width / 2, ziel.y + ziel.height / 3, { steps: 6 })
        await ctx.page.mouse.up()
        assert.deepEqual(
          (await gewaehlteNamen()).sort(),
          [namen[0], namen[1], namen[spalten], namen[spalten + 1]].sort()
        )
        await raster().press('Escape')
      }
    ],
    [
      'Größenregler und Strg + Mausrad; Liste mit wählbaren Spalten, Sortieren per Überschrift',
      async () => {
        const breite = async () => (await kacheln().first().boundingBox()).width
        const vorher = await breite()
        await ctx.page.getByRole('slider', { name: 'Größe' }).fill('80')
        assert.ok(await waitFor(async () => (await breite()) < vorher, 3_000))
        const klein = await breite()
        const lb = await raster().boundingBox()
        await ctx.page.mouse.move(lb.x + lb.width / 2, lb.y + lb.height / 2)
        await ctx.page.keyboard.down('Control')
        await ctx.page.mouse.wheel(0, -300)
        await ctx.page.keyboard.up('Control')
        assert.ok(await waitFor(async () => (await breite()) > klein, 3_000), 'Strg + Mausrad')
        // Liste
        await ctx.page.getByRole('button', { name: 'Liste', exact: true }).click()
        const grid = ctx.page.getByRole('grid', { name: 'Bilder' })
        await grid.waitFor({ timeout: 5_000 })
        const sortieren = ctx.page.getByRole('combobox', { name: 'Sortieren nach' })
        await grid.getByRole('columnheader', { name: 'Name' }).getByRole('button').click()
        assert.equal(await sortieren.inputValue(), 'name')
        await grid.getByRole('columnheader', { name: 'Name' }).getByRole('button').click()
        assert.equal(
          await ctx.page.getByRole('button', { name: 'Absteigend' }).getAttribute('aria-pressed'),
          'true'
        )
        assert.equal(
          await grid.getByRole('columnheader', { name: 'Name' }).getAttribute('aria-sort'),
          'descending'
        )
        // Spalten wählen
        assert.equal(await grid.getByRole('columnheader', { name: 'Geändert' }).count(), 0)
        await ctx.page.getByRole('button', { name: 'Spalten' }).click()
        await ctx.page.getByRole('checkbox', { name: 'Geändert' }).check()
        await grid.getByRole('columnheader', { name: 'Geändert' }).waitFor({ timeout: 3_000 })
        await ctx.page.getByRole('button', { name: 'Spalten' }).click()
        // zurück zur Vorgabe-Sortierung
        await sortieren.selectOption('aufnahme')
        await ctx.page.getByRole('button', { name: 'Absteigend' }).click()
      }
    ],
    [
      'Ansicht je Ordner gemerkt (Bedienzustand), auch nach dem Neuladen',
      async () => {
        // „Alle Bilder“ steht jetzt auf Liste; „bib“ hat seine eigene Ansicht (Vorgabe: Kacheln)
        await baum()
          .getByRole('treeitem', { name: 'bib', exact: true })
          .getByRole('button', { name: /^bib/ })
          .click()
        await raster().waitFor({ timeout: 5_000 })
        await ctx.page.getByRole('button', { name: /^Alle Bilder/ }).click()
        await ctx.page.getByRole('grid', { name: 'Bilder' }).waitFor({ timeout: 5_000 })
        await ctx.page.reload()
        await ctx.page.getByRole('grid', { name: 'Bilder' }).waitFor({ timeout: 10_000 })
        assert.equal(
          await ctx.page.getByRole('button', { name: /^Alle Bilder/ }).getAttribute('aria-current'),
          'true'
        )
        // für die weiteren Schritte zurück auf Kacheln
        await ctx.page.getByRole('button', { name: 'Kacheln', exact: true }).click()
        await raster().waitFor({ timeout: 5_000 })
      }
    ],
    [
      'Ordner per Drag & Drop (echter Drop): aufgenommen und gewählt; 600 Bilder – nur die sichtbaren Kacheln im DOM',
      async () => {
        mkdirSync(vieleDir)
        for (let i = 0; i < 600; i++) {
          copyFileSync(
            join(bib.dir, 'namen', 'bild 1.jpg'),
            join(vieleDir, `k${String(i).padStart(3, '0')}.jpg`)
          )
        }
        await ablegen([vieleDir])
        const v = await waitFor(async () => {
          const f = (await ordner()).find((x) => x.name === 'viele')
          return f && f.status === 'bereit' && f.count === 600 ? f : null
        }, 40_000)
        assert.ok(v, `nicht aufgenommen: ${JSON.stringify(await ordner())}`)
        // ein einzelner gezogener Ordner wird gleich gewählt
        assert.ok(await waitFor(async () => (await statusText()).includes('600 Bilder'), 5_000))
        await ctx.page.getByRole('combobox', { name: 'Sortieren nach' }).selectOption('name')
        await ctx.page.getByRole('slider', { name: 'Größe' }).fill('80')
        assert.ok(await waitFor(async () => (await kachelNamen())[0] === 'k000.jpg', 5_000))
        const imDom = await kacheln().count()
        assert.ok(imDom > 0 && imDom < 300, `${imDom} Kacheln im DOM`)
        await raster().evaluate((el) => {
          el.scrollTop = el.scrollHeight
        })
        assert.ok(await waitFor(async () => (await kachelNamen()).includes('k599.jpg'), 5_000))
        assert.ok(!(await kachelNamen()).includes('k000.jpg'))
      }
    ],
    [
      'Ziehen abgelehnt: eine Datei statt eines Ordners, eine in der Seite erzeugte Datei (ohne Pfad)',
      async () => {
        await ablegen([join(bib.dir, 'orte', 'dubrovnik.jpg')])
        await ctx.page
          .getByText(/ist kein Ordner oder gerade nicht erreichbar/)
          .waitFor({ timeout: 5_000 })
        assert.equal((await ordner()).length, 2)
        await ctx.page.getByRole('button', { name: 'Hinweis schließen' }).click()
        // ein File aus der Seite hat keinen Pfad: der Preload lässt es weg, der main sieht nichts.
        // Als Name trägt es den Pfad eines echten (leeren) Ordners – nähme die App den Namen als
        // Pfad, würde dieser Ordner aufgenommen (Gegenprobe)
        const leer = mkdtempSync(join(tmpdir(), 'galeria-untergeschoben-'))
        await raster().evaluate((el, name) => {
          const dt = new DataTransfer()
          dt.items.add(new File(['x'], name))
          for (const typ of ['dragenter', 'dragover', 'drop']) {
            el.dispatchEvent(
              new DragEvent(typ, { dataTransfer: dt, bubbles: true, cancelable: true })
            )
          }
        }, leer)
        await ctx.page.getByText('Nur Ordner lassen sich hinzufügen.').waitFor({ timeout: 5_000 })
        assert.equal((await ordner()).length, 2)
        await ctx.page.getByRole('button', { name: 'Hinweis schließen' }).click()
        rmSync(leer, { recursive: true, force: true })
      }
    ],
    [
      'Gezogenen Ordner wieder entfernen: auch seine Vorschaubilder sind weg',
      async () => {
        await stubConfirm(ctx.app, true)
        const v = (await ordner()).find((x) => x.name === 'viele')
        assert.equal(
          await ctx.page.evaluate((id) => window.api.library.removeFolder(id), v.id),
          true
        )
        assert.ok(await waitFor(async () => (await ordner()).length === 1, 5_000))
        // auch was der Bilddienst für „viele“ gerade noch erzeugte, verschwindet wieder
        assert.ok(
          await waitFor(
            async () => cacheDateien().length === 2 * (erwartet - defektErwartet.length),
            30_000
          ),
          `Cache: ${cacheDateien().length}`
        )
        assert.ok(
          await waitFor(async () => (await statusText()).includes(`${erwartet} Bilder`), 5_000)
        )
      }
    ],
    [
      'Unterordner eines Bibliotheksordners wird mit Hinweis abgelehnt',
      async () => {
        await stubOrdnerDialog(ctx.app, join(bib.dir, 'orte'))
        await ctx.page
          .getByRole('navigation', { name: 'Bibliothek und Ordner' })
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
          .getByRole('navigation', { name: 'Bibliothek und Ordner' })
          .getByRole('button', { name: 'Ordner hinzufügen' })
          .click()
        await waitFor(
          async () =>
            !(await ctx.page
              .getByRole('navigation', { name: 'Bibliothek und Ordner' })
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
          .getByRole('treeitem', { name: 'bib', exact: true })
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
              '[role="listbox"][aria-label="Bilder"] img',
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
          .getByRole('treeitem', { name: 'bib', exact: true })
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
        await ctx.page
          .getByRole('treeitem', { name: 'bib', exact: true })
          .waitFor({ timeout: 15_000 })
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
        assert.ok(await waitFor(async () => (await zustand()).thumbPending === 0, 50_000))
        const nachher = new Map(cacheDateien().map((f) => [f, statSync(f).mtimeMs]))
        // Mit sicherem Schlüsselspeicher (Windows: DPAPI) übersteht der Cache den Neustart. Ohne
        // (Linux ohne Schlüsselbund, CI) gilt der Schlüssel nur je Sitzung: Der Cache entsteht
        // vollständig neu – im Hintergrund, nicht nur auf Abruf.
        const sicher = await ctx.app.evaluate(
          ({ safeStorage }) =>
            safeStorage.isEncryptionAvailable() &&
            (process.platform !== 'linux' ||
              safeStorage.getSelectedStorageBackend() !== 'basic_text')
        )
        if (sicher) {
          assert.deepEqual(
            nachher,
            stempel,
            'Cache nach dem Neustart neu erzeugt (Schlüssel verloren?)'
          )
        } else {
          // neu für jedes vorhandene, lesbare Bild – eine inzwischen fehlende Datei (paris.jpg)
          // bekommt keins mehr, ihre alten Cache-Dateien sind mit dem alten Schlüssel weg
          const kennung = (f) => Number(/(\d+)-(?:256|768)\.gbv$/.exec(f)[1])
          const lesbar = (await alleBilder())
            .filter((b) => b.status === 'ok')
            .map((b) => b.id)
            .sort((a, b) => a - b)
          assert.deepEqual(
            [...new Set([...nachher.keys()].map(kennung))].sort((a, b) => a - b),
            lesbar
          )
          assert.equal(nachher.size, 2 * lesbar.length)
          assert.ok(
            [...nachher].every(([f, t]) => t !== stempel.get(f)),
            'ohne sicheren Speicher hätte der Cache neu entstehen müssen'
          )
          assert.match(
            readFileSync(join(userData, 'galeria-debug.log'), 'utf8'),
            /kein sicherer Schlüsselspeicher/
          )
        }
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
        // Koordinaten mit vier Nachkommastellen und ohne Ziffer davor: drei Stellen kollidierten
        // mit den Millisekunden der Zeitstempel („…:02.295Z“ enthält 2.295 – Paris, Linux-CI)
        const koordinate = (v) =>
          new RegExp(`(?<![\\d.])${Math.abs(v).toFixed(4).replace('.', '\\.')}`)
        // Gegenprobe des Musters: findet eine durchgesickerte Koordinate (auch negativ), aber nicht
        // den Zeitstempel aus der Linux-CI und keine längere Zahl, die nur so endet
        const paris = bib.manifest.orte.paris
        const texas = bib.manifest.orte.parisTexas
        assert.ok(koordinate(paris.lat).test(`GPS ${paris.lat}, ${paris.lon}`))
        assert.ok(koordinate(texas.lon).test(`lon=${texas.lon}`))
        assert.ok(!koordinate(paris.lon).test('[2026-10-26T06:03:02.295Z]'))
        assert.ok(!koordinate(paris.lat).test('148.8584'))
        const muster = [
          ...Object.values(bib.manifest.orte).flatMap((o) => [
            koordinate(o.lat),
            koordinate(o.lon)
          ]),
          ...['Altstadt am Abend', 'Tour Eiffel', 'Weihnachten', 'dubrovnik', 'ausrichtung-6'].map(
            (t) => new RegExp(t)
          ),
          /Übersicht/
        ]
        assert.deepEqual(muster.filter((m) => m.test(log)).map(String), [])
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
  rmSync(join(vieleDir, '..'), { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
}
