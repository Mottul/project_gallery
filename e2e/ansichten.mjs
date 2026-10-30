// Gespeicherte Ansichten in der echten App (Phase 2.4b): Speichern über die Filterleiste, Öffnen aus
// der Seitenleiste stellt Ordner, Darstellung, Sortierung, Gruppen, Größe, Filter und Suche wieder
// her; gleicher Name nur mit „Ersetzen“; Ungültiges im main abgelehnt; nach dem Neustart da, aber
// nicht von selbst aktiv; Löschen mit Rückfrage; ein entfernter Ordner nimmt seine Ansichten mit.

import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  erwarteteBilder,
  launchApp,
  runSteps,
  stubConfirm,
  stubOrdnerDialog,
  testbibliothek,
  waitFor
} from './harness.mjs'

const bib = await testbibliothek()
const erwartet = erwarteteBilder(bib.manifest)
const bilder = bib.manifest.eintraege.filter((e) => e.art === 'bild')
const name = (e) => e.datei.split('/').pop()
const userData = mkdtempSync(join(tmpdir(), 'galeria-e2e-'))

let ctx = await launchApp({ userData })
const page = () => ctx.page
const zustand = () => page().evaluate(() => window.api.library.state())
const raster = () => page().getByRole('listbox', { name: 'Bilder' })
const kachelNamen = () =>
  raster()
    .getByRole('option')
    .evaluateAll((el) => el.map((e) => e.getAttribute('aria-label')))
    .catch(() => [])
/** Zeigt das Raster genau diese Bilder in dieser Reihenfolge? */
const zeigt = async (namen, ms = 5_000) => {
  const ok = await waitFor(
    async () => JSON.stringify(await kachelNamen()) === JSON.stringify(namen),
    ms
  )
  assert.ok(ok, `Raster: ${(await kachelNamen()).join(' | ')} statt ${namen.join(' | ')}`)
}
const leiste = () => page().getByRole('region', { name: 'Filter' })
const suchfeld = () => page().getByRole('searchbox', { name: 'Bilder suchen' })
const abschnitt = () => page().getByRole('region', { name: 'Gespeicherte Ansichten' })
const eintrag = (n) => abschnitt().getByRole('button', { name: n, exact: true })
const namenInLeiste = () =>
  abschnitt()
    .getByRole('listitem')
    .evaluateAll((el) => el.map((e) => e.textContent))
    .catch(() => [])
const sortierung = () => page().getByRole('combobox', { name: 'Sortieren nach' })
const gruppen = () => page().getByRole('combobox', { name: 'Gruppen' })
const groesse = () => page().getByRole('slider', { name: 'Größe' })
const artKnopf = (n) => page().getByRole('button', { name: n, exact: true })
const gedrueckt = async (n) => (await artKnopf(n).getAttribute('aria-pressed')) === 'true'
const ordnerKnopf = (n) =>
  page()
    .getByRole('tree', { name: 'Ordner' })
    .getByRole('treeitem', { name: n, exact: true })
    .getByRole('button', { name: n })
const filterKnopf = () => page().getByRole('button', { name: /^Filter/ })
const alleBilder = () => page().getByRole('button', { name: /^Alle Bilder/ })

/** Leiste offen; das Speichern-Feld aufklappen, Namen eintragen. */
const speichernOeffnen = async (text) => {
  await leiste().getByRole('button', { name: 'Ansicht speichern' }).click()
  const feld = leiste().getByRole('textbox', { name: 'Name der Ansicht' })
  await feld.fill(text)
  return feld
}

/** Alles auf die Vorgabe, damit Öffnen sichtbar etwas ändert */
const aufAnfang = async () => {
  await alleBilder().click()
  await page().getByRole('button', { name: 'Kacheln', exact: true }).click()
  await sortierung().selectOption('aufnahme')
  if (await leiste().getByRole('button', { name: 'Zurücksetzen' }).count()) {
    await leiste().getByRole('button', { name: 'Zurücksetzen' }).click()
  }
  assert.ok(await waitFor(async () => (await suchfeld().inputValue()) === '', 3_000))
}

const STAND = {
  knoten: null,
  art: 'kacheln',
  groesse: 160,
  sortierung: { feld: 'name', richtung: 'auf' },
  gruppierung: 'monat',
  filter: {}
}
/** Aufruf im main – Ablehnung als Text, Erfolg als Ergebnis */
const speichernRoh = (n, stand, ersetzen = false) =>
  page().evaluate(
    ([a, b, c]) =>
      window.api.library.saveView(a, b, c).then(
        (r) => r,
        (e) => ({ abgelehnt: String(e.message) })
      ),
    [n, stand, ersetzen]
  )

try {
  await runSteps('Gespeicherte Ansichten', [
    [
      `Ordner einlesen, Metadaten aller ${erwartet} Dateien gelesen; Abschnitt noch leer`,
      async () => {
        await stubOrdnerDialog(ctx.app, bib.dir)
        await page().getByRole('main').getByRole('button', { name: 'Ordner hinzufügen' }).click()
        const z = await waitFor(async () => {
          const s = await zustand()
          const [o] = s.folders
          return o?.status === 'bereit' && o.count === erwartet && s.metaPending === 0 ? s : null
        }, 60_000)
        assert.ok(z, `nicht fertig: ${JSON.stringify(await zustand())}`)
        await abschnitt().getByText('Noch keine').waitFor({ timeout: 3_000 })
      }
    ],
    [
      'Speichern über die Filterleiste: Eintrag erscheint und ist gewählt',
      async () => {
        await filterKnopf().click()
        await leiste().getByRole('combobox', { name: 'Bewertung' }).selectOption('3')
        await artKnopf('Blocksatz').click()
        await sortierung().selectOption('name')
        await page().getByRole('button', { name: 'Absteigend' }).click()
        await groesse().fill('204')
        const sollNamen = bilder
          .filter((e) => e.bewertung >= 3)
          .map(name)
          .sort()
          .reverse()
        await zeigt(sollNamen)
        const feld = await speichernOeffnen('Beste Bilder')
        await feld.press('Enter')
        await eintrag('Beste Bilder').waitFor({ timeout: 3_000 })
        assert.equal(await eintrag('Beste Bilder').getAttribute('aria-current'), 'true')
        await feld.waitFor({ state: 'detached', timeout: 3_000 })
        const titel = await eintrag('Beste Bilder').getAttribute('title')
        assert.ok(titel.includes('Bewertung ≥ 3'), `Hinweis: ${titel}`)
        assert.equal(await abschnitt().getByText('Noch keine').count(), 0)
      }
    ],
    [
      'Öffnen stellt alles wieder her: Darstellung, Sortierung, Größe, Filter, Filterwert im Chip',
      async () => {
        await aufAnfang()
        assert.equal(await eintrag('Beste Bilder').getAttribute('aria-current'), null)
        await eintrag('Beste Bilder').click()
        await zeigt(
          bilder
            .filter((e) => e.bewertung >= 3)
            .map(name)
            .sort()
            .reverse()
        )
        assert.ok(await gedrueckt('Blocksatz'), 'Darstellung nicht wiederhergestellt')
        assert.equal(await sortierung().inputValue(), 'name')
        assert.equal(
          await page().getByRole('button', { name: 'Absteigend' }).getAttribute('aria-pressed'),
          'true'
        )
        assert.equal(await groesse().inputValue(), '204')
        await leiste().getByRole('button', { name: 'Filter entfernen: Bewertung ≥ 3' }).waitFor()
        assert.equal(await eintrag('Beste Bilder').getAttribute('aria-current'), 'true')
        // ändert man etwas, ist sie nicht mehr gewählt
        await leiste().getByRole('button', { name: 'Filter entfernen: Bewertung ≥ 3' }).click()
        assert.ok(
          await waitFor(
            async () => (await eintrag('Beste Bilder').getAttribute('aria-current')) === null,
            3_000
          ),
          'bleibt gewählt, obwohl der Filter weg ist'
        )
      }
    ],
    [
      'Ordner, Suche und Gruppen gehören dazu',
      async () => {
        await aufAnfang()
        await ordnerKnopf('orte').click()
        await sortierung().selectOption('aufnahme')
        await gruppen().selectOption('jahr')
        await suchfeld().fill('paris')
        await leiste().getByText('2 von 4 Bildern').waitFor({ timeout: 5_000 })
        const feld = await speichernOeffnen('Paris im Ordner')
        await leiste().getByRole('button', { name: 'Speichern', exact: true }).click()
        await eintrag('Paris im Ordner').waitFor({ timeout: 3_000 })
        await feld.waitFor({ state: 'detached', timeout: 3_000 })
        await aufAnfang()
        assert.equal(await page().getByText('von 4 Bildern').count(), 0)
        await eintrag('Paris im Ordner').click()
        await leiste().getByText(`2 von 4 Bildern`).waitFor({ timeout: 5_000 })
        assert.equal(await suchfeld().inputValue(), 'paris')
        assert.equal(await gruppen().inputValue(), 'jahr')
        const baum = page().getByRole('tree', { name: 'Ordner' })
        assert.equal(
          await baum
            .getByRole('treeitem', { name: 'orte', exact: true })
            .getAttribute('aria-selected'),
          'true',
          'Ordner nicht gewählt'
        )
      }
    ],
    [
      'Gleicher Name: erst „Ersetzen“ schreibt, auch bei anderer Schreibweise; Abbrechen speichert nichts',
      async () => {
        const vorher = await page().evaluate(() => window.api.library.views())
        const feld = await speichernOeffnen('BESTE bilder')
        await leiste().getByText('Gibt es schon').waitFor({ timeout: 3_000 })
        assert.equal(await leiste().getByRole('button', { name: 'Speichern' }).count(), 0)
        await feld.press('Escape')
        await feld.waitFor({ state: 'detached', timeout: 3_000 })
        assert.deepEqual(await page().evaluate(() => window.api.library.views()), vorher)
        // der main ersetzt nie ohne ausdrücklichen Wunsch
        assert.deepEqual(await speichernRoh('beste BILDER', STAND), { status: 'vorhanden' })
        assert.deepEqual(await page().evaluate(() => window.api.library.views()), vorher)

        // Vorschlag: die zuletzt geöffnete Ansicht – so lässt sie sich leicht aktualisieren
        await leiste().getByRole('button', { name: 'Ansicht speichern' }).click()
        const f2 = leiste().getByRole('textbox', { name: 'Name der Ansicht' })
        assert.equal(await f2.inputValue(), 'Paris im Ordner')
        await suchfeld().fill('texas')
        await leiste().getByText('1 von 4 Bildern').waitFor({ timeout: 5_000 })
        await leiste().getByRole('button', { name: 'Ersetzen' }).click()
        await f2.waitFor({ state: 'detached', timeout: 3_000 })
        const paris = (await page().evaluate(() => window.api.library.views())).filter(
          (a) => a.name === 'Paris im Ordner'
        )
        assert.equal(paris.length, 1, 'doppelt')
        assert.equal(paris[0].filter.suche, 'texas')
      }
    ],
    [
      'Im main abgelehnt: Name, Stand, Ordner, Kennung; fremder Text bleibt Text',
      async () => {
        const abgelehnt = async (n, stand, muster) => {
          const r = await speichernRoh(n, stand)
          assert.match(r.abgelehnt ?? '', muster, JSON.stringify(r))
        }
        await abgelehnt('', STAND, /Ungültiger Name/)
        await abgelehnt('   ', STAND, /Ungültiger Name/)
        await abgelehnt('x'.repeat(81), STAND, /Ungültiger Name/)
        await abgelehnt('a\nb', STAND, /Ungültiger Name/)
        await abgelehnt('x', { ...STAND, art: 'mosaik' }, /Ungültige Ansicht/)
        await abgelehnt('x', { ...STAND, groesse: 5 }, /Ungültige Ansicht/)
        await abgelehnt(
          'x',
          { ...STAND, sortierung: { feld: 'rowid; DROP TABLE images', richtung: 'auf' } },
          /Ungültige Ansicht/
        )
        await abgelehnt('x', { ...STAND, filter: { bewertung: 9 } }, /Ungültige Ansicht/)
        await abgelehnt(
          'x',
          { ...STAND, knoten: { ordner: 1, pfad: '../..' } },
          /Ungültige Ansicht/
        )
        await abgelehnt('x', { ...STAND, knoten: { ordner: 9999, pfad: '' } }, /gibt es nicht mehr/)
        const fehler = await page().evaluate(() =>
          window.api.library.deleteView('1').then(
            () => '',
            (e) => String(e.message)
          )
        )
        assert.match(fehler, /Ungültige Kennung/)
        // ein Name mit Zeichen, die anderswo Bedeutung hätten: bleibt Text
        const frech = `'; DROP TABLE ansichten;-- <img src=x>`
        assert.equal((await speichernRoh(frech, STAND)).status, 'gespeichert')
        await eintrag(frech).waitFor({ timeout: 3_000 })
        assert.equal(await abschnitt().locator('img').count(), 0)
      }
    ],
    [
      'Nach dem Neustart: Ansichten da, nichts davon aktiv – erst das Öffnen filtert',
      async () => {
        await ctx.close()
        ctx = await launchApp({ userData })
        await eintrag('Beste Bilder').waitFor({ timeout: 15_000 })
        await raster().waitFor({ timeout: 10_000 })
        assert.equal(await suchfeld().inputValue(), '')
        assert.equal(await leiste().count(), 0, 'Filter von selbst aktiv')
        await eintrag('Beste Bilder').click()
        await leiste().getByRole('button', { name: 'Filter entfernen: Bewertung ≥ 3' }).waitFor()
      }
    ],
    [
      'Löschen nur nach Rückfrage, sie nennt die Ansicht',
      async () => {
        await stubConfirm(ctx.app, false)
        const knopf = abschnitt().getByRole('button', { name: 'Ansicht „Beste Bilder“ löschen' })
        await knopf.click()
        await page().waitForTimeout(200)
        await eintrag('Beste Bilder').waitFor({ timeout: 1_000 })
        await ctx.app.evaluate(({ dialog }) => {
          dialog.showMessageBox = async (...a) => {
            globalThis.__frage = a.at(-1)
            return { response: 0, checkboxChecked: false }
          }
        })
        await knopf.click()
        await eintrag('Beste Bilder').waitFor({ state: 'detached', timeout: 3_000 })
        const frage = await ctx.app.evaluate(() => globalThis.__frage)
        assert.match(frage.message, /„Beste Bilder“/)
        assert.equal(frage.cancelId, 1)
        assert.equal(frage.defaultId, 1, 'Vorgabe muss „Abbrechen“ sein')
        // die Bilder sind unberührt da
        assert.equal((await zustand()).total, erwartet)
      }
    ],
    [
      'Ein entfernter Ordner nimmt seine Ansichten mit, die für alle Bilder bleiben',
      async () => {
        const frech = `'; DROP TABLE ansichten;-- <img src=x>`
        await page().evaluate((s) => window.api.library.saveView('Für alle', s, false), STAND)
        await eintrag('Für alle').waitFor({ timeout: 3_000 })
        await eintrag('Paris im Ordner').waitFor({ timeout: 3_000 })
        await stubConfirm(ctx.app, true)
        const [o] = (await zustand()).folders
        await page().evaluate((id) => window.api.library.removeFolder(id), o.id)
        await eintrag('Paris im Ordner').waitFor({ state: 'detached', timeout: 5_000 })
        const rest = await page().evaluate(() => window.api.library.views())
        assert.deepEqual(rest.map((a) => a.name).sort(), ['Für alle', frech].sort())
      }
    ],
    [
      'Log ohne Namen und Filterwerte; keine Konsolenfehler',
      async () => {
        const log = readFileSync(join(userData, 'galeria-debug.log'), 'utf8')
        assert.ok(log.length > 0, 'Log leer – Prüfung sinnlos')
        for (const w of ['Beste Bilder', 'Paris im Ordner', 'Für alle', 'DROP TABLE', 'texas']) {
          assert.ok(!log.includes(w), `im Log: ${w}`)
        }
        assert.deepEqual(ctx.errors, [])
      }
    ]
  ])
} finally {
  await ctx.close()
  bib.aufraeumen()
  rmSync(userData, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
}
