// Rauchtest der gebauten App: Start, leere Galerie, Programmbrücke, Design-Umschalter
// (System/Hell/Dunkel, gespeichert und an Electron weitergegeben), Statusleiste.

import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { launchApp, runSteps, waitFor } from './harness.mjs'

const ctx = await launchApp()
const { app, page } = ctx

const designKnopf = (name) => page.getByRole('radio', { name, exact: true })
const istHell = () => page.evaluate(() => document.documentElement.classList.contains('light'))
const themeSource = () => app.evaluate(({ nativeTheme }) => nativeTheme.themeSource)
const gespeichert = () => {
  const f = join(ctx.userData, 'settings.json')
  return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')).theme : undefined
}

try {
  await runSteps('Rauchtest', [
    [
      'Hauptfenster startet mit Titel „Galeria Beata“',
      async () => {
        assert.equal(await page.title(), 'Galeria Beata')
      }
    ],
    [
      'Leere Galerie zeigt „Noch keine Ordner“',
      async () => {
        await page.getByRole('heading', { name: 'Noch keine Ordner' }).waitFor({ timeout: 15_000 })
      }
    ],
    [
      'Programmbrücke bietet genau die GalerieApi, sonst nichts',
      async () => {
        const keys = await page.evaluate(() => Object.keys(window.api).sort())
        assert.deepEqual(keys, [
          'getSettings',
          'library',
          'log',
          'onSettingsChanged',
          'setSettings'
        ])
      }
    ],
    [
      'Design folgt ab Werk Windows („Wie Windows“ gewählt)',
      async () => {
        await designKnopf('Wie Windows').waitFor({ timeout: 10_000 })
        assert.equal(await designKnopf('Wie Windows').getAttribute('aria-checked'), 'true')
        assert.equal(await themeSource(), 'system')
      }
    ],
    [
      '„Hell“ setzt das helle Design, speichert es und gibt es an Electron weiter',
      async () => {
        await designKnopf('Hell').click()
        assert.ok(await waitFor(istHell, 5_000), 'Klasse .light fehlt')
        assert.ok(await waitFor(() => gespeichert() === 'light', 5_000), 'nicht gespeichert')
        assert.equal(await themeSource(), 'light')
        assert.equal(await designKnopf('Hell').getAttribute('aria-checked'), 'true')
      }
    ],
    [
      '„Dunkel“ per Pfeiltaste, bleibt nach dem Neuladen',
      async () => {
        await designKnopf('Hell').focus()
        await page.keyboard.press('ArrowRight')
        assert.ok(await waitFor(async () => !(await istHell()), 5_000), 'noch hell')
        assert.ok(await waitFor(() => gespeichert() === 'dark', 5_000), 'nicht gespeichert')
        assert.equal(await themeSource(), 'dark')
        await page.reload()
        await page.waitForLoadState('domcontentloaded')
        // schon vor dem Laden der Einstellungen richtig (Boot-Spiegel, kein Flackern)
        assert.equal(await istHell(), false)
        await designKnopf('Dunkel').waitFor({ timeout: 10_000 })
        assert.equal(await designKnopf('Dunkel').getAttribute('aria-checked'), 'true')
      }
    ],
    [
      'Statusleiste zeigt „Offline“',
      async () => {
        await page.getByText('Offline', { exact: true }).waitFor({ timeout: 5_000 })
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
