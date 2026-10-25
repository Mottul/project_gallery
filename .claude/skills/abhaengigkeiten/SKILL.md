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

`scripts/download-ffmpeg.mjs` (aus der Mottulbox) lädt den neuesten Build, der **mindestens 7 Tage
alt** ist, und prüft ihn gegen die `checksums.sha256` des Releases. Nach einem Wechsel: Labortest
der Video-Standbilder (Bildzahl, Farben) und E2E `galerie` mit Videos. Zu den Anwendern kommt
ein neues ffmpeg nur mit einem App-Release (kein Selbst-Update in der App).

## Neue Electron-Hauptversion

Electron pflegt nur die drei neuesten Hauptversionen (etwa alle 8 Wochen eine neue).

1. **Breaking Changes lesen** für jede übersprungene Version und gegen den Code prüfen (`Grep`).
   Aus der Mottulbox bekannt: Datei-Dialoge starten ohne Startpfad in „Downloads“
   (→ `services/fileDialogs.ts`), `NativeImage.toBitmap()` rechnet nach sRGB um.
2. **Sicherheits-Backports vergleichen:** Die gewählte Version darf keine Korrektur verlieren,
   die die alte Patch-Linie schon hat.
3. **Prüfen:** `/abschluss-check` inkl. `npm run e2e` und `paket`; besonders `utilityProcess`
   (Bilddienst), Protokolle (`protocol.handle`) und `safeStorage` (Cache-Schlüssel – ein
   Schlüssel, der nach dem Update nicht mehr entschlüsselt, heißt: Cache neu aufbauen, nie
   Daten verlieren).
4. **Doku:** Version in `docs/ENTWICKLUNG.md`, Systemvoraussetzungen in `docs/INSTALL.md`.
5. **Ausliefern:** Ein Electron-Upgrade (Chromium-Sicherheit) erreicht die Anwender erst mit
   einem neuen Release – nach dem Merge eins vorschlagen und als **wichtig** markieren (Skill
   `windows-paket`, App-Aktualisierung), damit die App darauf hinweist.
