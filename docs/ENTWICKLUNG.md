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

Ein einzelner Test: `npx vitest run src/main/services/netzRegel.test.ts`.
E2E mit Ausgabe des main-Prozesses: `E2E_DEBUG=1 npm run e2e:run -- smoke`.

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
- **CI** (`.github/workflows/ci.yml`): Prüfungen unter Linux mit Node 22 und 24 (samt
  `npm audit --omit=dev`), E2E unter Windows und Linux.
- **Geplante Dateien:** Plan und Skills nennen Dateien späterer Phasen. Sie stehen in
  `scripts/geplante-dateien.json` und gelten für `check:refs` als vorhanden; entsteht eine,
  meldet die Prüfung, dass der Eintrag gestrichen werden soll.
