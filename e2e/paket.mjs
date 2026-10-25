// Die GEPACKTE App (electron-builder --dir): Was nur im Paket schiefgeht, zeigt sich erst hier –
// Dateien im app.asar, native Module daneben (asarUnpack: sharp mit @img, better-sqlite3) und die
// gebündelten Programme (extraResources: ExifTool, ffmpeg). Muster: e2e/paket.mjs der Mottulbox.
// Nicht im Standardlauf; vorher `npm run package:dir`, dann `npm run e2e:run -- paket`.
//
// Solange die App sharp, SQLite, ExifTool und ffmpeg noch nicht selbst nutzt (Phase 1), lädt bzw.
// startet dieser Test sie im main-Prozess der gepackten App – genau dort, wo sie später laufen.

import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { launchApp, root, runSteps } from './harness.mjs'

const exe =
  process.platform === 'win32'
    ? join(root, 'dist', 'win-unpacked', 'Galeria Beata.exe')
    : join(root, 'dist', 'linux-unpacked', 'galeria-beata')
if (!existsSync(exe))
  throw new Error(`Keine gepackte App unter ${exe} – vorher npm run package:dir`)

const ctx = await launchApp({ executablePath: exe })
const { app, page } = ctx

/** Im main der gepackten App: Modul aus deren node_modules laden (wie später der Bilddienst). */
const imMain = (fn, arg) => app.evaluate(fn, arg)

try {
  await runSteps('Gepackte App', [
    [
      'startet aus dem app.asar: Titel und leere Galerie',
      async () => {
        const info = await imMain(({ app: a }) => ({
          packaged: a.isPackaged,
          appPath: a.getAppPath()
        }))
        assert.equal(info.packaged, true)
        assert.ok(info.appPath.endsWith('app.asar'), info.appPath)
        assert.equal(await page.title(), 'Galeria Beata')
        await page.getByRole('heading', { name: 'Noch keine Ordner' }).waitFor({ timeout: 15_000 })
      }
    ],
    [
      'sharp lädt aus app.asar.unpacked und rechnet',
      async () => {
        const r = await imMain(async () => {
          const sharp = process.mainModule.require('sharp')
          const buf = await sharp({
            create: { width: 8, height: 8, channels: 3, background: '#4ade80' }
          })
            .png()
            .toBuffer()
          // ein natives Modul lädt nie aus dem asar-Archiv – dass sharp rechnet, belegt das
          // Entpacken; der Ordner daneben zeigt, wo es liegt
          const { existsSync } = process.getBuiltinModule('node:fs')
          const { join: j } = process.getBuiltinModule('node:path')
          const unpacked = j(process.resourcesPath, 'app.asar.unpacked', 'node_modules')
          return {
            vips: sharp.versions.vips,
            bytes: buf.length,
            entpackt: ['sharp', '@img', 'better-sqlite3'].filter((m) => existsSync(j(unpacked, m)))
          }
        })
        assert.ok(r.bytes > 0)
        assert.match(r.vips, /^\d+\.\d+/)
        assert.deepEqual(r.entpackt, ['sharp', '@img', 'better-sqlite3'])
      }
    ],
    [
      'better-sqlite3 lädt aus app.asar.unpacked (mit FTS5)',
      async () => {
        const r = await imMain(() => {
          const Database = process.mainModule.require('better-sqlite3')
          const db = new Database(':memory:')
          // wie im Index geplant: Umlaute und Akzente zählen bei der Suche nicht
          db.exec(
            "CREATE VIRTUAL TABLE t USING fts5(x, tokenize = 'unicode61 remove_diacritics 2');" +
              "INSERT INTO t VALUES ('Grüße aus Köln'), ('Paris')"
          )
          const treffer = db.prepare("SELECT x FROM t WHERE t MATCH 'koln'").all()
          db.close()
          return treffer.map((z) => z.x)
        })
        assert.deepEqual(r, ['Grüße aus Köln'])
      }
    ],
    [
      'ExifTool und ffmpeg aus resources/ starten',
      async () => {
        const r = await imMain(({ app: a }) => {
          const { join: j } = process.getBuiltinModule('node:path')
          const { execFileSync } = process.getBuiltinModule('node:child_process')
          const exe = process.platform === 'win32' ? '.exe' : ''
          const res = process.resourcesPath
          return {
            exiftool: execFileSync(j(res, 'exiftool', `exiftool${exe}`), ['-ver'], {
              encoding: 'utf8'
            }).trim(),
            ffmpeg: execFileSync(j(res, 'ffmpeg', `ffmpeg${exe}`), ['-hide_banner', '-version'], {
              encoding: 'utf8'
            }).split('\n')[0],
            ffprobe: execFileSync(j(res, 'ffmpeg', `ffprobe${exe}`), ['-hide_banner', '-version'], {
              encoding: 'utf8'
            }).split('\n')[0],
            packaged: a.isPackaged
          }
        })
        assert.match(r.exiftool, /^\d+\.\d+$/)
        assert.match(r.ffmpeg, /^ffmpeg version n\d/)
        assert.match(r.ffprobe, /^ffprobe version n\d/)
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
}
