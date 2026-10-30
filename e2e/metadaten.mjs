// Metadaten schreiben in der echten App (Phase 3.1): Schnellbewertung im Betrachter schreibt sofort
// in die Datei (mit ExifTool nachgelesen), die Pixel bleiben gleich, Rückgängig stellt den alten
// Stand her. Sicherung einmal je Datei, im Ordner „privat“ keine. Abgelehnt: „nur lesen“, BMP,
// schreibgeschützt, von außen geänderte Datei – die Dateien bleiben dann unverändert. Fremde Werte
// werden nie zu Argumenten, Ungültiges lehnt der main ab; keine Nachbardatei bleibt liegen.

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  appendFileSync,
  chmodSync,
  existsSync,
  linkSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { werkzeug } from '../scripts/testbilder.mjs'
import {
  erwarteteBilder,
  kachel,
  launchApp,
  runSteps,
  stubOrdnerDialog,
  testbibliothek,
  waitFor
} from './harness.mjs'

sharp.cache({ files: 0 })
const EXIFTOOL = werkzeug('exiftool')
const bib = await testbibliothek()
const erwartet = erwarteteBilder(bib.manifest)
const userData = mkdtempSync(join(tmpdir(), 'galeria-e2e-'))
const ctx = await launchApp({ userData })
const { app, page } = ctx

const zustand = () => page.evaluate(() => window.api.library.state())
const betrachter = () => page.getByRole('dialog', { name: 'Betrachter' })
const rueckmeldung = () => betrachter().getByRole('status')
const warnung = () => betrachter().getByRole('alert')
const datei = (rel) => join(bib.dir, ...rel.split('/'))
/** Eintrag der Testbibliothek zu einem Dateinamen */
const eintrag = (name) => bib.manifest.eintraege.find((e) => e.datei.split('/').pop() === name)
const pfadVon = (name) => datei(eintrag(name).datei)

/** Tags der Datei, unabhängig von der App gelesen */
function tags(p) {
  const r = spawnSync(
    EXIFTOOL,
    ['-json', '-n', '-G0', '-XMP:Rating', '-EXIF:Rating', '-EXIF:RatingPercent', '-XMP:Label', p],
    { encoding: 'utf8' }
  )
  return JSON.parse(r.stdout)[0]
}
const pixel = async (p) => {
  const { data } = await sharp(p, { animated: true }).raw().toBuffer({ resolveWithObject: true })
  return createHash('sha256').update(data).digest('hex')
}
const inhalt = (p) => createHash('sha256').update(readFileSync(p)).digest('hex')

/** Bild im Betrachter öffnen (kommt die Kachel nicht, ist der Name falsch) */
async function oeffnen(name) {
  if (await betrachter().count()) await page.keyboard.press('Escape')
  await waitFor(async () => (await betrachter().count()) === 0, 3_000)
  await (await kachel(page, name)).dblclick()
  await betrachter().waitFor({ timeout: 5_000 })
  await betrachter().locator(`img[alt="${name}"]`).waitFor({ timeout: 10_000 })
}
/** Nach Name sortieren: Die Kacheln stehen dann fest */
const kennung = async (name) => {
  const ids = await page.evaluate(() => window.api.library.query({ feld: 'name', richtung: 'auf' }))
  const d = await page.evaluate((x) => window.api.library.details(x), ids)
  return d.find((b) => b.name === name)
}
/** Direkter Aufruf; Ablehnung als Text */
const schreibenRoh = (ids, a) =>
  page.evaluate(
    ([i, x]) =>
      window.api.meta.write(i, x).then(
        (r) => r,
        (e) => ({ abgelehnt: String(e.message) })
      ),
    [ids, a]
  )
const sicherungen = () => {
  const o = `${join(userData, 'lokal', 'Galeria Beata')} Sicherungen`
  if (!existsSync(o)) return []
  return readdirSync(o, { recursive: true })
    .map(String)
    .filter((n) => /\.\w+$/.test(n))
}
const reste = () =>
  readdirSync(bib.dir, { recursive: true })
    .map(String)
    .filter((n) => n.includes('galerie-tmp'))

const NAME = 'dubrovnik.jpg'
const NAME2 = 'paris.jpg'

try {
  await runSteps('Metadaten schreiben', [
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
        await page.getByRole('combobox', { name: 'Sortieren nach' }).selectOption('name')
      }
    ],
    [
      'Taste 3 schreibt sofort in die Datei; Pixel gleich, Index und Anzeige folgen',
      async () => {
        const p = pfadVon(NAME)
        const vorherPixel = await pixel(p)
        const vorher = tags(p)
        assert.equal(vorher['XMP:Rating'], 5, 'Testbild sollte 5 Sterne haben')
        await oeffnen(NAME)
        await page.keyboard.press('3')
        await rueckmeldung().getByText('3 Sterne gespeichert').waitFor({ timeout: 10_000 })
        const t = tags(p)
        assert.equal(t['XMP:Rating'], 3)
        assert.equal(t['EXIF:Rating'], 3)
        assert.equal(t['EXIF:RatingPercent'], 50)
        assert.equal(await pixel(p), vorherPixel, 'Pixel geändert')
        await betrachter().getByLabel('3 von 5 Sternen').waitFor({ timeout: 3_000 })
        const b = await kennung(NAME)
        assert.equal(b.rating, 3)
        assert.equal(b.size, statSync(p).size, 'Größe im Index veraltet')
        assert.equal(b.mtime, Math.trunc(statSync(p).mtimeMs), 'Zeit im Index veraltet')
        assert.deepEqual(reste(), [], 'Nachbardatei liegen geblieben')
        // eine eigene Änderung ist keine fehlende Datei, das Vorschaubild entsteht neu
        const z = await waitFor(async () => {
          const s = await zustand()
          return s.thumbPending === 0 ? s : null
        }, 15_000)
        assert.ok(z, 'Vorschaubild entsteht nicht neu')
        assert.equal(z.folders[0].missing, 0)
        const status = await app.evaluate(
          async ({ net }, id) => (await net.fetch(`thumb://id/${id}/256`)).status,
          b.id
        )
        assert.equal(status, 200, 'kein Vorschaubild nach dem Schreiben')
        // das Original ist im Betrachter weiter sichtbar
        assert.ok(await betrachter().locator(`img[alt="${NAME}"]`).isVisible())
      }
    ],
    [
      'Rückgängig stellt den alten Stand her, auch über Strg+Z; beide Wege lassen die Pixel',
      async () => {
        const p = pfadVon(NAME)
        const vorherPixel = await pixel(p)
        await rueckmeldung().getByRole('button', { name: 'Rückgängig' }).click()
        assert.ok(await waitFor(async () => tags(p)['XMP:Rating'] === 5, 5_000), 'nicht zurück')
        assert.equal(tags(p)['EXIF:Rating'], undefined, 'EXIF-Bewertung fehlte vorher')
        await betrachter().getByLabel('5 von 5 Sternen').waitFor({ timeout: 3_000 })
        await page.keyboard.press('1')
        await rueckmeldung().getByText('1 Stern gespeichert').waitFor({ timeout: 5_000 })
        await page.keyboard.press('Control+z')
        assert.ok(
          await waitFor(async () => tags(p)['XMP:Rating'] === 5, 5_000),
          'Strg+Z wirkt nicht'
        )
        assert.equal(await pixel(p), vorherPixel)
        assert.deepEqual(reste(), [])
      }
    ],
    [
      'Bewertung entfernen (0), Farblabel 6–9: gleiche Taste nimmt es wieder weg',
      async () => {
        const p = pfadVon(NAME)
        await page.keyboard.press('0')
        await rueckmeldung().getByText('Bewertung entfernt').waitFor({ timeout: 5_000 })
        assert.equal(tags(p)['XMP:Rating'], undefined)
        const label = tags(p)['XMP:Label']
        assert.equal(label, 'Red', 'Testbild sollte rot sein')
        await page.keyboard.press('7')
        await rueckmeldung().getByText('Farblabel Gelb gespeichert').waitFor({ timeout: 5_000 })
        assert.equal(tags(p)['XMP:Label'], 'Yellow')
        await page.keyboard.press('7')
        await rueckmeldung().getByText('Farblabel entfernt').waitFor({ timeout: 5_000 })
        assert.equal(tags(p)['XMP:Label'], undefined)
      }
    ],
    [
      'Sicherung: eine je Datei, bytegleich mit dem Stand vor der ersten Änderung',
      async () => {
        const liste = sicherungen()
        assert.equal(liste.length, 1, `Sicherungen: ${liste.join(', ')}`)
        assert.ok(liste[0].endsWith(NAME), liste[0])
        const p = pfadVon(NAME2)
        const vorher = inhalt(p)
        await oeffnen(NAME2)
        await page.keyboard.press('2')
        await rueckmeldung().getByText('2 Sterne gespeichert').waitFor({ timeout: 5_000 })
        await page.keyboard.press('4')
        await rueckmeldung().getByText('4 Sterne gespeichert').waitFor({ timeout: 5_000 })
        const neu = sicherungen().filter((n) => n.endsWith(NAME2))
        assert.equal(neu.length, 1, 'mehr als eine Sicherung je Datei')
        const o = `${join(userData, 'lokal', 'Galeria Beata')} Sicherungen`
        assert.equal(inhalt(join(o, neu[0])), vorher, 'Sicherung ist nicht der alte Stand')
        assert.notEqual(inhalt(p), vorher)
      }
    ],
    [
      'Von außen geändert: nichts geschrieben, Hinweis, Datei unverändert, wird neu eingelesen',
      async () => {
        const p = pfadVon(NAME2)
        // Hardlink außerhalb: fs.watch meldet das nicht – der Index kennt die Änderung noch nicht
        const link = join(userData, 'link.jpg')
        linkSync(p, link)
        appendFileSync(link, Buffer.alloc(16))
        const vorher = inhalt(p)
        await page.keyboard.press('5')
        await warnung().getByText('von außen geändert').waitFor({ timeout: 5_000 })
        assert.equal(inhalt(p), vorher, 'Datei wurde trotzdem geschrieben')
        assert.equal(tags(p)['XMP:Rating'], 4)
        assert.deepEqual(reste(), [])
        rmSync(link)
        assert.ok(
          await waitFor(async () => (await kennung(NAME2)).size === statSync(p).size, 10_000),
          'nicht neu eingelesen'
        )
      }
    ],
    [
      'Schreibgeschützt: abgelehnt mit Hinweis, Datei unverändert',
      async () => {
        const name = 'muenchen.jpg'
        const p = pfadVon(name)
        const vorher = inhalt(p)
        chmodSync(p, 0o444)
        try {
          await oeffnen(name)
          await page.keyboard.press('2')
          await warnung().getByText('schreibgeschützt').waitFor({ timeout: 5_000 })
          assert.equal(inhalt(p), vorher)
        } finally {
          chmodSync(p, 0o666)
        }
        assert.deepEqual(reste(), [])
      }
    ],
    [
      'BMP lässt sich nicht beschreiben: abgelehnt, Datei unverändert',
      async () => {
        const e = bib.manifest.eintraege.find((x) => x.datei.toLowerCase().endsWith('.bmp'))
        assert.ok(e, 'kein BMP in den Testbildern')
        const name = e.datei.split('/').pop()
        const b = await kennung(name)
        const vorher = inhalt(datei(e.datei))
        const r = await schreibenRoh([b.id], { bewertung: 3 })
        assert.equal(r.geschrieben.length, 0)
        assert.match(r.fehler[0].grund, /BMP/)
        assert.equal(inhalt(datei(e.datei)), vorher)
      }
    ],
    [
      'Fremde Werte bleiben Text: Zeilenumbruch und Optionen im Titel und in der Beschreibung',
      async () => {
        const b = await kennung('paris-texas.jpg')
        const p = pfadVon('paris-texas.jpg')
        const opfer = pfadVon('muenchen.jpg')
        const beschreibung = `x\n-delete_original!\n-XMP-dc:Title=eingeschleust\n${opfer}`
        const r = await schreibenRoh([b.id], { beschreibung })
        assert.equal(r.fehler.length, 0, JSON.stringify(r))
        assert.ok(existsSync(opfer), 'Datei gelöscht')
        const t = JSON.parse(
          spawnSync(EXIFTOOL, ['-json', '-G0', '-XMP:Description', '-XMP:Title', p], {
            encoding: 'utf8'
          }).stdout
        )[0]
        assert.equal(t['XMP:Description'], beschreibung)
        assert.notEqual(t['XMP:Title'], 'eingeschleust')
      }
    ],
    [
      'Im main abgelehnt: fremde Felder, Tag-Namen, Grenzen, Kennungen',
      async () => {
        const b = await kennung(NAME)
        for (const a of [
          {},
          { rating: 3 },
          { 'XMP-dc:Title': 'x' },
          { bewertung: 6 },
          { bewertung: '3' },
          { farblabel: 'Pink' },
          { titel: 'a\nb' },
          { titel: 'x'.repeat(501) }
        ]) {
          const r = await schreibenRoh([b.id], a)
          assert.match(r.abgelehnt ?? '', /Ungültige Änderung/, JSON.stringify(a))
        }
        const r = await schreibenRoh(['1'], { bewertung: 3 })
        assert.match(r.abgelehnt ?? '', /Ungültige Kennung/)
      }
    ],
    [
      '„privat“: geschrieben wird, aber ohne Sicherung; beim Wechsel gehen vorhandene weg',
      async () => {
        const [o] = (await zustand()).folders
        assert.ok(sicherungen().length >= 1, 'Vorbedingung: es gibt Sicherungen')
        await page.evaluate((id) => window.api.library.setFolderMode(id, 'privat'), o.id)
        assert.ok(await waitFor(() => sicherungen().length === 0, 5_000), 'Sicherungen bleiben')
        const b = await kennung(NAME)
        const r = await schreibenRoh([b.id], { bewertung: 2 })
        assert.equal(r.fehler.length, 0, JSON.stringify(r))
        assert.equal(sicherungen().length, 0, '„privat“ legte eine Sicherung an')
        await page.evaluate((id) => window.api.library.setFolderMode(id, 'normal'), o.id)
      }
    ],
    [
      '„nur lesen“: abgelehnt',
      async () => {
        const [o] = (await zustand()).folders
        await page.evaluate((id) => window.api.library.setFolderMode(id, 'nur-lesen'), o.id)
        const b = await kennung(NAME)
        const vorher = inhalt(pfadVon(NAME))
        const r = await schreibenRoh([b.id], { bewertung: 1 })
        await page.evaluate((id) => window.api.library.setFolderMode(id, 'normal'), o.id)
        assert.match(r.fehler[0]?.grund ?? '', /nur lesen/)
        assert.equal(inhalt(pfadVon(NAME)), vorher)
      }
    ],
    [
      'Log ohne Werte; keine Nachbardatei; keine Konsolenfehler',
      async () => {
        const log = readFileSync(join(userData, 'galeria-debug.log'), 'utf8')
        assert.ok(log.includes('[metadaten]'), 'Log enthält den Lauf nicht')
        for (const w of ['eingeschleust', 'delete_original', 'Yellow']) {
          assert.ok(!log.includes(w), `im Log: ${w}`)
        }
        assert.deepEqual(reste(), [])
        if (await betrachter().count()) await page.keyboard.press('Escape')
        assert.deepEqual(ctx.errors, [])
      }
    ]
  ])
} finally {
  await ctx.close()
  bib.aufraeumen()
  rmSync(userData, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
}
