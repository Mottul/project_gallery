// Betrachter im Detail (Rückmeldung zu 1.5): Blättern und Diashow ohne leeren Moment (kein Bild ohne
// Bild – auch bei großen Originalen, die erst dekodiert werden müssen), vorgeladene Nachbarn werden
// nicht ein zweites Mal geholt (bild:// antwortet mit no-store), Filmstreifen ganz sichtbar, Zoom
// mit Schieberegler, Stufen-Menü und sanftem Übergang. Testbibliothek aus scripts/testbilder.mjs,
// dazu drei große synthetische Bilder (Rauschen, 4000 × 3000).

import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'
import {
  erwarteteBilder,
  launchApp,
  runSteps,
  stubOrdnerDialog,
  testbibliothek,
  waitFor
} from './harness.mjs'

sharp.cache({ files: 0 })
const bib = await testbibliothek()
const GROSS = ['00-gross-1.jpg', '00-gross-2.jpg', '00-gross-3.jpg']
mkdirSync(join(bib.dir, 'gross'))
for (const [k, n] of GROSS.entries()) {
  await sharp({
    create: {
      width: 4000,
      height: 3000,
      channels: 3,
      noise: { type: 'gaussian', mean: 60 + k * 50, sigma: 40 }
    }
  })
    .jpeg({ quality: 92 })
    .toFile(join(bib.dir, 'gross', n))
}
const erwartet = erwarteteBilder(bib.manifest) + GROSS.length
const ctx = await launchApp()
const { app, page } = ctx

const betrachter = () => page.getByRole('dialog', { name: 'Betrachter' })
const angezeigt = () => betrachter().getByRole('heading', { level: 2 }).innerText()
const raster = () => page.getByRole('listbox', { name: 'Bilder' })
const film = () => betrachter().getByRole('listbox', { name: 'Filmstreifen' })
const stufe = () => betrachter().getByLabel('Zoomstufe').innerText()
/** Das Original des Bildes `name` ist auf der Bühne zu sehen (geladen, sichtbar) */
const zeigt = (name) =>
  betrachter()
    .locator(`img[alt="${name}"]`)
    .evaluate(
      (i) => i.complete && i.naturalWidth > 0 && getComputedStyle(i).visibility !== 'hidden'
    )
    .catch(() => false)
async function betrachterZu() {
  if (await betrachter().count()) await page.keyboard.press('Escape')
  await waitFor(async () => (await betrachter().count()) === 0, 3_000)
}
async function oeffnen(name) {
  await betrachterZu()
  await raster().getByRole('option', { name, exact: true }).dblclick()
  await betrachter().waitFor({ timeout: 5_000 })
  assert.ok(await waitFor(() => zeigt(name), 10_000), `${name} nicht angezeigt`)
}

/**
 * Wächter in der Seite: prüft nach jeder Änderung im Betrachter (MutationObserver – läuft nach
 * jedem Commit von React, vor dem Zeichnen) und in jedem Bild (requestAnimationFrame – kommt in
 * einem verdeckten Fenster kaum), ob auf der Bühne ein geladenes, sichtbares Bild liegt –
 * Vorschaubild oder Original, alles außer dem Filmstreifen. Zählt Prüfungen und Lücken.
 */
const waechterStarten = () =>
  page.evaluate(() => {
    const w = /** @type {any} */ (window)
    const d = document.querySelector('[role="dialog"][aria-label="Betrachter"]')
    w.__luecken = 0
    w.__pruefungen = 0
    w.__waechter = true
    const pruefen = () => {
      if (!w.__waechter || !d?.isConnected) return
      w.__pruefungen++
      const streifen = d.querySelector('[role="listbox"]')
      const sichtbar = [...d.querySelectorAll('img')].some((i) => {
        if (streifen?.contains(i) || !i.complete || i.naturalWidth === 0) return false
        const r = i.getBoundingClientRect()
        if (r.width < 2 || r.height < 2) return false
        for (let e = i; e && e !== d; e = e.parentElement) {
          const s = getComputedStyle(e)
          if (s.visibility === 'hidden' || s.display === 'none' || Number(s.opacity) < 0.05)
            return false
        }
        return true
      })
      if (!sichtbar) w.__luecken++
    }
    w.__beobachter?.disconnect()
    w.__beobachter = new MutationObserver(pruefen)
    w.__beobachter.observe(d, { subtree: true, childList: true, attributes: true })
    const jedesBild = () => {
      if (!w.__waechter) return
      pruefen()
      requestAnimationFrame(jedesBild)
    }
    requestAnimationFrame(jedesBild)
  })
const waechterStopp = () =>
  page.evaluate(() => {
    const w = /** @type {any} */ (window)
    w.__waechter = false
    w.__beobachter?.disconnect()
    return { luecken: w.__luecken, pruefungen: w.__pruefungen }
  })

/** Abrufe über bild:// (DevTools-Protokoll, Network) – je Kennung gezählt */
const abrufe = new Map()
const cdp = await page.context().newCDPSession(page)
cdp.on('Network.requestWillBeSent', ({ request }) => {
  const m = /^bild:\/\/id\/(\d+)/.exec(request.url)
  if (m) abrufe.set(Number(m[1]), (abrufe.get(Number(m[1])) ?? 0) + 1)
})
await cdp.send('Network.enable')

try {
  await runSteps('Betrachter', [
    [
      `Bibliothek mit ${erwartet} Bildern, sortiert nach Name`,
      async () => {
        await page.getByRole('heading', { name: 'Noch keine Ordner' }).waitFor({ timeout: 15_000 })
        await stubOrdnerDialog(app, bib.dir)
        await page.getByRole('main').getByRole('button', { name: 'Ordner hinzufügen' }).click()
        const fertig = await waitFor(async () => {
          const s = await page.evaluate(() => window.api.library.state())
          const [o] = s.folders
          return (
            o?.status === 'bereit' && o.lastScan && o.count === erwartet && s.thumbPending === 0
          )
        }, 90_000)
        assert.ok(fertig, 'nicht fertig eingelesen')
        await page.getByRole('combobox', { name: 'Sortieren nach' }).selectOption('name')
        await raster()
          .getByRole('option', { name: GROSS[0], exact: true })
          .waitFor({ timeout: 5_000 })
      }
    ],
    [
      'Blättern mit Pfeiltasten: kein Moment ohne Bild, auch bei großen Originalen',
      async () => {
        await oeffnen(GROSS[0])
        await waechterStarten()
        for (const n of GROSS.slice(1)) {
          await page.keyboard.press('ArrowRight')
          assert.ok(await waitFor(() => zeigt(n), 10_000), `${n} nicht angezeigt`)
        }
        // und schnell hintereinander zurück
        await page.keyboard.press('ArrowLeft')
        await page.keyboard.press('ArrowLeft')
        assert.ok(await waitFor(() => zeigt(GROSS[0]), 10_000))
        const w = await waechterStopp()
        assert.ok(w.pruefungen > 10, `Wächter lief nicht (${w.pruefungen} Prüfungen)`)
        assert.equal(w.luecken, 0, `${w.luecken} von ${w.pruefungen} Prüfungen ohne Bild`)
      }
    ],
    [
      'Diashow: kein Moment ohne Bild, schaltet erst weiter, wenn das nächste bereit ist',
      async () => {
        await oeffnen(GROSS[0])
        await betrachter()
          .getByRole('combobox', { name: 'Intervall der Diashow' })
          .selectOption('2')
        await waechterStarten()
        await betrachter().getByRole('button', { name: 'Diashow' }).click()
        for (const n of GROSS.slice(1)) {
          assert.ok(await waitFor(() => zeigt(n), 10_000), `${n} nicht angezeigt`)
        }
        await betrachter().getByRole('button', { name: 'Diashow' }).click()
        const w = await waechterStopp()
        assert.ok(w.pruefungen > 10, `Wächter lief nicht (${w.pruefungen} Prüfungen)`)
        assert.equal(w.luecken, 0, `${w.luecken} von ${w.pruefungen} Prüfungen ohne Bild`)
      }
    ],
    [
      'Vorladen wirkt: das nächste Bild wird nicht ein zweites Mal über bild:// geholt',
      async () => {
        await betrachterZu()
        const ids = await page.evaluate(async () =>
          window.api.library.query({ feld: 'name', richtung: 'auf' })
        )
        const bilder = await page.evaluate((x) => window.api.library.details(x), ids)
        // drei lesbare Bilder hintereinander, ab „Bild 2.jpg“ (namen/ der Testbibliothek)
        const i = bilder.findIndex((x) => x.name === 'Bild 2.jpg')
        const [a, b, c] = bilder.slice(i, i + 3)
        assert.ok(
          i >= 0 && [a, b, c].every((x) => x?.status === 'ok'),
          JSON.stringify(bilder.slice(i, i + 3).map((x) => [x.name, x.status]))
        )
        abrufe.clear()
        await oeffnen(a.name)
        // der Nachbar wird vorgeladen …
        assert.ok(await waitFor(() => abrufe.get(b.id) === 1, 5_000), 'nicht vorgeladen')
        await page.keyboard.press('ArrowRight')
        assert.ok(await waitFor(() => zeigt(b.name), 5_000))
        // … und dann nicht noch einmal geholt (Chromium nimmt no-store-Antworten nicht wieder)
        assert.ok(await waitFor(() => abrufe.get(c.id) === 1, 5_000), 'übernächstes nicht geladen')
        assert.equal(abrufe.get(b.id), 1, `${b.name} ${abrufe.get(b.id)}-mal geholt`)
      }
    ],
    [
      'Filmstreifen: das gewählte Bild samt Rahmen ganz zu sehen (nicht vom Scrollbalken verdeckt)',
      async () => {
        const r = await film().evaluate((f) => {
          const b = /** @type {HTMLElement} */ (f.querySelector('[aria-selected="true"]'))
          const k = b.getBoundingClientRect()
          const c = f.getBoundingClientRect()
          return {
            oben: k.top - 3,
            unten: k.bottom + 3,
            sichtbarAb: c.top + f.clientTop,
            sichtbarBis: c.top + f.clientTop + f.clientHeight,
            streifenUnten: c.bottom,
            fenster: window.innerHeight
          }
        })
        assert.ok(r.oben >= r.sichtbarAb, JSON.stringify(r))
        assert.ok(r.unten <= r.sichtbarBis, JSON.stringify(r))
        assert.ok(r.streifenUnten <= r.fenster, JSON.stringify(r))
      }
    ],
    [
      'Zoom: Schieberegler, Stufen-Menü, sanfter Übergang, feine Schritte am Touchpad',
      async () => {
        await oeffnen(GROSS[1])
        const regler = betrachter().getByRole('slider', { name: 'Zoom' })
        await regler.waitFor({ timeout: 3_000 })
        const vorher = parseInt(await stufe(), 10)
        await regler.focus()
        for (let k = 0; k < 10; k++) await page.keyboard.press('ArrowRight')
        assert.ok(
          await waitFor(async () => parseInt(await stufe(), 10) > vorher, 3_000),
          `Regler zoomt nicht: ${await stufe()}`
        )
        // Stufen-Menü an der Prozentzahl
        await betrachter().getByLabel('Zoomstufe').click()
        await page.getByRole('menuitem', { name: '200 %' }).click()
        assert.equal(await stufe(), '200 %')
        assert.equal(Number(await regler.inputValue()) > 0, true)
        // sanft: das Bild gleitet in die neue Stufe (außer bei „Bewegung reduzieren“)
        const dauer = await betrachter()
          .locator(`img[alt="${GROSS[1]}"]`)
          .evaluate((i) => getComputedStyle(i).transitionDuration)
        assert.ok(parseFloat(dauer) > 0, `kein Übergang: ${dauer}`)
        // feine Schritte: ein kleiner Ausschlag (Touchpad) zoomt weniger als ein Mausrad-Raster
        await betrachter().getByRole('button', { name: '100 %', exact: true }).click()
        await betrachter().locator(`img[alt="${GROSS[1]}"]`).hover()
        await page.mouse.wheel(0, -10)
        assert.ok(await waitFor(async () => (await stufe()) !== '100 %', 3_000))
        const fein = parseInt(await stufe(), 10)
        assert.ok(fein > 100 && fein < 110, `Touchpad-Schritt zu grob: ${fein} %`)
        await page.mouse.wheel(0, -100)
        assert.ok(
          await waitFor(async () => parseInt(await stufe(), 10) >= fein * 1.2, 3_000),
          `Mausrad-Raster zu fein: ${await stufe()}`
        )
        await betrachter().getByRole('button', { name: 'Anpassen', exact: true }).click()
      }
    ],
    [
      'keine Konsolenfehler',
      async () => {
        await betrachterZu()
        assert.deepEqual(ctx.errors, [])
      }
    ]
  ])
} finally {
  await cdp.detach().catch(() => {})
  await ctx.close()
  bib.aufraeumen()
}
