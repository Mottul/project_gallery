// Filter und Suche in der echten App (Phase 2.4): jedes Kriterium und die Volltextsuche exakt gegen
// die bekannten Testbilder (ExifTool hat echte Metadaten gelesen), ungültige Eingaben im main
// abgelehnt, Suchfeld und Filterleiste in der Oberfläche, Chips, „N von M Bildern“. Ein Filter gilt
// über Ordner, Ansichten und im Betrachter und ist nach dem Neuladen weg (entschieden 30.10.2026).
// Änderungen von außen landen im Suchindex; das Log enthält keine Suchbegriffe.

import assert from 'node:assert/strict'
import { copyFileSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import {
  erwarteteBilder,
  launchApp,
  runSteps,
  stubOrdnerDialog,
  testbibliothek,
  waitFor
} from './harness.mjs'

const bib = await testbibliothek()
const erwartet = erwarteteBilder(bib.manifest)
const bilder = bib.manifest.eintraege.filter((e) => e.art === 'bild')
const name = (e) => e.datei.split('/').pop()
/** Namen der Testbilder, die `pruef` erfüllen, sortiert */
const soll = (pruef) => bilder.filter(pruef).map(name).sort()
const stichwoerter = (e) => [...(e.stichwoerter ?? []), ...(e.iptcStichwoerter ?? [])]

const ctx = await launchApp()
const { app, page } = ctx
const zustand = () => page.evaluate(() => window.api.library.state())
const SORT = { feld: 'name', richtung: 'auf' }
/** Ergebnis der Abfrage, wie die Oberfläche sie stellt */
const abfrage = (filter, ordner) =>
  page.evaluate(
    ([s, o, f]) => window.api.library.queryGroups(s, o, 'monat', false, f),
    [SORT, ordner, filter]
  )
/** Namen der Treffer, sortiert */
const treffer = async (filter, ordner) => {
  const { ids } = await abfrage(filter, ordner)
  const d = await page.evaluate((x) => window.api.library.details(x), ids)
  return d.map((b) => b.name).sort()
}
const raster = () => page.getByRole('listbox', { name: 'Bilder' })
const kachelNamen = () =>
  raster()
    .getByRole('option')
    .evaluateAll((el) => el.map((e) => e.getAttribute('aria-label')))
    .catch(() => [])
/** Zeigt das Raster genau diese Bilder? (wenige, also alle gezeichnet) */
const zeigt = async (namen, ms = 5_000) => {
  const ok = await waitFor(
    async () => JSON.stringify((await kachelNamen()).sort()) === JSON.stringify([...namen].sort()),
    ms
  )
  assert.ok(ok, `Raster: ${(await kachelNamen()).join(' | ')} statt ${namen.join(' | ')}`)
}
const suchfeld = () => page.getByRole('searchbox', { name: 'Bilder suchen' })
const leiste = () => page.getByRole('region', { name: 'Filter' })
const zaehler = (n, m) => leiste().getByText(`${n} von ${m} Bildern`)
const zuruecksetzen = async () => {
  await leiste().getByRole('button', { name: 'Zurücksetzen' }).click()
  assert.ok(await waitFor(async () => (await kachelNamen()).length > 4, 5_000), 'nicht zurück')
}
/** Eine Auswahlliste der Leiste aufklappen */
const aufklappen = (titel) =>
  leiste()
    .getByRole('button', { name: new RegExp(`^${titel}`) })
    .click()

try {
  await runSteps('Filter und Suche', [
    [
      `Ordner einlesen, Metadaten aller ${erwartet} Dateien gelesen`,
      async () => {
        await stubOrdnerDialog(app, bib.dir)
        await page.getByRole('main').getByRole('button', { name: 'Ordner hinzufügen' }).click()
        const z = await waitFor(async () => {
          const s = await zustand()
          const [o] = s.folders
          return o?.status === 'bereit' && o.count === erwartet && s.metaPending === 0 ? s : null
        }, 60_000)
        assert.ok(z, `nicht fertig: ${JSON.stringify(await zustand())}`)
      }
    ],
    [
      'Jedes Kriterium exakt wie in den Testbildern; „oder“ im Kriterium, „und“ dazwischen',
      async () => {
        assert.deepEqual(
          await treffer({ bewertung: 3 }),
          soll((e) => e.bewertung >= 3)
        )
        assert.deepEqual(await treffer({ bewertung: 5 }), ['dubrovnik.jpg'])
        assert.deepEqual(await treffer({ farben: ['Red'] }), ['dubrovnik.jpg'])
        assert.deepEqual(
          await treffer({ kameras: ['Galeria Testkamera B'] }),
          soll((e) => e.kamera?.modell === 'Testkamera B')
        )
        for (const e of bilder.filter((x) => x.gps)) {
          assert.deepEqual(await treffer({ orte: [`${e.gps.ort}\u0001${e.gps.land}`] }), [name(e)])
        }
        // Stichwort nur aus IPTC; zwei Werte = „oder“
        assert.deepEqual(await treffer({ stichwoerter: ['Winter'] }), ['muenchen.jpg'])
        assert.deepEqual(
          await treffer({ stichwoerter: ['Meer', 'Familie'] }),
          soll((e) => stichwoerter(e).some((w) => w === 'Meer' || w === 'Familie'))
        )
        assert.deepEqual(
          await treffer({ standort: 'mit' }),
          soll((e) => e.gps)
        )
        const ohne = await treffer({ standort: 'ohne' })
        assert.equal(ohne.length, erwartet - 4)
        assert.ok(!ohne.includes('paris.jpg'))
        // Format und Ausrichtung gegen die Maße im Index
        const alle = await page.evaluate(
          async (s) => window.api.library.details(await window.api.library.query(s)),
          SORT
        )
        const namen = (p) =>
          alle
            .filter(p)
            .map((b) => b.name)
            .sort()
        const png = namen((b) => b.format === 'png')
        assert.ok(png.length > 0)
        assert.deepEqual(await treffer({ formate: ['png'] }), png)
        const hoch = namen((b) => b.height > b.width)
        const quer = namen((b) => b.width > b.height)
        assert.ok(quer.length > 0, 'Querformat in den Testbildern') // Hochformat: repo.test.ts
        assert.deepEqual(await treffer({ ausrichtung: 'hoch' }), hoch)
        assert.deepEqual(await treffer({ ausrichtung: 'quer' }), quer)
        // Zeitraum einschließlich beider Tage, Aufnahmezeit wie in der Kamera
        assert.deepEqual(await treffer({ von: '2022-04-02', bis: '2022-04-02' }), ['paris.jpg'])
        assert.deepEqual(await treffer({ von: '2022-04-02', bis: '2022-04-03' }), [
          'paris-texas.jpg',
          'paris.jpg'
        ])
        // mehrere Kriterien: „und“
        assert.deepEqual(await treffer({ bewertung: 3, stichwoerter: ['Meer'] }), ['dubrovnik.jpg'])
        assert.deepEqual(await treffer({ bewertung: 5, stichwoerter: ['Winter'] }), [])
      }
    ],
    [
      'Suche: Titel, Beschreibung, Stichwort, Ort, Name – Präfix, ohne Umlaute, alle Wörter',
      async () => {
        for (const [q, namen] of [
          ['altstadt', ['dubrovnik.jpg']],
          ['stadtmauer', ['dubrovnik.jpg']],
          ['Altstadt Abend', ['dubrovnik.jpg']],
          ['altstadt winter', []],
          ['weihnacht', ['muenchen.jpg']],
          ['eiffel', ['paris.jpg']],
          ['frankreich', ['paris.jpg']],
          ['munchen', ['muenchen.jpg']],
          ['ubersicht', ['Übersicht äöü ß.jpg']],
          ['kroatien', ['dubrovnik.jpg']]
        ]) {
          assert.deepEqual(await treffer({ suche: q }), namen, q)
        }
        // FTS5-Syntax aus der Eingabe wirkt nicht und wirft nicht
        for (const q of ['title:Altstadt', 'a OR b', 'NEAR(x y)', '"', '*', '- ...', "x'; --"]) {
          await treffer({ suche: q })
        }
      }
    ],
    [
      'Knoten, Gruppen, „gesamt“; Auswahllisten aus dem Index; Ungültiges im main abgelehnt',
      async () => {
        const [{ id }] = (await zustand()).folders
        const orte = { ordner: id, pfad: 'orte' }
        const r = await abfrage({ bewertung: 3 }, orte)
        assert.equal(r.ids.length, 2)
        assert.equal(r.gesamt, 4, 'gesamt = Bilder im Unterordner')
        // Gruppen folgen der Sortierung und passen zur gefilterten Liste
        const g = await page.evaluate(
          ([o, f]) =>
            window.api.library.queryGroups(
              { feld: 'aufnahme', richtung: 'auf' },
              o,
              'monat',
              false,
              f
            ),
          [orte, { bewertung: 3 }]
        )
        assert.deepEqual(
          g.gruppen.map((x) => [x.titel, x.anzahl]),
          [
            ['Dezember 2023', 1],
            ['Juli 2024', 1]
          ]
        )
        assert.equal(
          (await abfrage({ standort: 'mit' }, { ordner: id, pfad: 'namen' })).ids.length,
          0
        )
        assert.equal((await abfrage({ bewertung: 3 })).gesamt, erwartet)
        assert.equal((await abfrage(undefined)).gesamt, undefined)
        const f = await page.evaluate(() => window.api.library.facets())
        assert.deepEqual(
          f.kameras.map((k) => [k.wert, k.anzahl]),
          [
            [
              'Galeria Testkamera A',
              bilder.filter((e) => e.kamera?.modell === 'Testkamera A').length
            ],
            [
              'Galeria Testkamera B',
              bilder.filter((e) => e.kamera?.modell === 'Testkamera B').length
            ]
          ]
        )
        assert.ok(f.orte.some((o) => o.titel === 'Dubrovnik · Kroatien' && o.anzahl === 1))
        assert.deepEqual(f.farben, [{ wert: 'Red', titel: 'Rot', anzahl: 1 }])
        assert.ok(f.stichwoerter.some((w) => w.wert === 'Weihnachten'))
        assert.ok(f.zeitraum.von <= '2021-01-01' && f.zeitraum.bis >= '2024-07-14')
        // jeder angebotene Wert findet genau so viele Bilder, wie die Liste verspricht
        for (const w of f.orte) {
          assert.equal((await abfrage({ orte: [w.wert] })).ids.length, w.anzahl, w.titel)
        }
        const nurOrte = await page.evaluate((o) => window.api.library.facets(o), orte)
        assert.deepEqual(
          nurOrte.farben.map((x) => x.wert),
          ['Red']
        )
        assert.equal(
          (await page.evaluate((o) => window.api.library.facets(o), { ordner: id, pfad: 'namen' }))
            .farben.length,
          0
        )
        for (const v of [
          'Paris',
          { bewertung: 9 },
          { kameras: 'A' },
          { von: '2024-02-30' },
          { von: '2024-08-01', bis: '2024-07-01' },
          { stichwoerter: ['a\nb'] },
          { suche: 'x'.repeat(201) }
        ]) {
          await assert.rejects(abfrage(v), /Filter/, JSON.stringify(v))
        }
        await assert.rejects(
          page.evaluate((s) => window.api.library.queryGroups(s, undefined, 'monat', 'ja'), SORT),
          /Schalter/
        )
        await assert.rejects(
          page.evaluate(() => window.api.library.facets({ ordner: 1, pfad: '../x' })),
          /Filter/
        )
      }
    ],
    [
      'Suchfeld: Treffer im Raster, „1 von N Bildern“, Esc leert',
      async () => {
        await suchfeld().fill('altstadt')
        await zeigt(['dubrovnik.jpg'])
        await zaehler(1, erwartet).waitFor({ timeout: 3_000 })
        // „Filter“ zählt die Suche nicht mit – sie steht im Feld
        await page.getByRole('button', { name: 'Filter', exact: true }).waitFor({ timeout: 1_000 })
        await suchfeld().press('Escape')
        assert.equal(await suchfeld().inputValue(), '')
        assert.ok(await waitFor(async () => (await kachelNamen()).length > 4, 5_000))
        assert.equal(await leiste().count(), 0, 'ohne Filter keine Leiste')
      }
    ],
    [
      'Filterleiste: Liste ganz sichtbar, Häkchen filtern, Chips, Zähler, Keine Treffer, Zurücksetzen',
      async () => {
        const knopf = page.getByRole('button', { name: 'Filter', exact: true })
        assert.equal(await knopf.getAttribute('aria-expanded'), 'false')
        await knopf.click()
        await leiste().waitFor({ timeout: 3_000 })
        await aufklappen('Kamera')
        const b = page.getByRole('checkbox', { name: /Galeria Testkamera B/ })
        await b.waitFor({ timeout: 3_000 })
        // Liste liegt obenauf, auch über dem Raster (nicht abgeschnitten)
        const sichtbar = await page.getByRole('group', { name: 'Kamera wählen' }).evaluate((el) => {
          const r = el.getBoundingClientRect()
          return [
            [r.left + 4, r.top + 4],
            [r.right - 4, r.top + 4],
            [r.left + 4, r.bottom - 4],
            [r.right - 4, r.bottom - 4]
          ].every(([x, y]) => el.contains(document.elementFromPoint(x, y)))
        })
        assert.ok(sichtbar, 'Auswahlliste verdeckt oder abgeschnitten')
        await b.check()
        await zeigt(['paris.jpg', 'paris-texas.jpg'])
        await zaehler(2, erwartet).waitFor({ timeout: 3_000 })
        await page.getByRole('button', { name: 'Filter (1 aktiv)' }).waitFor({ timeout: 3_000 })
        await page.keyboard.press('Escape')
        const chip = page.getByRole('button', { name: 'Filter entfernen: Galeria Testkamera B' })
        await chip.waitFor({ timeout: 3_000 })
        // zweites Kriterium: niemand mit Kamera B hat eine Bewertung
        await leiste().getByRole('combobox', { name: 'Bewertung' }).selectOption('3')
        await page.getByText('Keine Bilder passen zum Filter.').waitFor({ timeout: 5_000 })
        await zaehler(0, erwartet).waitFor({ timeout: 3_000 })
        await page.getByRole('button', { name: 'Filter entfernen: Bewertung ≥ 3' }).click()
        await zeigt(['paris.jpg', 'paris-texas.jpg'])
        // Chip entfernt nur sein Kriterium
        await chip.click()
        assert.ok(await waitFor(async () => (await kachelNamen()).length > 4, 5_000))
        // Zeitraum: beide Tage einschließlich; rückwärts gilt das zuletzt Gesetzte, kein Fehler
        const von = leiste().getByLabel('Von')
        const bis = leiste().getByLabel('Bis')
        await von.fill('2022-04-02')
        await bis.fill('2022-04-02')
        await zeigt(['paris.jpg'])
        await von.fill('2022-04-03')
        assert.ok(
          await waitFor(async () => (await kachelNamen())[0] === 'paris-texas.jpg', 5_000),
          `Raster: ${(await kachelNamen()).join(' | ')}`
        )
        assert.ok(await waitFor(async () => (await bis.inputValue()) === '', 3_000))
        await page.getByRole('button', { name: 'Filter entfernen: Ab 03.04.2022' }).waitFor()
        assert.equal(await page.getByText(/Bilder nicht verfügbar/).count(), 0)
        await zuruecksetzen()
        // Stichwort über die Liste (Suche in der Liste erst ab vielen Einträgen)
        await aufklappen('Stichwort')
        await page.getByRole('checkbox', { name: /^Winter/ }).check()
        await zeigt(['muenchen.jpg'])
        await page.keyboard.press('Escape')
        await aufklappen('Ort')
        await page.getByRole('checkbox', { name: /Paris · Frankreich/ }).check()
        await page.getByText('Keine Bilder passen zum Filter.').waitFor({ timeout: 5_000 })
        await page.keyboard.press('Escape')
        await page.getByRole('main').getByRole('button', { name: 'Zurücksetzen' }).first().click()
        assert.ok(await waitFor(async () => (await kachelNamen()).length > 4, 5_000))
        assert.equal(await page.getByRole('button', { name: /^Filter entfernen/ }).count(), 0)
        await knopf.click()
        assert.equal(await leiste().count(), 0, 'zugeklappt und ohne Filter: keine Leiste')
      }
    ],
    [
      'Filter gilt über Ordner, Blocksatz, Liste und im Betrachter; nach dem Neuladen weg',
      async () => {
        const baum = page.getByRole('tree', { name: 'Ordner' })
        await suchfeld().fill('paris')
        await zeigt(['paris.jpg', 'paris-texas.jpg'])
        // Ordner wechseln: Filter bleibt
        await baum
          .getByRole('treeitem', { name: 'orte', exact: true })
          .getByRole('button', { name: 'orte' })
          .click()
        await zaehler(2, 4).waitFor({ timeout: 5_000 })
        await zeigt(['paris.jpg', 'paris-texas.jpg'])
        await baum
          .getByRole('treeitem', { name: 'namen', exact: true })
          .getByRole('button', { name: 'namen' })
          .click()
        await page.getByText('Keine Bilder passen zum Filter.').waitFor({ timeout: 5_000 })
        await page.getByRole('button', { name: /^Alle Bilder/ }).click()
        await zeigt(['paris.jpg', 'paris-texas.jpg'])
        // Blocksatz und Liste
        await page.getByRole('button', { name: 'Blocksatz', exact: true }).click()
        await zeigt(['paris.jpg', 'paris-texas.jpg'])
        await page.getByRole('button', { name: 'Liste', exact: true }).click()
        const grid = page.getByRole('grid', { name: 'Bilder' })
        await grid.waitFor({ timeout: 3_000 })
        assert.ok(
          await waitFor(async () => (await grid.locator('[data-id]').count()) === 2, 5_000),
          'Liste zeigt nicht genau die Treffer'
        )
        await page.getByRole('button', { name: 'Kacheln', exact: true }).click()
        await zeigt(['paris.jpg', 'paris-texas.jpg'])
        // Betrachter blättert nur durch die Treffer
        await raster().getByRole('option').first().dblclick()
        const dialog = page.getByRole('dialog', { name: 'Betrachter' })
        await dialog.waitFor({ timeout: 5_000 })
        const streifen = dialog.getByRole('listbox', { name: 'Filmstreifen' })
        assert.ok(
          await waitFor(async () => (await streifen.getByRole('option').count()) === 2, 5_000),
          'Filmstreifen zeigt nicht genau die Treffer'
        )
        await page.keyboard.press('Escape')
        await dialog.waitFor({ state: 'detached', timeout: 3_000 })
        // Neuladen (wie ein Neustart der Oberfläche): nichts fehlt unbemerkt
        await page.reload()
        await raster().waitFor({ timeout: 10_000 })
        assert.equal(await suchfeld().inputValue(), '')
        assert.ok(await waitFor(async () => (await kachelNamen()).length > 4, 5_000))
        assert.equal(await leiste().count(), 0)
      }
    ],
    [
      'Suchindex folgt den Dateien: neue Datei samt Metadaten auffindbar, gelöschte nicht mehr',
      async () => {
        const neu = join(bib.dir, 'orte', 'zauberbild.jpg')
        copyFileSync(join(bib.dir, 'orte', 'muenchen.jpg'), neu)
        assert.ok(
          await waitFor(async () => (await treffer({ suche: 'zauberbild' })).length === 1, 15_000),
          'neue Datei nicht auffindbar'
        )
        // Stichwörter kommen erst mit den Metadaten – über denselben Weg in den Suchindex
        assert.ok(
          await waitFor(async () => (await treffer({ suche: 'weihnacht' })).length === 2, 15_000),
          `Stichwort der neuen Datei nicht auffindbar: ${await treffer({ suche: 'weihnacht' })}`
        )
        rmSync(neu)
        assert.ok(
          await waitFor(async () => (await treffer({ suche: 'zauberbild' })).length === 0, 15_000),
          'gelöschte Datei noch auffindbar'
        )
        assert.deepEqual(await treffer({ suche: 'weihnacht' }), ['muenchen.jpg'])
      }
    ],
    [
      'Log ohne Suchbegriffe und Filterwerte; keine Konsolenfehler',
      async () => {
        await suchfeld().fill('geheimwort7')
        await page.getByText('Keine Bilder passen zum Filter.').waitFor({ timeout: 5_000 })
        await suchfeld().fill('')
        assert.ok(await waitFor(async () => (await kachelNamen()).length > 4, 5_000))
        const log = readFileSync(join(ctx.userData, 'galeria-debug.log'), 'utf8')
        assert.ok(log.length > 0, 'Log leer – Prüfung sinnlos')
        for (const w of ['geheimwort7', 'zauberbild', 'Galeria Testkamera', 'Weihnachten']) {
          assert.ok(!log.includes(w), `im Log: ${w}`)
        }
        assert.deepEqual(ctx.errors, [])
      }
    ]
  ])
} finally {
  await ctx.close()
  bib.aufraeumen()
}
