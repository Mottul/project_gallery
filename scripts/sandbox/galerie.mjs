// Abnahme in der Windows-Sandbox, Teil „Galerie mit Testbildern“ (Phase 1.6, Skill windows-paket).
// Läuft IN der Sandbox mit dem Node des Rechners (nur lesend eingebunden), aufgerufen von
// abnahme.ps1: steuert die INSTALLIERTE App über Playwright (wie e2e/paket.mjs die gepackte) –
// mit den echten Datenordnern des Benutzers, damit die Deinstallation danach zeigen kann, dass
// Index und Vorschaubilder wieder weg sind. Netz gibt es in der Sandbox nicht.
//
// Aufruf: node galerie.mjs <installierte exe> <Testbilder-Ordner> <Ergebnis-Ordner>
// Ausgabe: je Prüfung eine Zeile „OK      …“ / „FEHLER  …“ (übernimmt abnahme.ps1 in den Bericht),
// Exit-Code = Zahl der Fehler.

import { createHash } from 'node:crypto'
import { copyFileSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { _electron as electron } from 'playwright-core'

const [exe, bib, ergebnis] = process.argv.slice(2)
let fehler = 0
const zeile = (ok, name, detail = '') => {
  console.log(`${ok ? 'OK     ' : 'FEHLER '} ${name}${detail ? ' ' + detail : ''}`)
  if (!ok) fehler++
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function waitFor(fn, ms) {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    const v = await fn().catch(() => null)
    if (v) return v
    await sleep(250)
  }
  return null
}
/** Prüfsummen und Änderungszeiten aller Dateien der Testbibliothek */
const fingerabdruck = () =>
  Object.fromEntries(
    readdirSync(bib, { recursive: true })
      .map(String)
      .filter((f) => statSync(join(bib, f)).isFile())
      .sort()
      .map((f) => [
        f,
        createHash('sha256')
          .update(readFileSync(join(bib, f)))
          .digest('hex') +
          ':' +
          Math.trunc(statSync(join(bib, f)).mtimeMs)
      ])
  )

const manifest = JSON.parse(readFileSync(join(bib, 'testbilder.json'), 'utf8'))
const erwartet = manifest.eintraege.filter((e) => e.art === 'bild' || e.art === 'defekt').length
const vorher = fingerabdruck()

const app = await electron.launch({ executablePath: exe })
try {
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  const zustand = () => page.evaluate(() => window.api.library.state())

  // Ordner-Dialog im main ersetzen (wie stubOrdnerDialog im Harness)
  await app.evaluate(({ dialog }, pfad) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [pfad] })
  }, bib)
  await page.getByRole('heading', { name: 'Noch keine Ordner' }).waitFor({ timeout: 30_000 })
  const t0 = Date.now()
  await page.getByRole('main').getByRole('button', { name: 'Ordner hinzufügen' }).click()
  const o = await waitFor(async () => {
    const z = await zustand()
    const f = z.folders[0]
    return f?.status === 'bereit' &&
      f.lastScan &&
      f.count === erwartet &&
      z.metaPending === 0 &&
      z.thumbPending === 0
      ? { f, s: Math.round((Date.now() - t0) / 1000) }
      : null
  }, 180_000)
  zeile(
    !!o,
    'Testbilder eingelesen, Metadaten und Vorschaubilder fertig',
    o ? `(${erwartet} Bilder, ${o.s} s)` : JSON.stringify(await zustand())
  )
  zeile(o?.f.watch === 'live', 'Ordner wird überwacht', `(${o?.f.watch})`)

  // Vorschaubilder in der Galerie zu sehen
  const kacheln = await waitFor(
    () =>
      page.$$eval(
        '[role="listbox"][aria-label="Bilder"] img',
        (imgs) => imgs.filter((i) => i.complete && i.naturalWidth > 0).length
      ),
    15_000
  )
  zeile(kacheln > 0, 'Vorschaubilder in der Galerie sichtbar', `(${kacheln} Kacheln)`)

  // Sortieren nach Name: natürlich („Bild 2“ vor „Bild 10“)
  await page.getByRole('combobox', { name: 'Sortieren nach' }).selectOption('name')
  const namen = (
    await page.evaluate(async () =>
      window.api.library.details(await window.api.library.query({ feld: 'name', richtung: 'auf' }))
    )
  ).map((b) => b.name)
  zeile(
    namen.indexOf('Bild 2.jpg') < namen.indexOf('Bild 10.jpg') && namen.indexOf('Bild 2.jpg') >= 0,
    'Sortieren nach Name (natürlich)'
  )

  // Betrachter: Original über bild://
  await page.getByRole('listbox', { name: 'Bilder' }).getByRole('option').first().dblclick()
  const betrachter = page.getByRole('dialog', { name: 'Betrachter' })
  await betrachter.waitFor({ timeout: 10_000 }).catch(() => {})
  const original = await waitFor(
    () =>
      betrachter
        .locator('img:not([class~="invisible"])')
        .evaluateAll((imgs) =>
          imgs.some((i) => i.src.startsWith('bild:') && i.complete && i.naturalWidth > 0)
        ),
    10_000
  )
  zeile(!!original, 'Betrachter zeigt das Original (bild://)')
  await page.screenshot({ path: join(ergebnis, 'betrachter.png') }).catch(() => {})
  await page.keyboard.press('Escape')

  // Überwachen: eine Datei von außen erscheint ohne „Neu einlesen“
  const neu = join(bib, 'von außen.jpg')
  copyFileSync(join(bib, 'orte', 'paris.jpg'), neu)
  const da = await waitFor(async () => (await zustand()).folders[0]?.count === erwartet + 1, 20_000)
  zeile(!!da, 'Datei von außen erscheint (Überwachen)')
  rmSync(neu)
  await waitFor(async () => (await zustand()).folders[0]?.count === erwartet, 20_000)

  await page.screenshot({ path: join(ergebnis, 'galerie.png') }).catch(() => {})
} catch (err) {
  zeile(false, 'Ablauf', String(err?.message ?? err).split('\n')[0])
} finally {
  await Promise.race([app.close().catch(() => {}), sleep(20_000)])
}

// Originale unberührt: gleiche Dateien, gleicher Inhalt, gleiche Änderungszeit
const nachher = fingerabdruck()
const anders = Object.keys({ ...vorher, ...nachher }).filter((f) => vorher[f] !== nachher[f])
zeile(
  anders.length === 0,
  'Testbilder unverändert (Prüfsummen, Änderungszeit)',
  anders.slice(0, 3).join(', ')
)
process.exit(fehler)
