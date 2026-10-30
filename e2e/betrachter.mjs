// Betrachter im Detail (Rückmeldung zu 1.5): Blättern und Diashow ohne leeren Moment (kein Bild ohne
// Bild – auch bei großen Originalen, die erst dekodiert werden müssen), vorgeladene Nachbarn werden
// nicht ein zweites Mal geholt (bild:// antwortet mit no-store), Filmstreifen ganz sichtbar, Zoom
// mit Schieberegler, Stufen-Menü und sanftem Übergang; Diashow-Effekte (2.5): Überblenden, Ken Burns,
// Anhalten, Menü. Testbibliothek aus scripts/testbilder.mjs, dazu drei große synthetische Bilder
// (Rauschen, 4000 × 3000) und ein Hochformat.

import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'
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
const HOCH = '00-hoch.jpg'
await sharp({
  create: {
    width: 1500,
    height: 3000,
    channels: 3,
    noise: { type: 'gaussian', mean: 120, sigma: 40 }
  }
})
  .jpeg({ quality: 80 })
  .toFile(join(bib.dir, 'gross', HOCH))
const erwartet = erwarteteBilder(bib.manifest) + GROSS.length + 1
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
const diashowKnopf = () => betrachter().getByRole('button', { name: 'Diashow', exact: true })
const intervall = () => betrachter().getByRole('combobox', { name: 'Intervall der Diashow' })
const menue = () => betrachter().getByRole('group', { name: 'Einstellungen der Diashow' })
/** Im Menü einstellen, z. B. { Übergang: 'schnitt' } – Esc schließt nur das Menü */
async function einstellen(werte) {
  await betrachter().getByRole('button', { name: 'Einstellungen der Diashow' }).click()
  for (const [n, v] of Object.entries(werte)) {
    await menue().getByRole('combobox', { name: n }).selectOption(v)
  }
  await page.keyboard.press('Escape')
  await menue().waitFor({ state: 'detached', timeout: 3_000 })
  assert.equal(await betrachter().count(), 1, 'Esc schloss den Betrachter')
}
/** Sichtbare Ebenen der Bühne über `ms`, alle 30 ms: je Probe [{ alt, deckkraft, m: Matrix }] */
const ebenenProben = (ms) =>
  page.evaluate(async (dauer) => {
    const d = document.querySelector('[role="dialog"][aria-label="Betrachter"]')
    const proben = []
    const ende = performance.now() + dauer
    while (performance.now() < ende) {
      const ebenen = [...d.querySelectorAll('img[data-ebene]')]
      proben.push(
        ebenen
          .filter((i) => getComputedStyle(i).visibility !== 'hidden')
          .map((i) => {
            const s = getComputedStyle(i)
            const m = s.transform.match(/-?[\d.e-]+/g)?.map(Number) ?? []
            return { alt: i.alt, deckkraft: Number(s.opacity), m }
          })
      )
      await new Promise((r) => setTimeout(r, 30))
    }
    return proben
  }, ms)
/** Läuft auf dem gezeigten Bild eine Bewegung (Ken Burns)? */
const bewegtSich = (name) =>
  betrachter()
    .locator(`img[alt="${name}"]`)
    .evaluate((i) =>
      i
        .getAnimations()
        .some(
          (a) => a.effect.getKeyframes().some((k) => 'transform' in k) && a.playState === 'running'
        )
    )
/** Maßstab, mit dem das Bild die Bühne füllt */
const fitVon = (name) =>
  betrachter()
    .locator(`img[alt="${name}"]`)
    .evaluate((i) => {
      const b = i.parentElement
      return Math.min(1, b.clientWidth / i.naturalWidth, b.clientHeight / i.naturalHeight)
    })
const istNormal = async (name) => {
  const fit = await fitVon(name)
  return waitFor(async () => {
    const [p] = await ebenenProben(1)
    return Math.abs(p[0]?.m[0] - fit) < 1e-3 && !(await bewegtSich(name))
  }, 3_000)
}

async function betrachterZu() {
  if (await betrachter().count()) await page.keyboard.press('Escape')
  await waitFor(async () => (await betrachter().count()) === 0, 3_000)
}
async function oeffnen(name) {
  await betrachterZu()
  await (await kachel(page, name)).dblclick()
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
        await betrachter().getByRole('button', { name: 'Diashow', exact: true }).click()
        for (const n of GROSS.slice(1)) {
          assert.ok(await waitFor(() => zeigt(n), 10_000), `${n} nicht angezeigt`)
        }
        await betrachter().getByRole('button', { name: 'Diashow', exact: true }).click()
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
      'Überblenden: beide Bilder liegen kurz übereinander, kein Moment ohne Bild; Blättern schneidet hart',
      async () => {
        await oeffnen(GROSS[0])
        await einstellen({ Übergang: 'ueberblenden', 'Ken Burns': 'aus' })
        await intervall().selectOption('2')
        await waechterStarten()
        await diashowKnopf().click()
        const proben = await ebenenProben(3_500)
        await diashowKnopf().click()
        const w = await waechterStopp()
        assert.equal(w.luecken, 0, `${w.luecken} von ${w.pruefungen} Prüfungen ohne Bild`)
        const zwei = proben.filter((p) => p.length === 2)
        assert.ok(zwei.length >= 5, `kaum Überblenden: ${zwei.length} von ${proben.length} Proben`)
        assert.ok(
          zwei.some((p) => p[1].deckkraft > 0.2 && p[1].deckkraft < 0.8),
          'das neue Bild kommt nicht allmählich'
        )
        assert.ok(
          zwei.every((p) => p[0].alt === '' && p[1].alt !== ''),
          'das alte Bild liegt nicht unter dem neuen'
        )
        assert.equal(proben.at(-1).length, 1, 'die alte Ebene bleibt liegen')
        assert.ok(
          proben.some((p) => p.length === 1 && p[0].deckkraft === 1),
          'nie allein und voll sichtbar'
        )
        await oeffnen(GROSS[0])
        const name = GROSS[1]
        await page.keyboard.press('ArrowRight')
        const blaettern = await ebenenProben(800)
        assert.ok(await waitFor(() => zeigt(name), 5_000))
        assert.ok(
          blaettern.every((p) => p.length <= 1),
          'Blättern ohne Diashow blendet über'
        )
      }
    ],
    [
      'Schnitt: nie zwei Bilder zugleich',
      async () => {
        await oeffnen(GROSS[0])
        await einstellen({ Übergang: 'schnitt' })
        await waechterStarten()
        await diashowKnopf().click()
        const proben = await ebenenProben(2_800)
        await diashowKnopf().click()
        const w = await waechterStopp()
        assert.equal(w.luecken, 0, `${w.luecken} von ${w.pruefungen} Prüfungen ohne Bild`)
        assert.ok(new Set(proben.flat().map((e) => e.alt)).size >= 2, 'nicht weitergeschaltet')
        assert.ok(
          proben.every((p) => p.length === 1),
          'Schnitt zeigt zwei Ebenen'
        )
      }
    ],
    [
      'Ken Burns: Querformat zoomt um die Mitte bis zur Stärke, Anhalten führt sanft zurück',
      async () => {
        await oeffnen(GROSS[0])
        await einstellen({ 'Ken Burns': 'auto', Stärke: 'stark' })
        await intervall().selectOption('5')
        const fit = await fitVon(GROSS[0])
        await diashowKnopf().click()
        const proben = (await ebenenProben(1_500)).map((p) => p[0].m)
        const s = proben.map((m) => m[0])
        assert.ok(new Set(s).size > 5, `keine Bewegung: ${[...new Set(s)].length} Stufen`)
        const steigt = s.at(-1) > s[0]
        for (let i = 1; i < s.length; i++) {
          assert.ok(
            steigt ? s[i] >= s[i - 1] - 1e-6 : s[i] <= s[i - 1] + 1e-6,
            'zoomt nicht stetig'
          )
        }
        assert.ok(Math.abs(s.at(-1) - s[0]) / fit > 0.03, `zu wenig: ${s[0]} → ${s.at(-1)}`)
        assert.ok(Math.min(...s) >= fit * 0.999, 'kleiner als die Bühne')
        assert.ok(Math.max(...s) <= fit * 1.351, 'stärker als eingestellt')
        // Zoom um die Mitte: keine Verschiebung
        assert.ok(new Set(proben.map((m) => Math.round(m[4]))).size <= 2, 'wandert seitlich')
        await page.keyboard.press(' ')
        assert.ok(await istNormal(GROSS[0]), 'nach dem Anhalten nicht zurück in der normalen Lage')
      }
    ],
    [
      'Ken Burns: Hochformat schwenkt senkrecht bei gleichem Maßstab',
      async () => {
        await oeffnen(HOCH)
        await diashowKnopf().click()
        const proben = (await ebenenProben(1_500)).map((p) => p[0].m)
        await diashowKnopf().click()
        const fit = await fitVon(HOCH)
        const s = proben.map((m) => m[0])
        assert.ok(Math.max(...s) - Math.min(...s) < 1e-3, 'Maßstab ändert sich beim Schwenk')
        assert.ok(Math.abs(s[0] / fit - 1.35) < 0.01, `Maßstab ${s[0]} statt Stärke × ${fit}`)
        const y = proben.map((m) => m[5])
        assert.ok(Math.abs(y.at(-1) - y[0]) > 5, `kein Schwenk: ${y[0]} → ${y.at(-1)}`)
        assert.ok(new Set(proben.map((m) => Math.round(m[4]))).size <= 2, 'wandert seitlich')
      }
    ],
    [
      'Überblenden mit Ken Burns: Das alte Bild fährt weiter, während es geht, das neue beginnt neu',
      async () => {
        await oeffnen(GROSS[0])
        await einstellen({ Übergang: 'ueberblenden' })
        await intervall().selectOption('2')
        const fit = await fitVon(GROSS[0])
        await diashowKnopf().click()
        const proben = await ebenenProben(3_500)
        await diashowKnopf().click()
        const zwei = proben.filter((p) => p.length === 2)
        assert.ok(zwei.length >= 5, `kaum Überblenden: ${zwei.length} Proben`)
        // auf fast dem ganzen Weg: die Bahn des alten Bildes steht nicht
        const alt = zwei.map((p) => p[0].m[0])
        assert.ok(new Set(alt).size >= 3, `altes Bild steht: ${[...new Set(alt)].join(', ')}`)
        // vom ersten zum zweiten Bild wechselt die Richtung: Das neue läuft andersherum
        const neu = zwei.map((p) => p[1].m[0])
        assert.ok(
          (alt.at(-1) - alt[0]) * (neu.at(-1) - neu[0]) < 0,
          `gleiche Richtung: ${alt[0]} → ${alt.at(-1)}, ${neu[0]} → ${neu.at(-1)}`
        )
        assert.ok(Math.max(...alt, ...neu) <= fit * 1.351, 'stärker als eingestellt')
      }
    ],
    [
      'Ken Burns weicht dem Nutzer: selbst zoomen hält ihn an, die Bühne ändern passt ihn an',
      async () => {
        await oeffnen(GROSS[1])
        await diashowKnopf().click()
        assert.ok(await waitFor(() => bewegtSich(GROSS[1]), 3_000), 'keine Bewegung')
        // Fenster niedriger (wie Vollbild oder Info: die Bühne ändert sich): das Bild muss mitgehen
        const hoch = await fitVon(GROSS[1])
        const groesseAendern = (d) =>
          app.evaluate(({ BrowserWindow }, delta) => {
            const w = BrowserWindow.getAllWindows()[0]
            const [b, h] = w.getSize()
            w.setSize(b, h + delta)
          }, d)
        await groesseAendern(-150)
        assert.ok(await waitFor(async () => (await fitVon(GROSS[1])) < hoch, 3_000))
        const schmal = await fitVon(GROSS[1])
        // Der kleinste Maßstab der Bahn ist genau „passt auf die Bühne“
        const kleinster = () =>
          betrachter()
            .locator(`img[alt="${GROSS[1]}"]`)
            .evaluate((i) => {
              const f = i.getAnimations().flatMap((a) => a.effect.getKeyframes())
              const s = f.flatMap((k) => /scale\(([\d.]+)\)/.exec(k.transform ?? '')?.[1] ?? [])
              return Math.min(...s.map(Number))
            })
        assert.ok(
          await waitFor(async () => Math.abs((await kleinster()) - schmal) < 1e-3, 2_000),
          `Bahn behält den Maßstab der alten Bühne: ${await kleinster()} statt ${schmal}`
        )
        assert.ok(await bewegtSich(GROSS[1]), 'Bewegung steht nach dem Ändern der Bühne')
        await groesseAendern(150)
        await page.keyboard.press('+')
        assert.ok(
          await waitFor(async () => !(await bewegtSich(GROSS[1])), 3_000),
          'läuft gegen den Zoom des Nutzers weiter'
        )
        await page.keyboard.press(' ')
        await betrachter().getByRole('button', { name: 'Anpassen', exact: true }).click()
      }
    ],
    [
      'Menü: ganz sichtbar, Stärke nur mit Ken Burns, gemerkt nach dem Neuladen',
      async () => {
        await oeffnen(GROSS[0])
        await betrachter().getByRole('button', { name: 'Einstellungen der Diashow' }).click()
        const ganz = await menue().evaluate((m) => {
          const r = m.getBoundingClientRect()
          return [
            [r.left + 8, r.top + 8],
            [r.right - 8, r.top + 8],
            [r.left + 8, r.bottom - 8],
            [r.right - 8, r.bottom - 8]
          ].every(([x, y]) => m.contains(document.elementFromPoint(x, y)))
        })
        assert.ok(ganz, 'Menü abgeschnitten oder verdeckt')
        if (process.env.E2E_BILD) await page.screenshot({ path: process.env.E2E_BILD })
        await menue().getByRole('combobox', { name: 'Ken Burns' }).selectOption('aus')
        assert.ok(await menue().getByRole('combobox', { name: 'Stärke' }).isDisabled())
        await menue().getByRole('combobox', { name: 'Übergang' }).selectOption('schnitt')
        await page.keyboard.press('Escape')
        await intervall().selectOption('10')
        await page.reload()
        await raster().waitFor({ timeout: 10_000 })
        await oeffnen(GROSS[0])
        assert.equal(await intervall().inputValue(), '10')
        await betrachter().getByRole('button', { name: 'Einstellungen der Diashow' }).click()
        assert.equal(
          await menue().getByRole('combobox', { name: 'Übergang' }).inputValue(),
          'schnitt'
        )
        assert.equal(await menue().getByRole('combobox', { name: 'Ken Burns' }).inputValue(), 'aus')
        await page.keyboard.press('Escape')
      }
    ],
    [
      'Windows ohne Animationen: Menü sagt es, die Diashow wechselt ohne Effekte',
      async () => {
        await einstellen({ Übergang: 'ueberblenden', 'Ken Burns': 'auto' })
        await intervall().selectOption('2')
        await page.emulateMedia({ reducedMotion: 'reduce' })
        await betrachter().getByRole('button', { name: 'Einstellungen der Diashow' }).click()
        await menue().getByText('Animationen abgeschaltet').waitFor({ timeout: 3_000 })
        await page.keyboard.press('Escape')
        await diashowKnopf().click()
        const proben = await ebenenProben(2_800)
        await diashowKnopf().click()
        await page.emulateMedia({ reducedMotion: null })
        assert.ok(
          proben.every((p) => p.length === 1),
          'überblendet trotzdem'
        )
        const namen = new Set(proben.flat().map((e) => e.alt))
        assert.ok(namen.size >= 2, 'nicht weitergeschaltet')
        const ersterName = proben[0][0].alt
        const s = proben.filter((p) => p[0].alt === ersterName).map((p) => p[0].m[0])
        assert.ok(Math.max(...s) - Math.min(...s) < 1e-3, 'bewegt sich trotzdem')
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
