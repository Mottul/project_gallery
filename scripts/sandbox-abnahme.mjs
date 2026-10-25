// Abnahme des Installers in der Windows-Sandbox ohne Netz vorbereiten und starten (Skill
// windows-paket, „Prüfen“). Schreibt dist/abnahme/abnahme.wsb: Netz aus, Ordner des neuesten
// Installers und Skript (scripts/sandbox/) nur lesend eingebunden, Ergebnisordner beschreibbar;
// beim Anmelden läuft scripts/sandbox/abnahme.ps1. Mit --starten öffnet es die Sandbox und wartet
// auf den Bericht. Der Installer darf auch in einem Unterordner von dist/ liegen (gebaut mit
// `-c.directories.output=dist/<name>`, wenn dist/win-unpacked gesperrt ist – docs/ENTWICKLUNG.md).
//
// Voraussetzung: Windows 10/11 Pro, Windows-Sandbox eingeschaltet (docs/ENTWICKLUNG.md),
// Installer gebaut (npm run package).
// Aufruf: npm run abnahme:sandbox   (= node scripts/sandbox-abnahme.mjs --starten)

import { spawn, spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DIST = join(ROOT, 'dist')
const SANDBOX = 'C:\\Windows\\System32\\WindowsSandbox.exe'

const xml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** Läuft schon eine Windows-Sandbox (Fenster oder Dienst)? */
function sandboxLaeuft() {
  const r = spawnSync('tasklist', ['/FO', 'CSV', '/NH'], { encoding: 'utf8' })
  return /"WindowsSandbox(RemoteSession|Server|Client)?\.exe"/i.test(r.stdout ?? '')
}

/** Neuester Installer in dist/ oder einem Unterordner davon; null, wenn keiner da ist. */
function neuesterInstaller() {
  if (!existsSync(DIST)) return null
  const ordner = [
    DIST,
    ...readdirSync(DIST, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith('abnahme'))
      .map((e) => join(DIST, e.name))
  ]
  const kandidaten = ordner.flatMap((o) =>
    readdirSync(o)
      .filter((n) => /^Galeria-Beata-.+-setup\.exe$/.test(n))
      .map((n) => join(o, n))
  )
  kandidaten.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)
  return kandidaten[0] ?? null
}

function main() {
  if (process.platform !== 'win32') throw new Error('Die Windows-Sandbox gibt es nur unter Windows')
  const setup = neuesterInstaller()
  if (!setup) throw new Error('Kein Installer in dist/ – zuerst npm run package')
  let ordner = join(DIST, 'abnahme')
  try {
    rmSync(ordner, { recursive: true, force: true })
  } catch {
    // ein anderes Programm hält den alten Bericht offen (etwa ein Bildbetrachter): neuer Ordner
    ordner = join(DIST, `abnahme-${Date.now()}`)
  }
  const ergebnis = join(ordner, 'ergebnis')
  mkdirSync(ergebnis, { recursive: true })
  const wsb = `<Configuration>
  <Networking>Disable</Networking>
  <vGPU>Disable</vGPU>
  <ClipboardRedirection>Disable</ClipboardRedirection>
  <MappedFolders>
    <MappedFolder>
      <HostFolder>${xml(dirname(setup))}</HostFolder>
      <SandboxFolder>C:\\Installer</SandboxFolder>
      <ReadOnly>true</ReadOnly>
    </MappedFolder>
    <MappedFolder>
      <HostFolder>${xml(join(ROOT, 'scripts', 'sandbox'))}</HostFolder>
      <SandboxFolder>C:\\Abnahme</SandboxFolder>
      <ReadOnly>true</ReadOnly>
    </MappedFolder>
    <MappedFolder>
      <HostFolder>${xml(ergebnis)}</HostFolder>
      <SandboxFolder>C:\\Ergebnis</SandboxFolder>
      <ReadOnly>false</ReadOnly>
    </MappedFolder>
  </MappedFolders>
  <LogonCommand>
    <Command>cmd.exe /c "echo gestartet &gt; C:\\Ergebnis\\gestartet.txt &amp; powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\\Abnahme\\abnahme.ps1 &gt; C:\\Ergebnis\\powershell.txt 2&gt;&amp;1"</Command>
  </LogonCommand>
</Configuration>
`
  const datei = join(ordner, 'abnahme.wsb')
  writeFileSync(datei, wsb, 'utf8')
  console.log(`Installer: ${setup}`)
  console.log(`Sandbox-Konfiguration: ${datei}`)
  if (!process.argv.includes('--starten')) return

  if (!existsSync(SANDBOX)) {
    throw new Error(
      'Windows-Sandbox ist nicht eingeschaltet. Als Administrator in PowerShell:\n' +
        '  Enable-WindowsOptionalFeature -Online -FeatureName Containers-DisposableClientVM -All\n' +
        'danach neu starten (docs/ENTWICKLUNG.md, „Voraussetzungen“).'
    )
  }
  // Es läuft immer nur eine Sandbox: Ein neuer Start hängte sich sonst still an die offene an, und
  // die Abnahme liefe nie (so geschehen am 25.10.2026)
  if (sandboxLaeuft()) {
    throw new Error(
      'Es läuft schon eine Windows-Sandbox – bitte zuerst schließen, dann erneut starten.'
    )
  }
  spawn(SANDBOX, [datei], { detached: true, stdio: 'ignore' }).unref()
  console.log('Sandbox startet – die Abnahme läuft dort von selbst und schließt sie danach …')
  const fertig = join(ergebnis, 'fertig.txt')
  const t0 = Date.now()
  /** Was die Sandbox bisher geschrieben hat – zur Fehlersuche, wenn kein Bericht kommt. */
  const spuren = () => {
    for (const n of ['gestartet.txt', 'powershell.txt', 'abnahme.txt']) {
      const p = join(ergebnis, n)
      console.error(`--- ${n}: ${existsSync(p) ? '\n' + readFileSync(p, 'utf8') : '(fehlt)'}`)
    }
  }
  const warte = setInterval(() => {
    const vergangen = Date.now() - t0
    if (existsSync(fertig)) {
      clearInterval(warte)
      console.log('\n' + readFileSync(join(ergebnis, 'abnahme.txt'), 'utf8'))
      console.log(`Bildschirmfoto: ${join(ergebnis, 'app.png')}`)
      process.exitCode = readFileSync(fertig, 'utf8').trim() === '0' ? 0 : 1
    } else if (vergangen > 4 * 60_000 && !existsSync(join(ergebnis, 'gestartet.txt'))) {
      // Der Anmeldebefehl lief gar nicht (Sandbox hängt beim Start) – nicht 10 Minuten warten
      clearInterval(warte)
      console.error('Der Anmeldebefehl der Sandbox lief nach 4 Minuten noch nicht.')
      spuren()
      process.exitCode = 1
    } else if (vergangen > 10 * 60_000) {
      clearInterval(warte)
      console.error('Kein Bericht nach 10 Minuten.')
      spuren()
      process.exitCode = 1
    }
  }, 2000)
}

try {
  main()
} catch (err) {
  console.error(err.message)
  process.exit(1)
}
