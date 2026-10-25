// E2E-Harness (aus der Mottulbox übernommen, project_mega/e2e/harness.mjs, Stand 0cc14cb, gekürzt):
// startet die GEBAUTE App (out/, `npm run e2e` baut vorher) über Playwright und räumt danach auf.
// Bewusst nur playwright-core (Electron-Treiber) – es werden keine Browser heruntergeladen.
//
// Jeder Lauf bekommt ein frisches userData-Verzeichnis: so landen weder Einstellungen noch
// Bibliothek des Entwicklers im Test, und die laufende eigene Galerie bleibt unberührt.

import { _electron as electron } from 'playwright-core'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)

export const root = join(dirname(fileURLToPath(import.meta.url)), '..')

/** So lange darf das Beenden einer App am Ende eines Skripts dauern */
const CLOSE_TIMEOUT_MS = 20_000

/**
 * Temp-Ordner eines Laufs löschen. Unter Windows halten gerade beendete Prozesse oder der
 * Virenscanner Dateien kurz fest (EPERM/EBUSY) – mehrmals versuchen, und klappt es nicht, den
 * Ordner liegen lassen: Aufräumen darf nie einen grünen Lauf rot machen.
 */
function aufraeumen(dir) {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  } catch (err) {
    console.log(`[e2e] Temp-Ordner bleibt liegen (${err.code ?? err}): ${dir}`)
  }
}

/**
 * Startet die App. `env` ergänzt die Umgebung, `args` kommt vor dem Projektordner.
 * `userData`: vorhandenen Ordner weiterverwenden (Neustart nachstellen) – der Aufrufer räumt ihn
 * dann selbst auf. `settings`: Inhalt der settings.json eines frischen Ordners.
 * `executablePath`: die gepackte App (`e2e/paket.mjs`) statt Electron mit dem Projektordner.
 * Liefert { app, page, errors, userData, close } – `page` ist das Hauptfenster.
 */
export async function launchApp({
  env = {},
  args = [],
  userData: given,
  settings,
  executablePath
} = {}) {
  let userData = given
  if (!userData) {
    userData = mkdtempSync(join(tmpdir(), 'galeria-e2e-'))
    if (settings) writeFileSync(join(userData, 'settings.json'), JSON.stringify(settings))
  }
  // Index und (ab 1.3) Vorschaubilder liegen unter %LOCALAPPDATA% – für den Lauf in den
  // Testordner umleiten, sonst landeten Testdaten im echten Profil (Skill electron-e2e)
  const full = { ...process.env, LOCALAPPDATA: join(userData, 'lokal'), ...env }
  // Von einer Electron-Umgebung (z. B. der Claude-Desktop-App) geerbt, würde die Binary als
  // reines Node starten statt als App.
  delete full.ELECTRON_RUN_AS_NODE
  // Linux (Container/CI): ohne Chromium-Sandbox und mit virtuellem Display (xvfb-run).
  const sandbox = process.platform === 'linux' ? ['--no-sandbox'] : []
  const app = await electron.launch({
    // Die gepackte App lädt ihr app.asar selbst – ohne Projektordner als Argument
    executablePath: executablePath ?? require('electron'),
    args: [...sandbox, `--user-data-dir=${userData}`, ...args, ...(executablePath ? [] : [root])],
    env: full
  })
  // gleich hier holen: Hat sich die App schon selbst beendet, wirft app.process() in Playwright
  const proc = app.process()
  // E2E_DEBUG=1: Ausgabe und Ende des main-Prozesses mitschreiben (Abstürze, Fehler im main)
  if (process.env.E2E_DEBUG) {
    proc.stdout?.on('data', (d) => process.stdout.write(`[main] ${d}`))
    proc.stderr?.on('data', (d) => process.stdout.write(`[main!] ${d}`))
    proc.on('exit', (code, signal) => console.log(`[main] beendet: Code ${code}, Signal ${signal}`))
  }
  const page = await app.firstWindow()
  // Fehler des Hauptfensters sammeln (pageerror und console.error)
  const errors = []
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text().slice(0, 200)))
  await page.waitForLoadState('domcontentloaded')
  // Das Hauptfenster erscheint erst bei 'ready-to-show'. Fehlversuche nur wiederholen: Kurz nach
  // dem Start meldet Playwright gelegentlich „Resulting promise was garbage collected“.
  const shown = await waitFor(
    () =>
      app
        .evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some((w) => w.isVisible()))
        .catch(() => false),
    30_000,
    100
  )
  if (!shown)
    throw new Error(`Hauptfenster wird nicht angezeigt; Fehler: ${JSON.stringify(errors)}`)
  return {
    app,
    page,
    errors,
    userData,
    async close() {
      // Beenden mit Zeitlimit (in der Mottulbox hing app.close() einmal 42 Minuten); was danach
      // noch steht, wird hart beendet, damit die übrigen Skripte laufen.
      const zu = await Promise.race([
        app.close().then(
          () => true,
          () => true
        ),
        sleep(CLOSE_TIMEOUT_MS).then(() => false)
      ])
      if (!zu && proc.exitCode === null && proc.signalCode === null) {
        console.log(
          `  [e2e] App nach ${CLOSE_TIMEOUT_MS / 1000} s nicht beendet – Prozess wird beendet`
        )
        try {
          proc.kill('SIGKILL')
        } catch {
          // schon weg
        }
        await sleep(500)
      }
      if (!given) aufraeumen(userData)
    }
  }
}

/** Route im HashRouter öffnen, z. B. openRoute(page, '/einstellungen'). */
export async function openRoute(page, route) {
  await page.evaluate((r) => {
    window.location.hash = r
  }, route)
}

/**
 * Die native Ja/Nein-Rückfrage (dialog.showMessageBox im main) durch eine feste Antwort
 * ersetzen; sonst blockiert der Dialog den Test.
 */
export async function stubConfirm(app, accept) {
  await app.evaluate(({ dialog }, ok) => {
    dialog.showMessageBox = async () => ({ response: ok ? 0 : 1, checkboxChecked: false })
  }, accept)
}

/**
 * Dialog mit einer Antwortfolge ersetzen, z. B. [1, 0] = erst Abbrechen, dann Bestätigen.
 * Ist die Folge leer, antwortet er mit Abbrechen.
 */
export async function stubConfirmSequence(app, answers) {
  await app.evaluate(({ dialog }, seq) => {
    globalThis.__answers = [...seq]
    dialog.showMessageBox = async () => ({
      response: globalThis.__answers.shift() ?? 1,
      checkboxChecked: false
    })
  }, answers)
}

/**
 * Den Ordner-Dialog des main ersetzen: liefert `pfad` (oder Abbrechen bei null) und merkt sich die
 * Optionen des letzten Aufrufs in globalThis.__ordnerDialog.
 */
export async function stubOrdnerDialog(app, pfad) {
  await app.evaluate(({ dialog }, p) => {
    dialog.showOpenDialog = async (...args) => {
      globalThis.__ordnerDialog = args[args.length - 1]
      return p ? { canceled: false, filePaths: [p] } : { canceled: true, filePaths: [] }
    }
  }, pfad)
}

/**
 * Frische Testbibliothek (scripts/testbilder.mjs, nie echte Fotos) in einem Temp-Ordner.
 * Liefert { dir, manifest, aufraeumen }. Braucht das gebündelte ExifTool und ffmpeg.
 */
export async function testbibliothek() {
  const { erzeugeTestbilder } = await import('../scripts/testbilder.mjs')
  const basis = mkdtempSync(join(tmpdir(), 'galeria-bib-'))
  const dir = join(basis, 'bib')
  const manifest = await erzeugeTestbilder(dir)
  return { dir, manifest, aufraeumen: () => aufraeumen(basis) }
}

/** Zahl der Dateien der Testbibliothek, die in die Galerie gehören (Bilder und kaputte Bilder). */
export function erwarteteBilder(manifest) {
  return manifest.eintraege.filter((e) => e.art === 'bild' || e.art === 'defekt').length
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** Wartet, bis `fn` etwas Wahres liefert; gibt es zurück, nach Ablauf `null`. */
export async function waitFor(fn, ms = 20_000, step = 200) {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    const v = await fn()
    if (v) return v
    await sleep(step)
  }
  return null
}

/** Wirft den Marker für „Schritt übersprungen“ (wird von runSteps als – gezählt). */
export class Skip extends Error {}

/** Höchstdauer eines Schritts: Ein hängender Schritt soll rot werden, nicht den Lauf anhalten. */
const STEP_TIMEOUT_MS = 60_000

/** Promise mit Zeitlimit; danach Fehler mit Namen. */
function mitZeitlimit(promise, ms, name) {
  let timer
  const limit = new Promise((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error(`Zeitüberschreitung nach ${ms / 1000} s: ${name}`)),
      ms
    )
  })
  return Promise.race([promise, limit]).finally(() => clearTimeout(timer))
}

/**
 * Kleiner Testlauf: führt Schritte der Reihe nach aus und meldet ✓/✗/–. Ein Schritt ist
 * `[Name, async () => …]`; er besteht, wenn er nicht wirft, und gilt als übersprungen, wenn
 * er `Skip` wirft. Schlägt einer fehl, wird der Exit-Code 1 (nie zurück auf 0 gesetzt, damit
 * mehrere Läufe in einem Prozess zusammenzählen). Jeder Schritt hat ein Zeitlimit (neu
 * gegenüber der Mottulbox: Dort hielt ein hängender Schritt den ganzen Lauf an).
 */
export async function runSteps(title, steps) {
  console.log(title)
  let failed = 0
  for (const [name, fn] of steps) {
    try {
      await mitZeitlimit(fn(), STEP_TIMEOUT_MS, name)
      console.log(`  ✓ ${name}`)
    } catch (e) {
      if (e instanceof Skip) {
        console.log(`  – ${name} (übersprungen: ${e.message})`)
        continue
      }
      failed++
      console.log(`  ✗ ${name}\n    ${e instanceof Error ? e.message : e}`)
    }
  }
  console.log(failed ? `${failed} von ${steps.length} Schritten fehlgeschlagen` : 'alles grün')
  if (failed) process.exitCode = 1
}
