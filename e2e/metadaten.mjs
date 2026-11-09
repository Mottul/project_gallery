// Metadaten schreiben in der echten App (Phase 3.1, Panel 3.2): Schnellbewertung im Betrachter schreibt
// sofort in die Datei (mit ExifTool nachgelesen), die Pixel bleiben gleich, Rückgängig stellt den alten
// Stand her. Das Bearbeiten-Panel liest aus der Datei und schreibt nur, was geändert wurde. Sicherung einmal je Datei, im Ordner „privat“ keine. Abgelehnt: „nur lesen“, BMP,
// schreibgeschützt, von außen geänderte Datei – die Dateien bleiben dann unverändert. Fremde Werte
// werden nie zu Argumenten, Ungültiges lehnt der main ab; keine Nachbardatei bleibt liegen.
// Mehrfachauswahl (3.3): Ansicht „Metadaten bearbeiten“ mit gemischten Werten, Stichwörter dazu/weg
// je Datei aus ihrer eigenen Liste, nur Geändertes, Konflikt mit „erneut versuchen“, Abbrechen,
// Rückgängig als ein Schritt, „nur lesen“ und „privat“ in der Auswahl, Schnellbewertung im Raster.

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  appendFileSync,
  chmodSync,
  copyFileSync,
  existsSync,
  linkSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import sharp from 'sharp'
import { werkzeug } from '../scripts/testbilder.mjs'
import {
  erwarteteBilder,
  kachel,
  launchApp,
  runSteps,
  stubConfirm,
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
/** Alle Tags der Datei, unabhängig von der App */
const alleTags = (p) =>
  JSON.parse(spawnSync(EXIFTOOL, ['-json', '-n', '-G0', '-a', p], { encoding: 'utf8' }).stdout)[0]
/** Die Felder, um die es im Panel geht, zum Vergleichen vorher/nachher */
const FELDER = [
  'XMP:Title',
  'IPTC:ObjectName',
  'EXIF:XPTitle',
  'XMP:Description',
  'EXIF:ImageDescription',
  'EXIF:XPComment',
  'XMP:Subject',
  'IPTC:Keywords',
  'EXIF:XPKeywords',
  'XMP:Rating',
  'EXIF:DateTimeOriginal',
  'EXIF:CreateDate',
  'Composite:GPSLatitude',
  'Composite:GPSLongitude',
  'XMP:City',
  'XMP:Creator',
  'EXIF:Artist',
  'XMP:Rights',
  'EXIF:Copyright'
]
const feldwerte = (p) => {
  const t = alleTags(p)
  return Object.fromEntries(FELDER.map((k) => [k, t[k] ?? null]))
}
const panel = () => betrachter().getByRole('complementary', { name: 'Metadaten bearbeiten' })
const schreibKnopf = () => panel().getByRole('button', { name: 'In die Datei schreiben' })
const feld = (n) => panel().getByLabel(n, { exact: true })
const beschreibung = () => panel().getByRole('textbox', { name: 'Beschreibung', exact: true })
/** Panel öffnen und warten, bis die Datei gelesen ist */
async function bearbeiten() {
  await page.keyboard.press('e')
  await feld('Titel').waitFor({ timeout: 5_000 })
}
const pixel = async (p) => {
  const { data } = await sharp(p, { animated: true }).raw().toBuffer({ resolveWithObject: true })
  return createHash('sha256').update(data).digest('hex')
}
const inhalt = (p) => createHash('sha256').update(readFileSync(p)).digest('hex')

/** Bild im Betrachter öffnen (kommt die Kachel nicht, ist der Name falsch) */
async function oeffnen(name) {
  // Ein gescheiterter Schritt kann das Panel mit Eingaben offen lassen; es hielte den Betrachter
  // offen und der nächste Schritt schiene mit rot. Abbrechen verwirft die Eingaben.
  if (await panel().count()) await panel().getByRole('button', { name: 'Abbrechen' }).click()
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
// wie lokaleDaten.ts: unter Windows im (umgeleiteten) LOCALAPPDATA, sonst neben userData/lokal
const SICHERUNGEN = `${
  process.platform === 'win32' ? join(userData, 'lokal', 'Galeria Beata') : join(userData, 'lokal')
} Sicherungen`
const sicherungen = () => {
  if (!existsSync(SICHERUNGEN)) return []
  return readdirSync(SICHERUNGEN, { recursive: true })
    .map(String)
    .filter((n) => /\.\w+$/.test(n))
}
const reste = () =>
  readdirSync(bib.dir, { recursive: true })
    .map(String)
    .filter((n) => n.includes('galerie-tmp'))
/**
 * Ein anderes Programm schreibt in die Datei (ExifTool an der App vorbei, an Ort und Stelle). Werte
 * nur ASCII: Unter Windows kommen Argumente der Befehlszeile in der Codepage an, nicht als UTF-8.
 */
function vonAussen(p, args) {
  const r = spawnSync(EXIFTOOL, ['-overwrite_original_in_place', ...args, p], { encoding: 'utf8' })
  assert.match(r.stdout, /1 image files updated/, r.stderr)
}
/**
 * Hält `meta:read` (Channels.metaRead) für dieses Fenster an: `webContents.ipc.handle` geht vor dem
 * Handler der App in `ipcMain`. Die Antwort `antwort` kommt erst nach `frei()` – so lässt sich
 * zwischen Start und Ergebnis des Lesens tippen, ohne auf Zeit zu setzen.
 */
const leseSperre = (antwort) =>
  app.evaluate(({ BrowserWindow }, a) => {
    let frei
    const offen = new Promise((r) => (frei = r))
    globalThis.__leseSperre = { aufrufe: 0, frei }
    BrowserWindow.getAllWindows()[0].webContents.ipc.handle('meta:read', async () => {
      globalThis.__leseSperre.aufrufe++
      await offen
      return a
    })
  }, antwort)
const leseSperreAufrufe = () => app.evaluate(() => globalThis.__leseSperre.aufrufe).catch(() => 0)
const leseSperreFrei = () => app.evaluate(() => globalThis.__leseSperre.frei())
/** Danach antwortet wieder die App */
const leseSperreAus = () =>
  app.evaluate(({ BrowserWindow }) => {
    globalThis.__leseSperre?.frei()
    BrowserWindow.getAllWindows()[0].webContents.ipc.removeHandler('meta:read')
  })

const NAME = 'dubrovnik.jpg'
const NAME2 = 'paris.jpg'

// ── Mehrfachauswahl (3.3) ─────────────────────────────────────────────────────────────────────
// Drei Dateien mit je eigener Stichwortliste, bevor die App sie liest: „urlaub“ klein, „Meer“ in
// Bild 2 nur in IPTC – so zählen Groß/Klein und alle Orte der Stichwörter
const M1 = 'bild 1.jpg'
const M2 = 'Bild 2.jpg'
const M3 = 'Bild 10.jpg'
vonAussen(pfadVon(M1), [
  '-XMP-dc:Subject=Urlaub',
  '-XMP-dc:Subject=Meer',
  '-XMP-xmp:Rating=4',
  '-XMP-dc:Creator=Testperson'
])
vonAussen(pfadVon(M2), [
  '-XMP-dc:Subject=urlaub',
  '-XMP-dc:Subject=Kroatien',
  '-IPTC:Keywords=Meer',
  '-XMP-xmp:Rating=2',
  '-XMP-dc:Creator=Testperson'
])
vonAussen(pfadVon(M3), [
  '-XMP-dc:Subject=Kroatien',
  '-XMP-dc:Subject=Altstadt',
  '-XMP-dc:Creator=Testperson'
])

const ansicht = () => page.getByRole('dialog', { name: 'Metadaten bearbeiten' })
const ansichtFeld = (n) => ansicht().getByLabel(n, { exact: true })
const mehrfachSchreiben = () =>
  ansicht().getByRole('button', { name: /^In \d+ (Datei|Dateien) schreiben$/ })
const bericht = () => ansicht().getByRole('status')
const rasterHinweis = () => page.getByRole('main').getByRole('status')
/** ExifTool gibt eine Liste mit einem Wert als Text aus */
const liste = (v) => (v === undefined || v === null ? [] : Array.isArray(v) ? v : [v]).map(String)
/** Stichwörter einer Datei in allen drei Orten, unabhängig von der App gelesen */
function stichwortOrte(p) {
  const t = alleTags(p)
  return {
    xmp: liste(t['XMP:Subject']),
    iptc: liste(t['IPTC:Keywords']),
    xp: t['EXIF:XPKeywords'] ?? null
  }
}
/** Status-Zeile einer Datei in der Liste links */
const statusVon = async (name) =>
  (
    await ansicht()
      .getByRole('list', { name: 'Ausgewählte Bilder' })
      .getByRole('listitem')
      .filter({ hasText: name })
      .first()
      .innerText()
  )
    .split('\n')
    .at(-1)
/** In „Alle Bilder“ (nach Name) genau diese Kacheln wählen – die erste per Klick, dann mit Strg */
async function waehlen(namen) {
  // eine offen gebliebene Ansicht (gescheiterter Schritt) läge über der Galerie
  if (await ansicht().count()) await ansichtZu()
  await page
    .getByRole('navigation', { name: 'Bibliothek und Ordner' })
    .getByRole('button', { name: /^Alle Bilder/ })
    .click()
  for (const [i, n] of namen.entries()) {
    await (await kachel(page, n)).click(i ? { modifiers: ['Control'] } : {})
  }
}
/** Die Ansicht für diese Bilder öffnen (Taste E oder Knopf) und warten, bis gelesen ist */
async function ansichtOeffnen(namen, ueber = 'taste') {
  if (await ansicht().count()) await ansichtZu()
  await waehlen(namen)
  if (ueber === 'knopf') {
    await page.getByRole('button', { name: 'Metadaten', exact: true }).click()
  } else await page.keyboard.press('e')
  await ansicht().waitFor({ timeout: 5_000 })
  await ansichtFeld('Urheber').waitFor({ timeout: 15_000 })
}
/** Ansicht schließen (verwirft Eingaben) */
async function ansichtZu() {
  const knopf = ansicht().getByRole('button', { name: /^(Abbrechen|Schließen)$/ })
  if (await knopf.count()) await knopf.click()
  await waitFor(async () => (await ansicht().count()) === 0, 5_000)
}
/** Dialoge des main ersetzen und ihre Fragen mitschreiben (Antworten der Reihe nach) */
const fragen = (antworten) =>
  app.evaluate(({ dialog }, a) => {
    globalThis.__fragen = []
    globalThis.__antworten = [...a]
    dialog.showMessageBox = async (...args) => {
      const o = args.find((x) => x && typeof x === 'object' && 'message' in x)
      globalThis.__fragen.push(o?.message)
      return { response: globalThis.__antworten.shift() ?? 1, checkboxChecked: false }
    }
  }, antworten)
const gestellt = () => app.evaluate(() => globalThis.__fragen)

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
        assert.equal(
          inhalt(join(SICHERUNGEN, neu[0])),
          vorher,
          'Sicherung ist nicht der alte Stand'
        )
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
      'Panel zeigt, was in der Datei steht; ohne Änderung lässt sich nichts schreiben',
      async () => {
        await oeffnen('muenchen.jpg')
        await bearbeiten()
        // das Feld lässt volle Sekunden weg
        assert.equal(await feld('Aufnahme').inputValue(), '2023-12-24T16:00')
        assert.match(await feld('Standort (Breite, Länge)').inputValue(), /^48\.\d+, 11\.\d+$/)
        const worte = await panel().getByRole('list', { name: 'Stichwörter' }).getByRole('listitem')
        assert.deepEqual(await worte.allInnerTexts(), ['Familie', 'Weihnachten', 'Winter'])
        assert.equal(
          await panel().getByRole('button', { name: '3 Sterne' }).getAttribute('aria-pressed'),
          'true'
        )
        assert.ok(await schreibKnopf().isDisabled(), 'Schreiben ohne Änderung möglich')
      }
    ],
    [
      'Getipptes löst keine Tasten aus; geschrieben wird nur, was geändert wurde',
      async () => {
        const p = pfadVon('muenchen.jpg')
        const vorher = feldwerte(p)
        const vorherPixel = await pixel(p)
        // Ziffern und „e“ im Text: keine Bewertung, kein Schreiben
        await beschreibung().pressSequentially('Krippe 2 am Abend')
        await page.keyboard.press('Enter')
        await beschreibung().pressSequentially('zweite Zeile')
        assert.equal(tags(p)['XMP:Rating'], 3, 'Tippen hat bewertet')
        await feld('Titel').fill('Krippe 🌟')
        await panel().getByRole('button', { name: 'Stichwort „Winter“ entfernen' }).click()
        await feld('Stichwort hinzufügen').fill('Schnee')
        await feld('Stichwort hinzufügen').press('Enter')
        await feld('Ort').fill('Köln')
        await feld('Urheber').fill('Testperson')
        await feld('Copyright').fill('© Testperson')
        await schreibKnopf().click()
        await rueckmeldung().getByText('In die Datei geschrieben').waitFor({ timeout: 10_000 })
        const t = feldwerte(p)
        assert.equal(t['XMP:Title'], 'Krippe 🌟')
        assert.equal(t['EXIF:XPTitle'], 'Krippe', 'XP-Feld ohne Emoji')
        assert.equal(t['XMP:Description'], 'Krippe 2 am Abend\nzweite Zeile')
        assert.deepEqual(t['XMP:Subject'], ['Familie', 'Weihnachten', 'Schnee'])
        assert.deepEqual(t['IPTC:Keywords'], ['Familie', 'Weihnachten', 'Schnee'])
        assert.equal(t['EXIF:XPKeywords'], 'Familie;Weihnachten;Schnee')
        assert.equal(t['XMP:City'], 'Köln')
        assert.equal(t['XMP:Creator'], 'Testperson')
        assert.equal(t['EXIF:Artist'], 'Testperson')
        assert.equal(t['EXIF:Copyright'], '© Testperson')
        // nicht angefasst: unverändert
        for (const k of ['XMP:Rating', 'EXIF:DateTimeOriginal', 'Composite:GPSLatitude']) {
          assert.equal(t[k], vorher[k], k)
        }
        assert.equal(await pixel(p), vorherPixel, 'Pixel geändert')
        assert.deepEqual(reste(), [])
        // Info-Panel und Index folgen, der Ort aus der Datei geht vor dem aus GPS
        const info = betrachter().getByRole('complementary', { name: 'Informationen zum Bild' })
        await info.getByRole('heading', { name: 'Krippe 🌟' }).waitFor({ timeout: 3_000 })
        const b = await kennung('muenchen.jpg')
        assert.equal(b.title, 'Krippe 🌟')
        assert.deepEqual(b.keywords.sort(), ['Familie', 'Schnee', 'Weihnachten'])
        assert.equal(b.place.name, 'Köln')
        const q = await page.evaluate(() =>
          window.api.library.queryGroups(
            { feld: 'name', richtung: 'auf' },
            undefined,
            'aus',
            false,
            {
              suche: 'schnee'
            }
          )
        )
        assert.deepEqual(q.ids, [b.id], 'Suchindex folgt nicht')
      }
    ],
    [
      'Rückgängig stellt alle Felder her',
      async () => {
        const p = pfadVon('muenchen.jpg')
        await rueckmeldung().getByRole('button', { name: 'Rückgängig' }).click()
        assert.ok(
          await waitFor(async () => feldwerte(p)['XMP:Title'] === null, 5_000),
          'Titel nicht zurück'
        )
        const t = feldwerte(p)
        assert.deepEqual(t['XMP:Subject'], ['Familie', 'Weihnachten'])
        assert.deepEqual(t['IPTC:Keywords'], ['Weihnachten', 'Winter'])
        assert.equal(t['XMP:Description'], null)
        assert.equal(t['XMP:City'], null)
        assert.equal(t['EXIF:Artist'], null)
      }
    ],
    [
      'Standort entfernen nimmt alle GPS-Tags weg, Rückgängig bringt sie zurück',
      async () => {
        const p = pfadVon('muenchen.jpg')
        const vorher = alleTags(p)
        assert.ok(vorher['Composite:GPSLatitude'], 'Testbild ohne Standort')
        await bearbeiten()
        await panel().getByRole('button', { name: 'Standort entfernen' }).click()
        await schreibKnopf().click()
        await rueckmeldung().getByText('In die Datei geschrieben').waitFor({ timeout: 5_000 })
        const danach = Object.keys(alleTags(p)).filter((k) => /GPS/.test(k))
        assert.deepEqual(danach, [], 'GPS-Tags übrig')
        assert.equal((await kennung('muenchen.jpg')).gps, null)
        await rueckmeldung().getByRole('button', { name: 'Rückgängig' }).click()
        assert.ok(
          await waitFor(
            async () =>
              Math.abs(alleTags(p)['Composite:GPSLatitude'] - vorher['Composite:GPSLatitude']) <
              1e-5,
            5_000
          ),
          'Standort nicht zurück'
        )
      }
    ],
    [
      'Datum und Standort setzen: Index und Sortierung folgen',
      async () => {
        const p = pfadVon('paris.jpg')
        await oeffnen('paris.jpg')
        await bearbeiten()
        await feld('Aufnahme').fill('2020-02-03T04:05:06')
        await feld('Standort (Breite, Länge)').fill('-33,8568 151,2153')
        await schreibKnopf().click()
        await rueckmeldung().getByText('In die Datei geschrieben').waitFor({ timeout: 5_000 })
        const t = alleTags(p)
        assert.equal(t['EXIF:DateTimeOriginal'], '2020:02:03 04:05:06')
        assert.equal(t['EXIF:OffsetTimeOriginal'], '+02:00', 'Zone bleibt')
        assert.ok(Math.abs(t['Composite:GPSLatitude'] + 33.8568) < 1e-5)
        assert.ok(Math.abs(t['Composite:GPSLongitude'] - 151.2153) < 1e-5)
        const b = await kennung('paris.jpg')
        assert.equal(b.takenAt, '2020-02-03T04:05:06')
        assert.equal(b.takenSource, 'exif')
        assert.notEqual(b.place?.name, 'Paris')
      }
    ],
    [
      'Ungespeichertes: kein Weiterblättern, kein Schließen; Abbrechen ändert nichts',
      async () => {
        const p = pfadVon('paris.jpg')
        const vorher = inhalt(p)
        await bearbeiten()
        await feld('Titel').fill('Nur ein Versuch')
        await betrachter().getByRole('button', { name: 'Nächstes Bild' }).click()
        await warnung().getByText('erst in die Datei schreiben').waitFor({ timeout: 3_000 })
        assert.equal(await betrachter().getByRole('heading', { level: 2 }).innerText(), 'paris.jpg')
        await betrachter().getByRole('button', { name: 'Zurück zur Galerie' }).click()
        assert.equal(await betrachter().count(), 1, 'Betrachter ging zu')
        // Ungültiges: Hinweis, Schreiben gesperrt
        await feld('Standort (Breite, Länge)').fill('Dubrovnik')
        await panel().getByRole('alert').getByText('Breite, Länge').waitFor({ timeout: 3_000 })
        assert.ok(await schreibKnopf().isDisabled())
        await panel().getByRole('button', { name: 'Abbrechen' }).click()
        await panel().waitFor({ state: 'detached', timeout: 3_000 })
        assert.equal(inhalt(p), vorher, 'Abbrechen hat geschrieben')
        // danach geht wieder alles
        await betrachter().getByRole('button', { name: 'Nächstes Bild' }).click()
        assert.ok(
          await waitFor(
            async () =>
              (await betrachter().getByRole('heading', { level: 2 }).innerText()) !== 'paris.jpg',
            5_000
          ),
          'Weiterblättern gesperrt'
        )
      }
    ],
    [
      'Datei ändert sich während des Tippens: Rückfrage, Eingaben bleiben, bis entschieden ist',
      async () => {
        const name = 'muenchen.jpg'
        const p = pfadVon(name)
        await oeffnen(name)
        await bearbeiten()
        await feld('Titel').fill('Meine Eingabe')
        appendFileSync(p, Buffer.alloc(32))
        await panel().getByText('von außen geändert').waitFor({ timeout: 15_000 })
        assert.equal(await feld('Titel').inputValue(), 'Meine Eingabe', 'Eingabe verloren')
        assert.ok(await schreibKnopf().isDisabled(), 'Schreiben trotz Konflikt möglich')
        await panel().getByRole('button', { name: 'Neu laden' }).click()
        assert.ok(
          await waitFor(async () => (await feld('Titel').inputValue()) === '', 5_000),
          'nicht neu geladen'
        )
        // Ohne Eingaben liest das Panel still neu. Erst tippen, wenn es den neuen Stand zeigt: Der
        // Index weiß es früher als das Panel – wer dann tippt, bekommt die Rückfrage (so wackelte
        // dieser Schritt in der Linux-CI)
        vonAussen(p, ['-XMP:Title=Anderes Programm'])
        assert.ok(
          await waitFor(
            async () => (await feld('Titel').inputValue()) === 'Anderes Programm',
            15_000
          ),
          `nicht still neu gelesen: ${await feld('Titel').inputValue()}`
        )
        assert.equal(
          await panel().getByText('von außen geändert').count(),
          0,
          'Rückfrage ohne Eingabe'
        )
        await feld('Titel').fill('Danach geht es')
        await schreibKnopf().click()
        await rueckmeldung().getByText('In die Datei geschrieben').waitFor({ timeout: 10_000 })
        assert.equal(feldwerte(p)['XMP:Title'], 'Danach geht es')
      }
    ],
    [
      'Getippt, während das Panel still neu liest: Eingabe bleibt, Rückfrage statt Überschreiben',
      async () => {
        const name = 'muenchen.jpg'
        const p = pfadVon(name)
        await oeffnen(name)
        await bearbeiten()
        const { id } = await kennung(name)
        // Antwort mit einem Titel, den die Datei nicht hat: Steht er im Feld, hat das Ergebnis die
        // Eingabe überschrieben
        const echt = await page.evaluate((i) => window.api.meta.read(i), id)
        assert.ok(echt.werte, JSON.stringify(echt))
        await leseSperre({ werte: { ...echt.werte, titel: 'Aus dem Neulesen' } })
        try {
          appendFileSync(p, Buffer.alloc(8))
          assert.ok(
            await waitFor(async () => (await leseSperreAufrufe()) > 0, 15_000),
            'Panel liest nicht neu'
          )
          await feld('Titel').fill('Während des Lesens')
          await panel().getByText('von außen geändert').waitFor({ timeout: 5_000 })
          await leseSperreFrei()
          // Die Antwort ist in Millisekunden da – überschreibt sie, sieht man es in dieser Zeit
          const ueberschrieben = await waitFor(
            async () => (await feld('Titel').inputValue()) !== 'Während des Lesens',
            2_000
          )
          assert.equal(
            ueberschrieben,
            null,
            `Eingabe überschrieben: ${await feld('Titel').inputValue()}`
          )
          assert.ok(await panel().getByText('von außen geändert').isVisible(), 'Rückfrage weg')
          assert.ok(await schreibKnopf().isDisabled(), 'Schreiben trotz Konflikt möglich')
        } finally {
          await leseSperreAus()
        }
        // „Eingaben behalten“ schreibt die Eingabe in die geänderte Datei
        await panel().getByRole('button', { name: 'Eingaben behalten' }).click()
        await schreibKnopf().click()
        await rueckmeldung().getByText('In die Datei geschrieben').waitFor({ timeout: 10_000 })
        assert.equal(feldwerte(p)['XMP:Title'], 'Während des Lesens')
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
        // auch das Panel lässt sich dann nicht öffnen
        await oeffnen(NAME)
        // erst, wenn die Oberfläche den neuen Modus kennt: Der Knopf im Info-Panel ist dann gesperrt
        await page.keyboard.press('i')
        const knopf = betrachter().getByRole('button', { name: 'Bearbeiten' })
        assert.ok(await waitFor(() => knopf.isDisabled(), 5_000), 'Knopf nicht gesperrt')
        await page.keyboard.press('e')
        await warnung().getByText('nur lesen').waitFor({ timeout: 3_000 })
        assert.equal(await panel().count(), 0, 'Panel offen trotz „nur lesen“')
        await page.keyboard.press('Escape')
        await page.evaluate((id) => window.api.library.setFolderMode(id, 'normal'), o.id)
        assert.match(r.fehler[0]?.grund ?? '', /nur lesen/)
        assert.equal(inhalt(pfadVon(NAME)), vorher)
      }
    ],
    [
      'Mehrfach: Taste E öffnet die Ansicht mit gemischten Werten aus den Dateien',
      async () => {
        await ansichtOeffnen([M1, M2, M3])
        await ansicht().getByText('3 Bilder ausgewählt').waitFor({ timeout: 3_000 })
        // Stichwörter ohne Groß/Klein gezählt, über XMP und IPTC; gestrichelt mit n/N
        const chips = ansicht().getByRole('list', { name: 'Stichwörter' }).getByRole('listitem')
        const gesehen = await chips.evaluateAll((l) =>
          l.map((e) => `${e.firstElementChild?.textContent} ${e.dataset.anzahl}`)
        )
        assert.deepEqual(gesehen.sort(), ['Altstadt 1/3', 'Kroatien 2/3', 'Meer 2/3', 'Urlaub 2/3'])
        assert.equal(await ansichtFeld('Urheber').inputValue(), 'Testperson', 'gleicher Wert fehlt')
        assert.equal(await ansichtFeld('Titel').inputValue(), '')
        await ansicht().getByText('‹verschieden› (0–5 Sterne)').waitFor({ timeout: 3_000 })
        assert.ok((await mehrfachSchreiben().count()) === 0, 'ohne Änderung schreibbar')
      }
    ],
    [
      'Mehrfach: Stichwörter dazu/weg je Datei in XMP, IPTC und Windows; nur Geändertes; je Datei eine Sicherung',
      async () => {
        const pfade = [M1, M2, M3].map(pfadVon)
        const vorherPixel = await Promise.all(pfade.map(pixel))
        const sicherungenVorher = sicherungen().length
        await ansicht().getByRole('button', { name: '„Meer“ bei allen entfernen' }).click()
        await ansichtFeld('Stichwort für alle hinzufügen').fill('Größe')
        await ansichtFeld('Stichwort für alle hinzufügen').press('Enter')
        await ansicht().getByRole('button', { name: '„Altstadt“ bei allen hinzufügen' }).click()
        await ansicht().getByRole('button', { name: 'Alle auf 3 Sterne' }).click()
        await ansicht().getByText('2 Felder geändert').waitFor({ timeout: 3_000 })
        await mehrfachSchreiben().click()
        await bericht().getByText('3 Dateien geschrieben und geprüft').waitFor({ timeout: 20_000 })
        // je Datei aus ihrer eigenen Liste – nie die der ersten auf alle kopiert
        const erwartet = [
          ['Urlaub', 'Größe', 'Altstadt'],
          ['urlaub', 'Kroatien', 'Größe', 'Altstadt'],
          ['Kroatien', 'Altstadt', 'Größe']
        ]
        for (const [i, p] of pfade.entries()) {
          const o = stichwortOrte(p)
          assert.deepEqual(o.xmp, erwartet[i], `XMP ${p}`)
          assert.deepEqual(o.iptc, erwartet[i], `IPTC ${p}`)
          assert.equal(o.xp, erwartet[i].join(';'), `XP ${p}`)
          const t = alleTags(p)
          assert.equal(t['XMP:Rating'], 3)
          assert.equal(t['EXIF:Rating'], 3)
          // nicht angefasst
          assert.equal(t['XMP:Creator'], 'Testperson')
          assert.equal(t['XMP:Title'], undefined)
          assert.equal(await pixel(p), vorherPixel[i], `Pixel ${p}`)
        }
        for (const n of [M1, M2, M3]) {
          assert.equal(await statusVon(n), 'Geschrieben · Sicherung angelegt · geprüft', n)
        }
        assert.equal(sicherungen().length, sicherungenVorher + 3, 'nicht je Datei eine Sicherung')
        assert.deepEqual(reste(), [])
        // Index und Suche folgen
        const q = await page.evaluate(() =>
          window.api.library.queryGroups(
            { feld: 'name', richtung: 'auf' },
            undefined,
            'aus',
            false,
            {
              suche: 'größe'
            }
          )
        )
        assert.equal(q.ids.length, 3, 'Suchindex folgt nicht')
        // danach liest die Ansicht neu: alle drei haben jetzt „Größe“ und „Altstadt“
        await ansicht()
          .getByRole('list', { name: 'Stichwörter' })
          .getByRole('listitem')
          .filter({ hasText: 'Altstadt' })
          .and(ansicht().locator('[data-anzahl="3/3"]'))
          .waitFor({ timeout: 10_000 })
      }
    ],
    [
      'Mehrfach: Rückgängig nimmt den ganzen Auftrag in einem Schritt zurück',
      async () => {
        await bericht().getByRole('button', { name: 'Rückgängig' }).click()
        await bericht().getByText('Rückgängig gemacht: 3 Dateien').waitFor({ timeout: 20_000 })
        const vorher = [
          { xmp: ['Urlaub', 'Meer'], iptc: [], xp: null, r: 4 },
          { xmp: ['urlaub', 'Kroatien'], iptc: ['Meer'], xp: null, r: 2 },
          { xmp: ['Kroatien', 'Altstadt'], iptc: [], xp: null, r: undefined }
        ]
        for (const [i, n] of [M1, M2, M3].entries()) {
          const o = stichwortOrte(pfadVon(n))
          assert.deepEqual(o, { xmp: vorher[i].xmp, iptc: vorher[i].iptc, xp: null }, n)
          assert.equal(alleTags(pfadVon(n))['XMP:Rating'], vorher[i].r, n)
          assert.equal(await statusVon(n), 'Zurückgenommen · geprüft', n)
        }
        assert.deepEqual(reste(), [])
        await ansichtZu()
      }
    ],
    [
      'Mehrfach: Wer die Werte schon hat, bleibt unberührt (Knopf „Metadaten“)',
      async () => {
        const sonne = 'Sonne 🌞.jpg'
        const vorher = inhalt(pfadVon(sonne))
        const sicherungenVorher = sicherungen().length
        await ansichtOeffnen([M1, sonne], 'knopf')
        await ansichtFeld('Titel').fill('Grüße aus Köln 🌞')
        await mehrfachSchreiben().click()
        await bericht().getByText('1 Datei geschrieben und geprüft').waitFor({ timeout: 20_000 })
        await bericht().getByText('1 Datei hatte die Werte schon.').waitFor({ timeout: 3_000 })
        assert.equal(inhalt(pfadVon(sonne)), vorher, 'unberührte Datei geändert')
        assert.equal(alleTags(pfadVon(M1))['XMP:Title'], 'Grüße aus Köln 🌞')
        assert.equal(await statusVon(sonne), 'Hatte die Werte schon – nicht geschrieben')
        // M1 hatte schon eine Sicherung, die unberührte bekommt keine
        assert.equal(await statusVon(M1), 'Geschrieben · Sicherung vorhanden · geprüft')
        assert.equal(sicherungen().length, sicherungenVorher)
        await bericht().getByRole('button', { name: 'Rückgängig' }).click()
        await bericht().getByText('Rückgängig gemacht: 1 Datei').waitFor({ timeout: 20_000 })
        assert.equal(alleTags(pfadVon(M1))['XMP:Title'], undefined)
        await ansichtZu()
      }
    ],
    [
      'Mehrfach: von außen geändert wird übersprungen; „Neu lesen und erneut versuchen“ schreibt danach',
      async () => {
        await ansichtOeffnen([M1, M2, M3])
        // nach dem Lesen über einen Hardlink außerhalb ändern: fs.watch meldet das nicht
        const p = pfadVon(M2)
        const link = join(userData, 'link-mehrfach.jpg')
        linkSync(p, link)
        appendFileSync(link, Buffer.alloc(16))
        rmSync(link)
        const geaendert = inhalt(p)
        await ansicht().getByRole('button', { name: 'Alle auf 1 Stern' }).click()
        await mehrfachSchreiben().click()
        await bericht().getByText('2 Dateien geschrieben und geprüft').waitFor({ timeout: 20_000 })
        await bericht()
          .getByText(`${M2} wurde inzwischen von einem anderen Programm geändert`)
          .waitFor({ timeout: 3_000 })
        assert.equal(inhalt(p), geaendert, 'geänderte Datei trotzdem geschrieben')
        assert.equal(await statusVon(M2), 'Inzwischen außerhalb geändert – übersprungen.')
        assert.equal(alleTags(pfadVon(M1))['XMP:Rating'], 1)
        await bericht().getByRole('button', { name: 'Neu lesen und erneut versuchen' }).click()
        await bericht().getByText('3 Dateien geschrieben und geprüft').waitFor({ timeout: 30_000 })
        assert.equal(await bericht().getByText('anderen Programm').count(), 0, 'Konflikt bleibt')
        assert.equal(alleTags(p)['XMP:Rating'], 1)
        assert.equal(await statusVon(M2), 'Geschrieben · Sicherung vorhanden · geprüft')
        // Rückgängig nimmt beides zurück: den Auftrag und das erneute Versuchen
        await bericht().getByRole('button', { name: 'Rückgängig' }).click()
        await bericht().getByText('Rückgängig gemacht: 3 Dateien').waitFor({ timeout: 20_000 })
        assert.equal(alleTags(pfadVon(M1))['XMP:Rating'], 4)
        assert.equal(alleTags(p)['XMP:Rating'], 2)
        assert.equal(alleTags(pfadVon(M3))['XMP:Rating'], undefined)
        assert.deepEqual(reste(), [])
        await ansichtZu()
      }
    ],
    [
      'Mehrfach: Abbrechen hält nach der laufenden Datei an; Geschriebenes bleibt und steht im Bericht',
      async () => {
        await page
          .getByRole('tree', { name: 'Ordner' })
          .getByRole('button', { name: 'ausrichtung', exact: true })
          .click()
        await (await kachel(page, 'ausrichtung-1.jpg')).click()
        await page.keyboard.press('Control+a')
        await page.keyboard.press('e')
        await ansichtFeld('Urheber').waitFor({ timeout: 15_000 })
        await ansicht().getByText('8 Bilder ausgewählt').waitFor({ timeout: 3_000 })
        const namen = Array.from({ length: 8 }, (_, i) => `ausrichtung-${i + 1}.jpg`)
        const vorher = new Map(namen.map((n) => [n, inhalt(pfadVon(n))]))
        await ansicht().getByRole('button', { name: 'Alle auf 5 Sterne' }).click()
        await mehrfachSchreiben().click()
        // anhalten, sobald die erste Datei fertig ist
        await ansicht()
          .getByText(/Schreibt … [1-7] von 8/)
          .waitFor({ timeout: 20_000 })
        await ansicht().getByRole('button', { name: 'Abbrechen', exact: true }).click()
        await bericht()
          .getByText(/Abgebrochen – \d von 8 bearbeitet/)
          .waitFor({ timeout: 20_000 })
        const geschrieben = namen.filter((n) => inhalt(pfadVon(n)) !== vorher.get(n))
        assert.ok(geschrieben.length >= 1 && geschrieben.length < 8, `${geschrieben.length} von 8`)
        for (const n of namen) {
          const ja = geschrieben.includes(n)
          assert.equal(alleTags(pfadVon(n))['XMP:Rating'], ja ? 5 : undefined, n)
          assert.match(
            await statusVon(n),
            ja ? /^Geschrieben · Sicherung angelegt/ : /^Nicht bearbeitet – abgebrochen$/,
            n
          )
        }
        await bericht()
          .getByText(
            `${geschrieben.length === 1 ? '1 Datei' : `${geschrieben.length} Dateien`} geschrieben`
          )
          .waitFor({ timeout: 3_000 })
        assert.deepEqual(reste(), [])
        // Rückgängig nimmt das Geschriebene zurück
        await bericht().getByRole('button', { name: 'Rückgängig' }).click()
        await bericht()
          .getByText(/^Rückgängig gemacht/)
          .waitFor({ timeout: 20_000 })
        for (const n of namen) assert.equal(alleTags(pfadVon(n))['XMP:Rating'], undefined, n)
        await ansichtZu()
      }
    ],
    [
      'Mehrfach: „nur lesen“ und „privat“ in der Auswahl',
      async () => {
        // ein zweiter Bibliotheksordner mit Kopien
        const zweit = mkdtempSync(join(tmpdir(), 'galeria-zweit-'))
        const za = join(zweit, 'zweit-a.jpg')
        const zb = join(zweit, 'zweit-b.jpg')
        copyFileSync(pfadVon(M3), za)
        copyFileSync(pfadVon('Übersicht äöü ß.jpg'), zb)
        await stubOrdnerDialog(app, zweit)
        await page.evaluate(() => window.api.library.addFolder())
        const z = await waitFor(async () => {
          const s = await zustand()
          const o = s.folders.find((f) => f.name === basename(zweit))
          return o?.status === 'bereit' && o.count === 2 && s.metaPending === 0 ? o : null
        }, 30_000)
        assert.ok(z, 'zweiter Ordner nicht eingelesen')
        try {
          await page.evaluate((id) => window.api.library.setFolderMode(id, 'nur-lesen'), z.id)
          const vorher = [inhalt(za), inhalt(zb)]
          await ansichtOeffnen(['zweit-a.jpg', 'zweit-b.jpg', M1])
          await ansicht().getByText('2 lassen sich nicht beschreiben').waitFor({ timeout: 3_000 })
          assert.equal(await statusVon('zweit-a.jpg'), 'Der Ordner steht auf „nur lesen“.')
          await ansicht().getByRole('button', { name: 'Alle auf 2 Sterne' }).click()
          assert.equal(await mehrfachSchreiben().innerText(), 'In 1 Datei schreiben')
          await mehrfachSchreiben().click()
          await bericht().getByText('1 Datei geschrieben und geprüft').waitFor({ timeout: 20_000 })
          assert.deepEqual([inhalt(za), inhalt(zb)], vorher, '„nur lesen“ geschrieben')
          assert.equal(alleTags(pfadVon(M1))['XMP:Rating'], 2)
          await bericht().getByRole('button', { name: 'Rückgängig' }).click()
          await bericht().getByText('Rückgängig gemacht: 1 Datei').waitFor({ timeout: 20_000 })
          assert.equal(alleTags(pfadVon(M1))['XMP:Rating'], 4)
          await ansichtZu()

          // „privat“: geschrieben, aber ohne Sicherung
          await page.evaluate((id) => window.api.library.setFolderMode(id, 'privat'), z.id)
          await ansichtOeffnen(['zweit-a.jpg', 'zweit-b.jpg', M1])
          // 5 Sterne hat noch keine (M1 hat 4 – sie bliebe sonst als „hatte die Werte schon“ stehen)
          await ansicht().getByRole('button', { name: 'Alle auf 5 Sterne' }).click()
          await mehrfachSchreiben().click()
          await bericht()
            .getByText('3 Dateien geschrieben und geprüft')
            .waitFor({ timeout: 20_000 })
          assert.equal(
            await statusVon('zweit-a.jpg'),
            'Geschrieben · ohne Sicherung (privat) · geprüft'
          )
          assert.equal(await statusVon(M1), 'Geschrieben · Sicherung vorhanden · geprüft')
          assert.equal(alleTags(za)['XMP:Rating'], 5)
          assert.equal(alleTags(zb)['XMP:Rating'], 5)
          assert.equal(
            sicherungen().filter((n) => n.includes('zweit-')).length,
            0,
            '„privat“ legte eine Sicherung an'
          )
          assert.deepEqual(
            readdirSync(zweit).filter((n) => n.includes('galerie-tmp')),
            [],
            'Nachbardatei im zweiten Ordner'
          )
          await bericht().getByRole('button', { name: 'Rückgängig' }).click()
          await bericht().getByText('Rückgängig gemacht: 3 Dateien').waitFor({ timeout: 20_000 })
          await ansichtZu()
        } finally {
          await stubConfirm(app, true)
          await page.evaluate((id) => window.api.library.removeFolder(id), z.id)
          rmSync(zweit, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
        }
      }
    ],
    [
      'Schnellbewertung im Raster: ein Bild sofort, ab zwei nach Rückfrage, Rückgängig für alle',
      async () => {
        // ein Bild: sofort, wie im Betrachter
        await waehlen([M3])
        await page.keyboard.press('4')
        await rasterHinweis().getByText('4 Sterne gespeichert').waitFor({ timeout: 10_000 })
        assert.equal(tags(pfadVon(M3))['XMP:Rating'], 4)
        await page.keyboard.press('Control+z')
        assert.ok(
          await waitFor(async () => tags(pfadVon(M3))['XMP:Rating'] === undefined, 5_000),
          'Strg+Z wirkt nicht'
        )
        // drei Bilder: Rückfrage mit der Zahl; „Abbrechen“ schreibt nichts
        const pfade = [M1, M2, M3].map(pfadVon)
        const vorher = pfade.map(inhalt)
        await fragen([1, 0, 0])
        await waehlen([M1, M2, M3])
        await page.keyboard.press('5')
        await waitFor(async () => (await gestellt()).length === 1, 5_000)
        assert.deepEqual(await gestellt(), ['5 Sterne für 3 Bilder schreiben?'])
        assert.deepEqual(pfade.map(inhalt), vorher, 'nach „Abbrechen“ geschrieben')
        // zugesagt: Fortschritt, dann das Ergebnis mit „Rückgängig“ für alle
        await page.keyboard.press('5')
        await rasterHinweis()
          .getByText('5 Sterne: 3 Dateien geschrieben')
          .waitFor({ timeout: 20_000 })
        for (const p of pfade) assert.equal(tags(p)['XMP:Rating'], 5, p)
        await rasterHinweis().getByRole('button', { name: 'Rückgängig' }).click()
        await rasterHinweis()
          .getByText('Rückgängig gemacht: 3 Dateien')
          .waitFor({ timeout: 20_000 })
        assert.deepEqual(
          pfade.map((p) => tags(p)['XMP:Rating']),
          [4, 2, undefined],
          'nicht alle zurück'
        )
        // Farblabel für alle
        await waehlen([M1, M2, M3])
        await page.keyboard.press('7')
        await rasterHinweis()
          .getByText('Farblabel Gelb: 3 Dateien geschrieben')
          .waitFor({ timeout: 20_000 })
        assert.deepEqual(await gestellt(), [
          '5 Sterne für 3 Bilder schreiben?',
          '5 Sterne für 3 Bilder schreiben?',
          'Farblabel Gelb für 3 Bilder schreiben?'
        ])
        for (const p of pfade) assert.equal(tags(p)['XMP:Label'], 'Yellow', p)
        await rasterHinweis().getByRole('button', { name: 'Rückgängig' }).click()
        await rasterHinweis()
          .getByText('Rückgängig gemacht: 3 Dateien')
          .waitFor({ timeout: 20_000 })
        for (const p of pfade) assert.equal(tags(p)['XMP:Label'], undefined, p)
      }
    ],
    [
      'Mehrfach im main abgelehnt: ganze Listen, Widerspruch, Tag-Namen, Optionen, Kennungen, zweiter Auftrag',
      async () => {
        const b = await kennung(M1)
        const roh = (ids, a, o) =>
          page.evaluate(
            ([i, x, y]) =>
              window.api.meta.writeMany(i, x, y).then(
                (r) => r,
                (e) => ({ abgelehnt: String(e.message) })
              ),
            [ids, a, o]
          )
        for (const a of [
          {},
          { stichwoerter: ['a'] },
          { stichwoerterDazu: ['Meer'], stichwoerterWeg: ['meer'] },
          { stichwoerterDazu: ['a;b'] },
          { 'XMP-dc:Subject': 'x' },
          { aufnahme: { lokal: '2020-01-02T03:04:05', offset: '+01:00' } }
        ]) {
          assert.match(
            (await roh([b.id], a)).abgelehnt ?? '',
            /Ungültige Änderung/,
            JSON.stringify(a)
          )
        }
        assert.match(
          (await roh([b.id], { bewertung: 1 }, { rueckfrage: 'ja' })).abgelehnt ?? '',
          /Ungültige Optionen/
        )
        const viele = Array.from({ length: 10_001 }, (_, i) => i + 1)
        assert.match((await roh(viele, { bewertung: 1 })).abgelehnt ?? '', /Ungültige Kennungen/)
        // einer zur Zeit: der zweite Start bekommt einen Grund, der erste läuft zu Ende
        const [erster, zweiter] = await page.evaluate(
          (id) => Promise.all([window.api.meta.readMany([id]), window.api.meta.readMany([id])]),
          b.id
        )
        assert.ok('auftrag' in erster, JSON.stringify(erster))
        assert.match(zweiter.grund ?? '', /läuft schon/)
      }
    ],
    [
      'Log ohne Werte; keine Nachbardatei; keine Konsolenfehler',
      async () => {
        const log = readFileSync(join(userData, 'galeria-debug.log'), 'utf8')
        assert.ok(log.includes('[metadaten]'), 'Log enthält den Lauf nicht')
        assert.ok(log.includes('(schreiben)'), 'Log enthält keinen Mehrfach-Auftrag')
        for (const w of ['eingeschleust', 'delete_original', 'Yellow', 'Kroatien', 'Größe']) {
          assert.ok(!log.includes(w), `im Log: ${w}`)
        }
        assert.deepEqual(reste(), [])
        if (await betrachter().count()) await page.keyboard.press('Escape')
        // der Test ändert Dateien von außen: Ein Abruf in der Lücke bis zum Abgleich antwortet 409
        assert.deepEqual(
          ctx.errors.filter((e) => !e.includes('409')),
          []
        )
      }
    ]
  ])
} finally {
  await ctx.close()
  bib.aufraeumen()
  rmSync(userData, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
}
