// Netzsperre in der echten App (Schicht A, Skill bildschutz): Ein lokaler Spion-Server darf keine
// einzige Anfrage bekommen – weder aus dem Hauptfenster (fetch, Bild, WebSocket, Beacon …) noch
// aus dem main über Electrons `net` noch aus einem vom main geöffneten Fenster.
// Gegenprobe: Eine Sitzung OHNE Netzsperre erreicht den Spion – sonst bewiese der Test nichts.

import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { launchApp, runSteps, sleep } from './harness.mjs'

/** Spion: zählt jede Anfrage und jeden WebSocket-Verbindungsversuch. */
const anfragen = []
const spion = createServer((req, res) => {
  anfragen.push(req.url)
  res.writeHead(200, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' })
  res.end('spion')
})
spion.on('upgrade', (req, socket) => {
  anfragen.push('ws ' + req.url)
  socket.destroy()
})
await new Promise((r) => spion.listen(0, '127.0.0.1', r))
const basis = `http://127.0.0.1:${spion.address().port}`
// Pfad mit erkennbarem Inhalt: darf nie im Log landen (Log nur mit Protokoll und Rechner)
const GEHEIM = '/geheim-urlaub-48.137N-11.575E'

const ctx = await launchApp()
const { app, page } = ctx

try {
  await page.getByRole('heading', { name: 'Noch keine Ordner' }).waitFor({ timeout: 15_000 })

  await runSteps('Netzsperre', [
    [
      'Gegenprobe: der Spion zählt Anfragen (aus Node und aus einer Sitzung ohne Sperre)',
      async () => {
        const res = await fetch(basis + '/kontrolle')
        assert.equal(await res.text(), 'spion')
        const r = await app.evaluate(async ({ session }, url) => {
          const res = await session.fromPartition('e2e-ohne-sperre').fetch(url)
          return res.status
        }, basis + '/gegenprobe')
        assert.equal(r, 200)
        assert.deepEqual(anfragen, ['/kontrolle', '/gegenprobe'])
        anfragen.length = 0
      }
    ],
    [
      'Hauptfenster: fetch, XHR, Bild, Stil, WebSocket, Beacon, EventSource, Rahmen – nichts kommt an',
      async () => {
        await page.evaluate(
          ({ basis, geheim }) => {
            const ws = basis.replace('http:', 'ws:')
            void fetch(basis + geheim + '/fetch').catch(() => {})
            const xhr = new XMLHttpRequest()
            xhr.open('GET', basis + '/xhr')
            xhr.onerror = () => {}
            xhr.send()
            const img = new Image()
            img.onerror = () => {}
            img.src = basis + '/bild.png'
            const div = document.createElement('div')
            div.style.backgroundImage = `url(${basis}/hintergrund.png)`
            document.body.appendChild(div)
            try {
              const sock = new WebSocket(ws + '/ws')
              sock.onerror = () => {}
            } catch {
              /* von der CSP abgewiesen */
            }
            navigator.sendBeacon(basis + '/beacon', 'x')
            try {
              const es = new EventSource(basis + '/sse')
              es.onerror = () => es.close()
            } catch {
              /* abgewiesen */
            }
            const frame = document.createElement('iframe')
            frame.src = basis + '/rahmen'
            document.body.appendChild(frame)
            const link = document.createElement('link')
            link.rel = 'prefetch'
            link.href = basis + '/prefetch'
            document.head.appendChild(link)
          },
          { basis, geheim: GEHEIM }
        )
        await sleep(2_000)
        assert.deepEqual(anfragen, [])
      }
    ],
    [
      'main: Electrons net.fetch über die Standard-Sitzung wird abgewiesen',
      async () => {
        const r = await app.evaluate(
          async ({ net }, url) => {
            try {
              const res = await net.fetch(url)
              return 'Antwort ' + res.status
            } catch (e) {
              return String(e.message ?? e)
            }
          },
          basis + GEHEIM + '/net'
        )
        assert.doesNotMatch(r, /^Antwort/)
        assert.deepEqual(anfragen, [])
      }
    ],
    [
      'vom main geöffnetes Fenster: Laden einer Webadresse wird abgewiesen',
      async () => {
        const r = await app.evaluate(async ({ BrowserWindow }, url) => {
          const w = new BrowserWindow({ show: false })
          try {
            await w.loadURL(url)
            return 'geladen'
          } catch (e) {
            return String(e.message ?? e)
          } finally {
            w.destroy()
          }
        }, basis + '/fenster')
        assert.match(r, /ERR_BLOCKED_BY_CLIENT/)
        assert.deepEqual(anfragen, [])
      }
    ],
    [
      'Log nennt das abgewiesene Ziel nur mit Protokoll und Rechner, nie den Pfad',
      async () => {
        const logFile = join(ctx.userData, 'galeria-debug.log')
        assert.ok(existsSync(logFile), 'kein Log')
        const log = readFileSync(logFile, 'utf8')
        assert.match(log, new RegExp(`\\[netzsperre\\] abgewiesen: ${basis.replace(/\./g, '\\.')}`))
        assert.ok(!log.includes('geheim-urlaub'), 'Pfad im Log')
      }
    ]
  ])
} finally {
  await ctx.close()
  spion.close()
}
