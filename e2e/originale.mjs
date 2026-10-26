// Schicht B – Originale unantastbar (Skill bildschutz): Prüfsummen ALLER Dateien der
// Testbibliothek vor und nach einem Lauf durch die App. Bis Phase 3 darf sich nichts ändern; es
// darf auch keine Datei dazukommen (kein `_original`, kein Temp, kein Thumbs.db) oder fehlen.
// Neue schreibende Funktionen tragen hier ein, welche Dateien sie ausdrücklich ändern.

import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import {
  launchApp,
  runSteps,
  stubConfirm,
  stubOrdnerDialog,
  testbibliothek,
  waitFor
} from './harness.mjs'

/** Relativer Pfad → SHA-256 und Änderungszeit, für jeden Eintrag unter `dir`. */
function stand(dir) {
  const out = {}
  for (const rel of readdirSync(dir, { recursive: true }).map(String).sort()) {
    const p = join(dir, rel)
    const st = statSync(p)
    out[rel] = st.isDirectory()
      ? 'Ordner'
      : `${createHash('sha256').update(readFileSync(p)).digest('hex')} ${Math.trunc(st.mtimeMs)}`
  }
  return out
}

const bib = await testbibliothek()
const vorher = stand(bib.dir)
const ctx = await launchApp()
const { app, page } = ctx
const ordner = () => page.evaluate(() => window.api.library.state().then((s) => s.folders))

try {
  await runSteps('Originale unverändert', [
    [
      'Ordner hinzufügen, einlesen, Modus wechseln, neu einlesen, entfernen',
      async () => {
        await page.getByRole('heading', { name: 'Noch keine Ordner' }).waitFor({ timeout: 15_000 })
        await stubOrdnerDialog(app, bib.dir)
        await page.evaluate(() => window.api.library.addFolder())
        const fertig = () =>
          waitFor(async () => {
            const [o] = await ordner()
            return o?.status === 'bereit' && o.lastScan ? o : null
          }, 30_000)
        const o = await fertig()
        assert.ok(o && o.count > 0, 'nicht eingelesen')
        // ExifTool hat jede Datei gelesen (1.2) – auch das darf nichts verändern
        const gelesen = await waitFor(async () => {
          const ids = await page.evaluate(() =>
            window.api.library.query({ feld: 'name', richtung: 'auf' })
          )
          const d = await page.evaluate((x) => window.api.library.details(x), ids)
          return d.length === o.count && d.every((b) => b.metaRead)
        }, 60_000)
        assert.ok(gelesen, 'Metadaten nicht vollständig gelesen')
        // jedes Bild einmal im Betrachter (bild://: Original lesen bzw. umrechnen) – nur lesend
        const ids = await page.evaluate(() =>
          window.api.library.query({ feld: 'name', richtung: 'auf' })
        )
        const status = await app.evaluate(
          async ({ net }, liste) =>
            Promise.all(
              liste.map(async (id) => {
                const r = await net.fetch(`bild://id/${id}`)
                await r.arrayBuffer()
                return r.status
              })
            ),
          ids
        )
        assert.ok(status.filter((s) => s === 200).length > ids.length - 6, `bild://: ${status}`)
        for (const mode of ['privat', 'nur-lesen', 'normal']) {
          await page.evaluate(([id, m]) => window.api.library.setFolderMode(id, m), [o.id, mode])
        }
        await page.evaluate((id) => window.api.library.rescan(id), o.id)
        await fertig()
        await stubConfirm(app, true)
        assert.equal(await page.evaluate((id) => window.api.library.removeFolder(id), o.id), true)
      }
    ],
    [
      'jede Datei der Bibliothek ist bitgleich, mit gleicher Änderungszeit – keine dazu, keine weg',
      async () => {
        assert.deepEqual(stand(bib.dir), vorher)
      }
    ]
  ])
} finally {
  await ctx.close()
  bib.aufraeumen()
}
