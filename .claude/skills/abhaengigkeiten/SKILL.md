---
name: abhaengigkeiten
description: Abhängigkeiten von Galeria Beata aktualisieren – Dependabot-PRs prüfen, Pakete mit 7 Tagen Abstand einspielen, native Module (sharp mit @img-Binaries, better-sqlite3) ohne Install-Skripte, gebündeltes ExifTool und ffmpeg aktualisieren, neue Electron-Hauptversion übernehmen. Verwenden bei Paket-Updates, npm-audit-Befunden, einem neuen Paket, einem ExifTool-, ffmpeg- oder Electron-Upgrade. (Übernommen aus der Mottulbox und angepasst.)
---

# Abhängigkeiten aktualisieren

Regel (wie Mottulbox, `docs/SICHERHEIT.md`): **nur Versionen, die schon 7 Tage draußen sind.**
Dependabot (`.github/dependabot.yml`, `cooldown` 7 Tage) öffnet montags PRs; gemergt wird vom
Nutzer nach grüner CI.

## Von Hand einspielen

```bash
npm view <paket> time --json          # Veröffentlichungsdaten
npm install <paket>@<version> --before <Datum vor 7 Tagen>
npm audit fix --before <Datum vor 7 Tagen>
npm audit --omit=dev                  # Laufzeit: muss ohne Befund bleiben
```

- Install-Skripte laufen nie (`.npmrc`: `ignore-scripts=true`). Electron-Binary holt
  `scripts/fetch-electron-bin.mjs` (mit Prüfsumme).
- **Neues Paket?** Erst fragen, ob es nötig ist (Schicht F im Skill `bildschutz`). Dann: kein
  Install-Skript, das es zum Laufen braucht; keine Netz-Funktion; Lizenz passt; Größe und
  Unterabhängigkeiten ansehen (`npm ls <paket>`). Laufzeit-Abhängigkeiten in
  `docs/SICHERHEIT.md` mit Grund aufführen. Was nur ins Renderer-Bündel geht (React-Bibliotheken,
  `@tanstack/react-virtual`), ist `devDependency` – Vite baut es ein.

## Native Module

- **sharp:** fertige Binaries kommen als optionale Abhängigkeiten `@img/sharp-<plattform>` (in der
  aktuellen Version 0.35 ohne Install-Skript). Nach einem Update prüfen: `npm ls @img/sharp-win32-x64`, dass die
  Version zu sharp passt, `asarUnpack` greift (`npm run e2e -- paket`) und das Labor (Skill
  `bild-labor`) gleiche Ergebnisse liefert – libvips-Updates ändern gelegentlich Farben oder
  Kantenschärfe von Vorschaubildern (dann Cache-Version erhöhen, Skill `bibliothek-index`).
  Die Lock-Datei muss die Windows-Binaries enthalten, auch wenn unter Linux installiert wurde.
- **better-sqlite3:** N-API-Binaries im Paket (ab 13), kein Rebuild nach Electron-Updates.

## ExifTool

Version und SHA-256 stehen fest in `scripts/download-exiftool.mjs`. Neue Version: Release-Notes
lesen (Änderungen an geschriebenen Tags?), ≥ 7 Tage alt, Hash aus der offiziellen Quelle
eintragen, `npm run exiftool:fetch -- --force`, Labortests und E2E `metadaten`.

## ffmpeg

`scripts/download-ffmpeg.mjs` lädt einen **fest gepinnten** Build von BtbN/FFmpeg-Builds (LGPL,
Windows „shared“, Linux statisch) und prüft ihn gegen die SHA-256 im Skript. Gepinnt wird ein
**Monats-Build** (`autobuild-YYYY-MM-<letzter Tag>-…`): Die täglichen löscht BtbN nach rund zwei
Wochen, die zum Monatsende bleiben. Neuer Pin: Monats-Build ≥ 7 Tage alt, Release-Zweig (`n9.0`
…) statt `master`, Tag/Dateinamen/SHA-256 aus dessen `checksums.sha256` eintragen,
`npm run ffmpeg:fetch -- --force`. Danach Labortests (`npm test`, Testbibliothek mit Videos) und
E2E `galerie` mit Videos. Zu den Anwendern kommt ein neues ffmpeg nur mit einem App-Release (kein
Selbst-Update in der App).

## Neue Electron-Hauptversion

Electron pflegt nur die drei neuesten Hauptversionen (etwa alle 8 Wochen eine neue). Dependabot
schickt sie als eigenen PR. Grüne CI allein reicht nicht: erst die Schritte hier, dann mergen (bei
45 kam ein eigener PR auf Dependabots Commit, mit Doku – Muster für die nächste).

1. **Breaking Changes lesen** für jede übersprungene Version und gegen den Code prüfen (`Grep`):
   `gh api "repos/electron/electron/contents/docs/breaking-changes.md?ref=v<version>" --jq .content | base64 -d`.
   Aus der Mottulbox bekannt: Datei-Dialoge starten ohne Startpfad in „Downloads“
   (→ `services/fileDialogs.ts`), `NativeImage.toBitmap()` rechnet nach sRGB um. Aus 44 → 45: Der
   Preload in der Sandbox hat kein `Buffer`, `setImmediate` und `require('events'|'url'|'timers')`
   mehr – im gebauten Preload (index.js unter out/preload) darf nur `require("electron")` stehen; Bildschirmaufnahme
   fragt als `display-capture` (die Allowlist in `windowPolicy.ts` lehnt sie ab); Datei-Deskriptoren
   aus dem `app.asar` taugen nur noch für `fs`; **`safeStorage` synchron ist veraltet und fällt mit
   46 weg** – `services/cache/schluessel.ts` vorher auf die asynchronen Methoden umstellen.
2. **Sicherheits-Backports vergleichen:** Die gewählte Version darf keine Korrektur verlieren,
   die die alte Patch-Linie schon hat. Release-Notes beider Linien
   (`gh api repos/electron/electron/releases/tags/v<version> --jq .body`) nennen je Release einen
   Backport-PR; dessen Liste (`gh api repos/electron/electron/pulls/<nr> --jq .body`) mit der des
   Gegenstücks der anderen Linie vergleichen. Was nur in der alten Linie steht, ist vielleicht
   schon im neueren Chromium: `Cr-Commit-Position` des Commits
   (`https://chromium.googlesource.com/chromium/src/+/<hash>?format=JSON`, erste 4 Zeichen
   abschneiden) gegen die Abzweig-Position des Meilensteins
   (`https://chromiumdash.appspot.com/fetch_milestones?mstone=<N>`, `chromium_main_branch_position`);
   sonst nach `cherry-pick-<hash>.patch` in `patches/chromium` des Tags suchen. Was übrig bleibt,
   gegen die App bewerten und in `docs/SICHERHEIT.md` festhalten (45.2.1: fünf, alle ohne Bezug).
3. **Native Module, Node und Schlüssel:** better-sqlite3 und sharp nutzen die N-API (kein Rebuild).
   Laden ohne App im Electron-Prozess: `ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe
   <skript>.cjs` (Skript im Scratchpad: `new (require('better-sqlite3'))(':memory:')`, sharp ein
   Bild erzeugen lassen; `process.versions` nennt Node und ABI). `safeStorage` über den Wechsel: mit
   der alten Binary verschlüsseln, mit der neuen entschlüsseln – gleicher `userData`-Ordner
   (`app.setPath`), denn der Schlüssel dafür liegt in dessen `Local State`. Node-Vorgabe:
   `engine-strict` prüft jedes Paket im Baum, die Untergrenze in `engines` ist die höchste aller
   Pakete, nicht die von Electron (45: Electron 22.12, ESLint 22.13).
4. **Prüfen:** `/abschluss-check` inkl. `npm run e2e` und `paket`; besonders `utilityProcess`
   (Bilddienst), Protokolle (`protocol.handle`) und `safeStorage` (Cache-Schlüssel – ein
   Schlüssel, der nach dem Update nicht mehr entschlüsselt, heißt: Cache neu aufbauen, nie
   Daten verlieren). `format:check` meldet Dateien unter `.claude/worktrees/` (Worktrees anderer
   Sitzungen im Ordner) – dann nur die eigenen prüfen:
   `git ls-files -z | xargs -0 npx prettier --check --ignore-unknown`.
5. **Doku:** Version und Node-Vorgabe in `docs/ENTWICKLUNG.md`, Systemvoraussetzungen in
   `docs/INSTALL.md`, „Stand der bekannten Lücken“ in `docs/SICHERHEIT.md`; ändert sich die
   Node-Vorgabe, auch `engines` in `package.json` und `package-lock.json` und der Kommentar zu
   `@types/node` in `.github/dependabot.yml`.
6. **Ausliefern:** Ein Electron-Upgrade (Chromium-Sicherheit) erreicht die Anwender erst mit
   einem neuen Release – nach dem Merge eins vorschlagen und als **wichtig** markieren (Skill
   `windows-paket`, App-Aktualisierung), damit die App darauf hinweist.
