// Fenster-Härtung in der echten App (Schicht C, Skill bildschutz): Sandbox ohne Node, strenge CSP,
// keine Navigation weg von der App-Seite, keine neuen Fenster (auch kein Weiterreichen an den
// Browser), Berechtigungen verweigert, keine Dateien von außerhalb, IPC prüft Eingaben.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { launchApp, runSteps, sleep } from './harness.mjs'

const ctx = await launchApp()
const { app, page } = ctx

// Kleinstes gültiges PNG (1×1) – liegt außerhalb der App und darf nie geladen werden
const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
)

/** Standardbrowser und Shell ersetzen: merken, was die App ihnen geben würde. */
async function stubShell() {
  await app.evaluate(({ shell }) => {
    const calls = (globalThis.__shell = [])
    shell.openExternal = async (url) => void calls.push(['extern', url])
    shell.openPath = async (p) => {
      calls.push(['ordner', p])
      return ''
    }
  })
}
const shellCalls = () => app.evaluate(() => globalThis.__shell)
const windowCount = () =>
  app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length).catch(() => -1)

/** Im Hauptfenster wegnavigieren lassen; danach muss es noch die App-Seite zeigen. */
async function tryNavigate(url) {
  await page.evaluate((u) => {
    window.location.href = u
  }, url)
  await sleep(800)
  return page.url()
}

try {
  await stubShell()
  const fremd = join(ctx.userData, 'fremd')
  mkdirSync(fremd)
  const fremdeSeite = join(fremd, 'seite.html')
  writeFileSync(fremdeSeite, '<p>fremd</p>')
  const fremdesBild = join(fremd, 'bild.png')
  writeFileSync(fremdesBild, PNG_1x1)
  await page.getByRole('heading', { name: 'Noch keine Ordner' }).waitFor({ timeout: 15_000 })

  await runSteps('Fenster-Härtung', [
    [
      'Seite läuft ohne Node (Sandbox, contextIsolation)',
      async () => {
        const r = await page.evaluate(() => ({
          require: typeof globalThis.require,
          process: typeof globalThis.process,
          module: typeof globalThis.module
        }))
        assert.deepEqual(r, { require: 'undefined', process: 'undefined', module: 'undefined' })
      }
    ],
    [
      'CSP des Builds: keine Inline-Skripte, kein eval, nichts von außen',
      async () => {
        const csp = await page.evaluate(
          () => document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.content ?? ''
        )
        assert.match(csp, /script-src 'self';/)
        assert.doesNotMatch(csp, /unsafe-eval/)
        assert.match(csp, /connect-src 'self'/)
        assert.match(csp, /object-src 'none'/)
        // eval prüfen: page.evaluate selbst darf es (DevTools-Protokoll umgeht die CSP), ein
        // String-Timer läuft dagegen später im normalen Seitenkontext
        const r = await page.evaluate(
          () =>
            new Promise((resolve) => {
              let verletzt = false
              document.addEventListener('securitypolicyviolation', (e) => {
                if (e.blockedURI === 'eval') verletzt = true
              })
              setTimeout('window.__evalLief = true', 0)
              setTimeout(() => resolve({ lief: window.__evalLief === true, verletzt }), 300)
            })
        )
        assert.deepEqual(r, { lief: false, verletzt: true })
      }
    ],
    [
      'Navigation zu einer Webseite bleibt in der App und geht nicht an den Browser',
      async () => {
        const url = await tryNavigate('https://example.com/')
        assert.match(url, /index\.html(#\/?)?$/)
        assert.deepEqual(await shellCalls(), [])
      }
    ],
    [
      'Navigation zu einer anderen Datei wird verhindert – auch mit kaputter %-Kodierung',
      async () => {
        for (const ziel of [
          pathToFileURL(fremdeSeite).href,
          pathToFileURL(fremdeSeite).href.replace('seite.html', 'seite%E0.html')
        ]) {
          const url = await tryNavigate(ziel)
          assert.match(url, /index\.html(#\/?)?$/, ziel)
        }
        assert.deepEqual(await shellCalls(), [])
        // die App-Seite arbeitet noch (Brücke da)
        assert.equal(await page.evaluate(() => typeof window.api?.getSettings), 'function')
      }
    ],
    [
      'window.open: kein neues Fenster, nichts an Browser oder Shell',
      async () => {
        const before = await windowCount()
        await page.evaluate(() => {
          window.open('https://192.168.1.20/', '_blank')
          window.open('file:///C:/Windows/System32/calc.exe', '_blank')
          window.open('javascript:alert(1)', '_blank')
        })
        await sleep(800)
        assert.equal(await windowCount(), before)
        assert.deepEqual(await shellCalls(), [])
      }
    ],
    [
      'Berechtigungen: Kamera, Mikrofon, Standort und Benachrichtigungen verweigert',
      async () => {
        const states = await page.evaluate(async () => {
          const q = (name) =>
            navigator.permissions.query({ name }).then(
              (s) => s.state,
              () => 'unbekannt'
            )
          return {
            camera: await q('camera'),
            microphone: await q('microphone'),
            geolocation: await q('geolocation'),
            notifications: await Notification.requestPermission()
          }
        })
        assert.deepEqual(states, {
          camera: 'denied',
          microphone: 'denied',
          geolocation: 'denied',
          notifications: 'denied'
        })
      }
    ],
    [
      'Bilddatei von außerhalb der App lädt nicht (kein file:-Zugriff)',
      async () => {
        const geladen = await page.evaluate(
          (src) =>
            new Promise((resolve) => {
              const img = new Image()
              img.onload = () => resolve(img.naturalWidth > 0)
              img.onerror = () => resolve(false)
              img.src = src
              setTimeout(() => resolve('zeitüberschreitung'), 5_000)
            }),
          pathToFileURL(fremdesBild).href
        )
        assert.equal(geladen, false)
      }
    ],
    [
      'Datei von außerhalb auch nicht über ein vom main erzeugtes Fenster',
      async () => {
        // Die Wächter greifen bei Navigation aus der Seite; die Netzsperre zusätzlich bei jedem
        // Laden – auch wenn der main selbst eine fremde Datei öffnen würde.
        const r = await app.evaluate(async ({ BrowserWindow }, file) => {
          const w = new BrowserWindow({ show: false })
          try {
            await w.loadFile(file)
            return 'geladen'
          } catch (e) {
            return String(e.message ?? e)
          } finally {
            w.destroy()
          }
        }, fremdeSeite)
        assert.match(r, /ERR_BLOCKED_BY_CLIENT/)
      }
    ],
    [
      'IPC: ungültige oder unbekannte Einstellungen werden abgelehnt, nichts ändert sich',
      async () => {
        const vorher = await page.evaluate(() => window.api.getSettings())
        for (const patch of [{ theme: 'lila' }, { fremd: true }, 'kaputt', null]) {
          const r = await page.evaluate(
            (p) =>
              window.api.setSettings(p).then(
                () => 'angenommen',
                (e) => String(e.message ?? e)
              ),
            patch
          )
          assert.notEqual(r, 'angenommen', JSON.stringify(patch))
        }
        assert.deepEqual(await page.evaluate(() => window.api.getSettings()), vorher)
      }
    ],
    [
      'thumb://: nur gültige Adressen und Kennungen aus dem Index, nur GET – sonst kein Bild',
      async () => {
        // im main über denselben Handler wie die Seite (net.fetch kennt eigene Protokolle)
        const status = (url, method = 'GET') =>
          app.evaluate(
            async ({ net }, [u, m]) => (await net.fetch(u, { method: m })).status,
            [url, method]
          )
        assert.equal(await status('thumb://id/999999/256'), 404, 'erfundene Kennung')
        for (const url of [
          'thumb://id/1/512',
          'thumb://id/0/256',
          'thumb://id/abc/256',
          'thumb://id/1/256/x',
          'thumb://anders/1/256',
          'thumb://id/1/..%2f..%2fx',
          // Ziffern als Rechnername liest Chromium als IP-Adresse – darum der feste Name „id“
          'thumb://42/256'
        ]) {
          assert.equal(await status(url), 400, url)
        }
        assert.equal(await status('thumb://id/1/256', 'POST'), 405)
        // in der Seite: kein <img> lädt etwas
        const geladen = await page.evaluate(
          (urls) =>
            Promise.all(
              urls.map(
                (u) =>
                  new Promise((res) => {
                    const i = new Image()
                    i.onload = () => res(u)
                    i.onerror = () => res(false)
                    i.src = u
                  })
              )
            ),
          ['thumb://id/999999/256', 'thumb://id/1/../../../windows/win.ini', 'thumb://42/256']
        )
        assert.deepEqual(geladen, [false, false, false])
      }
    ],
    [
      'keine unbehandelten Fehler im Hauptfenster',
      async () => {
        // abgewiesene Ladeversuche erscheinen absichtlich als Konsolenfehler; Abstürze nicht
        assert.deepEqual(
          ctx.errors.filter((e) => e.startsWith('pageerror:')),
          []
        )
      }
    ]
  ])
} finally {
  await ctx.close()
}
