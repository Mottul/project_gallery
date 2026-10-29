// Abnahme Phase 1 mit vielen Bildern (docs/PLAN.md, Phase 1, „Abnahme“) – läuft nur auf Wunsch:
// `npm run e2e -- abnahme50k` (ABNAHME_ANZAHL=… für eine andere Zahl, Vorgabe 50.000).
// Erzeugt synthetische kleine JPEGs (nie echte Fotos) in Jahr/Monat-Ordnern mit gestreuten
// Dateizeiten, liest sie ein und misst gegen die Zielwerte:
// - Erstindex im Hintergrund ohne hängende Oberfläche (IPC-Antwortzeit, lange Aufgaben im Renderer)
// - Neustart mit vorhandenem Index bis zur sichtbaren Galerie < 2 s
// - Sortierwechsel < 200 ms (Abfrage über die Brücke und bis das Raster die neue Reihenfolge zeigt)
// - Scrollen ohne Ruckeln (Abstände der Animationsbilder beim schnellen Scrollen)
// Kleine Bilder messen Index, Warteschlangen und Oberfläche – das Dekodieren großer Fotos maß das
// Labor in Phase 0 (sharp-durchsatz.mjs). Danach wird die Bibliothek gelöscht.

import assert from 'node:assert/strict'
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { launchApp, runSteps, Skip, sleep, stubOrdnerDialog, waitFor } from './harness.mjs'

sharp.cache({ files: 0 })
const ANZAHL = Number(process.env.ABNAHME_ANZAHL ?? 50_000)
// ABNAHME_DATEN=<Ordner eines behaltenen Laufs>: Bibliothek und Index wiederverwenden, nur
// Neustart, Sortieren und Scrollen messen (ABNAHME_BEHALTEN=1 behält einen Lauf)
const vorhanden = process.env.ABNAHME_DATEN
const basis = vorhanden ?? mkdtempSync(join(tmpdir(), 'galeria-50k-'))
const bibDir = join(basis, 'bib')
const userData = join(basis, 'benutzer')
if (!vorhanden) mkdirSync(userData)
const ergebnis = {}
const ms = (t) => `${Math.round(t)} ms`
const p = (liste, q) => {
  const s = [...liste].sort((a, b) => a - b)
  return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : 0
}

const ordnerDa = new Set()

/** 100 verschiedene Vorlagen (Verlauf je Farbe), daraus Kopien mit gestreuten Zeiten */
async function erzeugen() {
  const t0 = Date.now()
  const vorlagen = []
  for (let k = 0; k < 100; k++) {
    const w = 160
    const h = 120
    const px = Buffer.alloc(w * h * 3)
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++)
        px.set(
          [(k * 37 + x) % 256, (k * 91 + y * 2) % 256, (k * 13 + x + y) % 256],
          (y * w + x) * 3
        )
    const datei = join(basis, `vorlage-${k}.jpg`)
    await sharp(px, { raw: { width: w, height: h, channels: 3 } })
      .jpeg({ quality: 80 })
      .toFile(datei)
    vorlagen.push(datei)
  }
  const anfang = Date.UTC(2005, 0, 1)
  const spanne = Date.UTC(2025, 0, 1) - anfang
  for (let i = 0; i < ANZAHL; i++) {
    // gleichmäßig über 20 Jahre gestreut, deterministisch
    const zeit = anfang + ((i * 7_919_993) % 1000) * (spanne / 1000) + i * 1000
    const d = new Date(zeit)
    const ordner = join(
      bibDir,
      String(d.getUTCFullYear()),
      String(d.getUTCMonth() + 1).padStart(2, '0')
    )
    if (!ordnerDa.has(ordner)) {
      mkdirSync(ordner, { recursive: true })
      ordnerDa.add(ordner)
    }
    const ziel = join(ordner, `IMG_${String(i).padStart(6, '0')}.jpg`)
    copyFileSync(vorlagen[i % vorlagen.length], ziel)
    utimesSync(ziel, zeit / 1000, zeit / 1000)
  }
  for (const v of vorlagen) rmSync(v)
  return Date.now() - t0
}

/** Größe eines Ordners in MB */
const mb = (dir) =>
  Math.round(
    readdirSync(dir, { recursive: true })
      .map((f) => {
        try {
          return statSync(join(dir, String(f))).size
        } catch {
          return 0
        }
      })
      .reduce((a, b) => a + b, 0) / 1e5
  ) / 10

let ctx = null
const zustand = () => ctx.page.evaluate(() => window.api.library.state())

/** Fenster nach vorn und obenauf (verdeckte Fenster bekommen keine Animationsbilder) */
const obenauf = (an) =>
  ctx.app.evaluate(({ BrowserWindow }, an) => {
    const w = BrowserWindow.getAllWindows()[0]
    w.setAlwaysOnTop(an)
    if (an) {
      w.show()
      w.focus()
    }
  }, an)

/** Lange Aufgaben (> 50 ms) im Renderer mitzählen */
const langeAufgabenStarten = () =>
  ctx.page.evaluate(() => {
    const w = /** @type {any} */ (window)
    w.__lang = []
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) w.__lang.push(e.duration)
    }).observe({ type: 'longtask', buffered: false })
  })
const langeAufgaben = () => ctx.page.evaluate(() => /** @type {any} */ (window).__lang ?? [])

/** Spitzen-Arbeitsspeicher je Prozessart (MB) */
const speicher = () =>
  ctx.app.evaluate(({ app }) => {
    const je = {}
    for (const m of app.getAppMetrics()) {
      const k = m.type === 'Utility' ? (m.serviceName ?? m.name ?? 'Utility') : m.type
      je[k] = Math.max(je[k] ?? 0, Math.round((m.memory.peakWorkingSetSize ?? 0) / 1024))
    }
    return je
  })

/** 4 s lang je Animationsbild 150 px weiterscrollen; Abstände der Bilder (ms) */
const scrollMessen = () =>
  ctx.page.evaluate(async () => {
    const liste = document.querySelector('[role="listbox"][aria-label="Bilder"]')
    let el = liste
    while (el && el.scrollHeight <= el.clientHeight + 1) el = el.parentElement
    if (!el) return null
    const abstaende = []
    await new Promise((fertig) => {
      let start = 0
      let letzte = 0
      const schritt = (t) => {
        if (!start) start = letzte = t
        else abstaende.push(t - letzte)
        letzte = t
        el.scrollTop += 150
        if (t - start < 4000) requestAnimationFrame(schritt)
        else fertig()
      }
      requestAnimationFrame(schritt)
    })
    return { abstaende, hoehe: el.scrollHeight }
  })

try {
  await runSteps(`Abnahme mit ${ANZAHL.toLocaleString('de-DE')} Bildern`, [
    [
      'Testbibliothek erzeugen',
      async () => {
        if (vorhanden) throw new Skip(`vorhanden: ${basis}`)
        const t = await erzeugen()
        ergebnis.erzeugen = `${Math.round(t / 1000)} s, ${mb(bibDir)} MB`
      },
      20 * 60_000
    ],
    [
      'Erstindex im Hintergrund: Oberfläche antwortet (IPC < 250 ms im 99. Perzentil)',
      async () => {
        if (vorhanden) throw new Skip('Index vorhanden')
        ctx = await launchApp({ userData })
        await ctx.page
          .getByRole('heading', { name: 'Noch keine Ordner' })
          .waitFor({ timeout: 15_000 })
        await langeAufgabenStarten()
        await stubOrdnerDialog(ctx.app, bibDir)
        const t0 = Date.now()
        await ctx.page.getByRole('main').getByRole('button', { name: 'Ordner hinzufügen' }).click()
        const zeiten = { eingelesen: 0, metadaten: 0, vorschau: 0 }
        const ping = []
        for (;;) {
          const a = Date.now()
          const z = await zustand()
          ping.push(Date.now() - a)
          const o = z.folders[0]
          const jetzt = Date.now() - t0
          if (o?.status === 'bereit' && o.lastScan && o.count === ANZAHL && !zeiten.eingelesen)
            zeiten.eingelesen = jetzt
          if (zeiten.eingelesen && z.metaPending === 0 && !zeiten.metadaten)
            zeiten.metadaten = jetzt
          if (zeiten.eingelesen && z.thumbPending === 0 && !zeiten.vorschau) zeiten.vorschau = jetzt
          if (zeiten.eingelesen && zeiten.metadaten && zeiten.vorschau) break
          if (jetzt > 40 * 60_000) throw new Error(`nach 40 min nicht fertig: ${JSON.stringify(z)}`)
          await sleep(250)
        }
        const lang = await langeAufgaben()
        ergebnis.erstindex = {
          eingelesen: `${Math.round(zeiten.eingelesen / 1000)} s`,
          metadaten: `${Math.round(zeiten.metadaten / 1000)} s`,
          vorschaubilder: `${Math.round(zeiten.vorschau / 1000)} s`,
          ipcMedian: ms(p(ping, 0.5)),
          ipc99: ms(p(ping, 0.99)),
          ipcMax: ms(Math.max(...ping)),
          langeAufgabenRenderer: `${lang.length}, längste ${ms(Math.max(0, ...lang))}`
        }
        ergebnis.speicherErstindex = await speicher()
        assert.ok(p(ping, 0.99) < 250, JSON.stringify(ergebnis.erstindex))
      },
      45 * 60_000
    ],
    [
      'Neustart mit vorhandenem Index: Galerie mit Vorschaubildern sichtbar < 2 s (Median aus 3)',
      async () => {
        const laeufe = []
        for (let i = 0; i < 3; i++) {
          await ctx?.close()
          const t0 = Date.now()
          ctx = await launchApp({ userData })
          const fenster = Date.now() - t0
          const n = await waitFor(
            () =>
              ctx.page
                .$$eval(
                  '[role="listbox"][aria-label="Bilder"] img',
                  (imgs) => imgs.filter((i) => i.complete && i.naturalWidth > 0).length
                )
                .catch(() => 0),
            30_000,
            20
          )
          assert.ok(n, 'keine Vorschaubilder sichtbar')
          laeufe.push({ fenster, sichtbar: Date.now() - t0 })
        }
        ergebnis.neustart = {
          fensterDa: laeufe.map((l) => ms(l.fenster)).join(' / '),
          galerieSichtbar: laeufe.map((l) => ms(l.sichtbar)).join(' / '),
          median: ms(
            p(
              laeufe.map((l) => l.sichtbar),
              0.5
            )
          )
        }
        // Electron selbst braucht den Großteil bis zum Fenster; gezählt wird bis zu den Bildern
        assert.ok(
          p(
            laeufe.map((l) => l.sichtbar),
            0.5
          ) < 2000,
          JSON.stringify(ergebnis.neustart)
        )
      },
      3 * 60_000
    ],
    [
      'Sortierwechsel < 200 ms (Abfrage mit Gruppen und Raster, auch die Felder aus 2.3)',
      async () => {
        await waitFor(async () => (await zustand()).folders[0]?.status === 'bereit', 60_000)
        // ab 2.3 auch Felder ohne Index (im Speicher sortiert) und mit Gruppen wie die Oberfläche
        const felder = [
          'aufnahme',
          'name',
          'geaendert',
          'groesse',
          'typ',
          'ort',
          'kamera',
          'bewertung',
          'aufloesung',
          'ordner'
        ]
        const abfrage = []
        /** Abfragezeiten je Feld (ms) – welches Feld ohne Index wie lange braucht */
        const jeFeld = {}
        const raster = []
        for (const feld of [...felder, ...felder]) {
          const r = await ctx.page.evaluate(async (feld) => {
            // in der Richtung, die die Oberfläche gerade zeigt
            const ab =
              document
                .querySelector('button[aria-label="Absteigend"]')
                ?.getAttribute('aria-pressed') === 'true'
            const t0 = performance.now()
            const { ids } = await window.api.library.queryGroups(
              { feld, richtung: ab ? 'ab' : 'auf' },
              undefined,
              'monat'
            )
            const t1 = performance.now()
            const [erstes] = await window.api.library.details(ids.slice(0, 1))
            return { abfrage: t1 - t0, erstes: erstes.name, anzahl: ids.length }
          }, feld)
          abfrage.push(r.abfrage)
          jeFeld[feld] = [...(jeFeld[feld] ?? []), Math.round(r.abfrage)]
          // in der Oberfläche wählen und warten, bis das Raster vorn das erste Bild zeigt
          const dauer = await ctx.page.evaluate(
            async ({ feld, erstes }) => {
              const sel = /** @type {HTMLSelectElement} */ (
                document.querySelector('select#sortierung')
              )
              const t0 = performance.now()
              sel.value = feld
              sel.dispatchEvent(new Event('change', { bubbles: true }))
              const vorn = () =>
                document
                  .querySelector('[role="listbox"][aria-label="Bilder"] [role="option"]')
                  ?.getAttribute('aria-label')
              for (;;) {
                if (vorn() === erstes) return performance.now() - t0
                if (performance.now() - t0 > 5000) {
                  // zur Fehlersuche: was die Oberfläche stattdessen zeigt
                  const liste = document.querySelector('[role="listbox"][aria-label="Bilder"]')
                  return {
                    erwartet: erstes,
                    auswahl: sel.value,
                    ab: document
                      .querySelector('button[aria-label="Absteigend"]')
                      ?.getAttribute('aria-pressed'),
                    vorn: [...(liste?.querySelectorAll('[role="option"]') ?? [])]
                      .slice(0, 3)
                      .map((o) => o.getAttribute('aria-label')),
                    scrollTop: liste?.scrollTop ?? liste?.parentElement?.scrollTop,
                    titel: document.querySelector('h1')?.textContent
                  }
                }
                await new Promise((r) => setTimeout(r, 2))
              }
            },
            { feld, erstes: r.erstes }
          )
          if (typeof dauer !== 'number') {
            ergebnis.sortierFehler ??= []
            ergebnis.sortierFehler.push({ feld, ...dauer })
          }
          raster.push(typeof dauer === 'number' ? dauer : -1)
        }
        ergebnis.sortieren = {
          abfrageMax: ms(Math.max(...abfrage)),
          abfrageJeFeld: jeFeld,
          rasterMedian: ms(p(raster, 0.5)),
          rasterMax: ms(Math.max(...raster))
        }
        assert.ok(!raster.includes(-1), `Raster zeigte die Sortierung nicht: ${raster}`)
        assert.ok(Math.max(...raster) < 200, JSON.stringify(ergebnis.sortieren))
      },
      5 * 60_000
    ],
    [
      'Scrollen ohne Ruckeln (95 % der Bilder < 25 ms)',
      async () => {
        await obenauf(true)
        try {
          await sleep(500)
          const r = await scrollMessen()
          assert.ok(r, 'kein Scrollbereich gefunden')
          const a = r.abstaende
          ergebnis.scrollen = {
            bilder: a.length,
            median: ms(p(a, 0.5)),
            p95: ms(p(a, 0.95)),
            max: ms(Math.max(...a)),
            ueber50ms: a.filter((x) => x > 50).length
          }
          assert.ok(a.length > 60, `zu wenige Bilder (verdeckt?): ${a.length}`)
          assert.ok(p(a, 0.95) < 25, JSON.stringify(ergebnis.scrollen))
        } finally {
          await obenauf(false)
        }
      }
    ],
    [
      'Blocksatz (2.3b): Umschalten < 200 ms, Scrollen ohne Ruckeln',
      async () => {
        // Seitenverhältnisse aller 50.000 Bilder mit der Abfrage
        const abfrage = await ctx.page.evaluate(async () => {
          const t0 = performance.now()
          const r = await window.api.library.queryGroups(
            { feld: 'aufnahme', richtung: 'auf' },
            undefined,
            'monat',
            true
          )
          return { ms: performance.now() - t0, anzahl: r.seiten?.length ?? 0 }
        })
        assert.equal(abfrage.anzahl, ANZAHL)
        await obenauf(true)
        try {
          const umschalten = await ctx.page.evaluate(async () => {
            const knopf = [...document.querySelectorAll('button')].find(
              (b) => b.textContent?.trim() === 'Blocksatz'
            )
            const t0 = performance.now()
            knopf.click()
            for (;;) {
              const k = document.querySelector(
                '[role="listbox"][aria-label="Bilder"] [role="option"]'
              )
              if (k && !k.querySelector('p')) return performance.now() - t0
              if (performance.now() - t0 > 5000) return -1
              await new Promise((r) => setTimeout(r, 2))
            }
          })
          await sleep(500)
          const r = await scrollMessen()
          assert.ok(r, 'kein Scrollbereich gefunden')
          const a = r.abstaende
          ergebnis.blocksatz = {
            abfrageMitSeiten: ms(abfrage.ms),
            umschalten: ms(umschalten),
            scrollen: { bilder: a.length, p95: ms(p(a, 0.95)), max: ms(Math.max(...a)) }
          }
          assert.ok(umschalten >= 0 && umschalten < 200, JSON.stringify(ergebnis.blocksatz))
          assert.ok(a.length > 60, `zu wenige Bilder (verdeckt?): ${a.length}`)
          assert.ok(p(a, 0.95) < 25, JSON.stringify(ergebnis.blocksatz))
        } finally {
          await ctx.page.getByRole('button', { name: 'Kacheln', exact: true }).click()
          await obenauf(false)
        }
      }
    ],
    [
      'Index und Cache auf der Platte, Speicher',
      async () => {
        ergebnis.speicherNeustart = await speicher()
        ergebnis.platte = { lokalerDatenordner: `${mb(join(userData, 'lokal'))} MB` }
      }
    ]
  ])
} finally {
  await ctx?.close()
  // Stand der main? Die App schreibt blockierte Ereignisschleifen ins Log (nur die Dauer) – hier
  // die längsten, mit der Log-Zeile davor als Zusammenhang
  try {
    const zeilen = readFileSync(join(userData, 'galeria-debug.log'), 'utf8').split(/\r?\n/)
    const lags = zeilen
      .map((z, i) => ({ ms: Number(/Ereignisschleife (\d+) ms/.exec(z)?.[1] ?? 0), i }))
      .filter((x) => x.ms)
    ergebnis.mainBlockiert = {
      anzahl: lags.length,
      summe: ms(lags.reduce((s, x) => s + x.ms, 0)),
      laengste: lags
        .sort((a, b) => b.ms - a.ms)
        .slice(0, 5)
        .map((x) => `${x.ms} ms nach: ${(zeilen[x.i - 1] ?? '').slice(0, 140)}`)
    }
  } catch {
    // kein Log
  }
  console.log('\nErgebnis:\n' + JSON.stringify(ergebnis, null, 2))
  if (process.env.ABNAHME_BEHALTEN || vorhanden) console.log(`Daten behalten: ${basis}`)
  else rmSync(basis, { recursive: true, force: true, maxRetries: 5 })
}
