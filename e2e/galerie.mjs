// Bibliothek in der echten App (Phase 1.1): Ordner hinzufügen über den Dialog des main, Einlesen
// im Bilddienst, Ablehnung überlappender Ordner, Modus, Abgleich nach Änderungen von außen,
// Neustart mit vorhandenem Index, Entfernen mit Rückfrage. Testbibliothek aus scripts/testbilder.mjs.

import assert from 'node:assert/strict'
import { copyFileSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
        assert.equal(readdirSync(bib.dir, { recursive: true }).length, dateienVorher)
        assert.ok(statSync(join(bib.dir, 'neu von außen.jpg')).isFile())
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
