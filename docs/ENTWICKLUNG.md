# Entwicklung

Wie man Galeria Beata einrichtet, startet, prüft und erweitert. Plan, Entscheidungen und Phasen:
[PLAN.md](PLAN.md); Sicherheit und Lieferkette: [SICHERHEIT.md](SICHERHEIT.md).

## Voraussetzungen

- Windows 10/11 x64 (Zielsystem); Linux läuft in der CI mit.
- Git und Node.js ≥ 22.12 (`engines` in `package.json`, `engine-strict`). Kein C++-Compiler,
  kein Python: Install-Skripte laufen nie (`.npmrc`).
- Für die Abnahme eines Installers die **Windows-Sandbox** (Windows-Feature, einmalig als
  Administrator einschalten, danach Neustart):
  `Enable-WindowsOptionalFeature -Online -FeatureName Containers-DisposableClientVM -All`.

## Einrichten und starten

```bash
npm ci            # Abhängigkeiten genau nach package-lock.json, ohne Install-Skripte
npm run dev       # holt die Electron-Binary (mit Prüfsumme), startet mit Hot Reload
```

Die Electron-Binary lädt `scripts/fetch-electron-bin.mjs` beim ersten `dev`, `start` oder `e2e`
aus dem GitHub-Release von Electron und prüft sie gegen `electron/checksums.json` aus dem
npm-Paket. Danach braucht die Entwicklung kein Netz mehr.

## NPM-Skripte

| Skript | Was |
|---|---|
| `npm run dev` | Entwicklung mit Hot Reload |
| `npm run start` | gebaute App starten (`electron-vite preview`) |
| `npm run build` | Typen prüfen und nach `out/` bauen |
| `npm run lint` | ESLint, warnungsfrei (`--max-warnings 0`); sperrt Netz-Module im main |
| `npm run format:check` | Prettier prüfen (`format` schreibt – nur gezielt auf geänderte Dateien) |
| `npm run typecheck` / `typecheck:test` | tsc für App (node + web) bzw. Testdateien |
| `npm test` | Vitest einmalig (`test:watch` für Watch) |
| `npm run e2e` | App bauen und alle E2E-Skripte (`-- smoke netz` wählt aus); `e2e:run` ohne Bauen |
| `npm run check:files` | Dateinamen, die unter Windows kollidieren |
| `npm run check:refs` | Dateiverweise in CLAUDE.md, README, docs/ und Skills existieren |
| `npm run electron:bin` | nur die Electron-Binary holen |
| `npm run exiftool:fetch` / `ffmpeg:fetch` | gebündelte Werkzeuge nach `resources/` laden (`-- --force` lädt neu) |
| `npm run testbilder -- <ordner>` | synthetische Testbibliothek erzeugen (`--gross`, `--ohne-videos`) |
| `npm run package` / `package:dir` | Installer nach `dist/` bzw. nur entpackt (`dist/win-unpacked`) |
| `npm run abnahme:sandbox` | Installer in der Windows-Sandbox ohne Netz prüfen (Bericht in `dist/abnahme/ergebnis`) |

Ein einzelner Test: `npx vitest run src/main/services/netzRegel.test.ts`.
E2E mit Ausgabe des main-Prozesses: `E2E_DEBUG=1 npm run e2e:run -- smoke`.

## Gebündelte Werkzeuge und Testbilder

ExifTool und ffmpeg liegen nicht im Git, sondern werden per Skript nach `resources/exiftool/<os>/`
bzw. `resources/ffmpeg/<os>/` geladen (`os` = `win` oder `linux`; Linux nur für die CI). Version
und SHA-256 stehen **fest im Skript** – wie ein Lockfile:

| Werkzeug | Stand | Quelle |
|---|---|---|
| ExifTool | 13.59 (27.05.2026) | SourceForge-Projekt von ExifTool (Links auf exiftool.org), Prüfsumme aus exiftool.org/checksums.txt |
| ffmpeg/ffprobe | n9.0.2, LGPL, Monats-Build vom 30.09.2026 | BtbN/FFmpeg-Builds; Windows „shared“ (150 MB), Linux statisch |

Neue Version: Skill `abhaengigkeiten`. Ein Skript lädt nur, wenn der Pin nicht schon da ist; ein
fehlgeschlagener Lauf lässt den vorhandenen Stand stehen (neuer Ordner wird erst fertig gebaut,
dann getauscht – `scripts/lib/laden.mjs`).

**Testbilder** (`scripts/testbilder.mjs`, nie echte Fotos): Ausrichtungen 1–8 mit Vierfarb-Motiv,
Orte für die Sortierung (auch „Paris“ in zwei Ländern, ohne Standort), Namen mit Umlauten, Emoji,
„Bild 2/10“ und führendem `-`, Formate (progressiv, CMYK, 16 Bit, Alpha, WebP, GIF, AVIF, TIFF,
Display-P3, animiert), kaputte Dateien und kurze Videos (H.264/AAC, hochkant, „Handy“-MOV mit
Zeitzone und GPS, VP9, unter 1 s; HEVC nur, wo Windows einen Encoder hat). Daneben
`testbilder.json` mit allen erwarteten Werten. Der Labortest `scripts/testbilder.lab.test.mjs`
prüft die Bibliothek mit sharp, ExifTool und ffprobe nach; ohne gebündelte Werkzeuge überspringt
er sich.

## Labor

Messen statt raten (Skill `bild-labor`): Die Skripte in `scripts/labor/` sind wiederholbar und
schreiben ihre Ergebnisse auf die Konsole und als JSON in den Temp-Ordner. Sie laufen unter
Electrons eigener Node-Laufzeit (`ELECTRON_RUN_AS_NODE`), also wie später Bilddienst und main.

| Skript | Misst |
|---|---|
| `scripts/labor/sharp-durchsatz.mjs` | Vorschaubilder je Sekunde und Spitzenspeicher (24 MP, Gleichzeitigkeit, sehr große Bilder) |
| `scripts/labor/exiftool-durchsatz.mjs` | ExifTool `-stay_open`: Lesen, Schreiben, parallele Prozesse, Unicode, lange Pfade |
| `scripts/labor/formate.mjs` | Formatmatrix: sharp, Chromium in der gebauten App, ExifTool schreibt (vorher bauen) |
| `scripts/labor/sqlite-index.mjs` | 50.000 Zeilen einfügen (Blockierzeit je Stapel), Sortier- und Filterabfragen |

Ergebnisse stehen in [PLAN.md, Phase 0](PLAN.md#phase-0--fundament-und-labor).

## Paket und Abnahme

`npm run package` lädt ExifTool und ffmpeg (falls nötig), baut und erzeugt mit electron-builder
(gepinnt, per `npx`) `dist/Galeria-Beata-<version>-setup.exe`; `package:dir` nur den entpackten
Ordner für `npm run e2e:run -- paket`. Symbole: `build/icon.svg` → `node scripts/icon.mjs`
(Ergebnis einchecken).

**Stolperstein: gesperrtes `app.asar`.** Durchsucht ein anderes Electron-Programm den
Projektordner – etwa die Claude-Desktop-App –, öffnet dessen Dateisystem
`dist/win-unpacked/resources/app.asar` wie einen Ordner und hält es offen; dann lässt sich `dist/`
weder löschen noch neu paketieren („Device or resource busy“, gemessen am 25.10.2026, Restart
Manager nannte die Claude-App). Abhilfe: das Programm neu starten, oder in einen neuen Ordner
bauen: `npx --yes electron-builder@26.17.0 --publish never -c.directories.output=dist/frisch`
(die Sandbox-Abnahme nimmt den neuesten Installer unter `dist/`).

Abnahme in der **Windows-Sandbox ohne Netz** (Voraussetzung oben): `npm run abnahme:sandbox`
öffnet die Sandbox; darin installiert `scripts/sandbox/abnahme.ps1` still, startet die App, prüft
die gebündelten Programme, deinstalliert und schreibt `dist/abnahme/ergebnis/abnahme.txt` samt
Bildschirmfoto. Die SmartScreen-Meldung für `docs/INSTALL.md` zeigt sich nur bei einem
heruntergeladenen Installer (Markierung „aus dem Internet“) – dafür den Installer aus dem
Release bzw. CI-Artefakt von Hand in der Sandbox starten.

## Aufbau

Drei Build-Ziele (electron-vite, CommonJS für main und preload):

| Ordner | Was |
|---|---|
| `src/main/` | Lebenszyklus (`index.ts`), IPC-Handler (`ipc/`), Dienste (`services/`) |
| `src/preload/` | die typisierte Brücke `window.api` (GalerieApi), sonst nichts |
| `src/renderer/` | React-Oberfläche (`src/`), `index.html` mit der CSP |
| `src/shared/` | rein und getestet: Typen, IPC-Vertrag, Einstellungen prüfen und zusammenführen |
| `e2e/` | Playwright-Skripte gegen die gebaute App (Skill `electron-e2e`) |
| `scripts/` | Electron-Binary holen, Prüfskripte; später ExifTool/ffmpeg laden, Testbilder |

Aliase: `@shared` (überall), `@renderer` (Renderer und Tests). Zielaufbau aller späteren Teile:
[PLAN.md, „Architektur“](PLAN.md#architektur).

### Grundmuster

- **IPC:** `src/shared/ipc-contracts.ts` (`Channels` + `GalerieApi`) ist die einzige Quelle; neue
  Fläche nach Skill `ipc-kanal`. Handler immer über `handle`/`on` aus `src/main/ipc/handle.ts` –
  die prüfen, dass die Anfrage von der App-Seite kommt. Eingaben gelten als fremd und werden
  geprüft (Beispiel `src/shared/settingsCheck.ts`).
- **Renderer** spricht nur über `api` (`src/renderer/src/lib/api.ts`), nie direkt mit
  `ipcRenderer`; er bekommt nie Dateipfade zum Lesen (später `thumb://`/`bild://` mit Kennungen).
- **Einstellungen:** `settings.json` in userData über `services/store.ts` (atomar, defekte Datei
  wird weggesichert); im Renderer `useSettings(sel)` und `updateSettings(teiländerung)` aus
  `lib/settings.ts`. localStorage nur als Boot-Spiegel (Design), nie als eigener Speicher.
- **Erscheinungsbild:** Tokens als CSS-Variablen in `src/renderer/src/assets/main.css` (Werte aus
  dem Plan), Tailwind-Namen in `tailwind.config.js`; Hell = Klasse `.light` am `<html>`. Das
  Design geht per `nativeTheme.themeSource` auch an Electron (Titelleiste, Dialoge).
- **Kein Netz:** siehe [SICHERHEIT.md](SICHERHEIT.md) – Netzsperre, Lint-Regel, CSP.

## Konventionen

- Prettier: kein Semikolon, einfache Anführungszeichen, 100 Zeichen; Markdown ist ausgenommen.
- ESLint warnungsfrei; `noUnusedLocals`/`noUnusedParameters` aktiv.
- Deutsch für Oberfläche und Kommentare; Kommentare erklären das Warum.
- Aus der Mottulbox kopierte Dateien tragen im Kopf ihre Herkunft
  (`Aus der Mottulbox übernommen (project_mega/<pfad>, Stand <commit>)`).
- Nie echte Fotos oder Videos in Repository, Tests oder Logs.

## Tests und CI

- **Unit-Tests** (Vitest) neben dem Code (`*.test.ts`), für alles Reine in `src/shared/` und die
  Regeln im main (`windowPolicy`, `netzRegel`).
- **E2E** (`e2e/`): `smoke` (Start, Design-Umschalter), `security` (Sandbox, CSP, Navigation,
  Berechtigungen, keine Dateien von außen, IPC-Prüfung), `netz` (Spion-Server bekommt nichts, mit
  Gegenprobe). Jeder Schritt hat ein Zeitlimit von 60 s.
- **Labortests** (`*.lab.test.*`) mit den echten Werkzeugen auf synthetischen Dateien; sie laufen
  mit `npm test`, sobald ExifTool und ffmpeg geladen sind.
- **CI** (`.github/workflows/ci.yml`): Prüfungen unter Linux mit Node 22 und 24 (samt
  `npm audit --omit=dev`); unter Windows und Linux Labortests (Werkzeuge im Cache) und E2E.
- **Geplante Dateien:** Plan und Skills nennen Dateien späterer Phasen. Sie stehen in
  `scripts/geplante-dateien.json` und gelten für `check:refs` als vorhanden; entsteht eine,
  meldet die Prüfung, dass der Eintrag gestrichen werden soll.
