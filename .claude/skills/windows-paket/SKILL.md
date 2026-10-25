---
name: windows-paket
description: Windows-Installer der Galerie bauen und prüfen – NSIS One-Click je Benutzer, alles im Paket (ExifTool, sharp/libvips, Ortsdaten), keine Downloads beim Start, Deinstallation ohne Reste, Dateizuordnung, portable Variante, Abnahme in der Windows-Sandbox ohne Netz. Verwenden bei Änderungen an electron-builder.yml, asarUnpack/extraResources, scripts/download-exiftool.mjs, dem Installer-Workflow oder vor einem Release.
---

# Windows-Paket

Ziel aus `docs/PLAN.md`: **eine Datei, Doppelklick, ohne Administratorrechte, ohne Fragen, ohne
Netz.** Vorbild ist `electron-builder.yml` der Mottulbox (Kommentare dort lesen – sie erklären
`signAndEditExecutable: false`, Icons, `asarUnpack`).

## electron-builder.yml – Galerie-spezifisch

- `nsis`: `oneClick: true`, `perMachine: false` (je Benutzer → keine UAC-Abfrage),
  Startmenü- und Desktop-Verknüpfung, `runAfterFinish: true`.
- `asarUnpack`: `**/node_modules/sharp/**/*` und `**/node_modules/@img/**/*` (so verlangt es
  die sharp-Doku für electron-builder), `**/node_modules/better-sqlite3/**`.
- Nur die Binaries der Zielplattform ins Paket (Muster Mottulbox für better-sqlite3:
  `prebuilds/**` ausschließen, `${platform}-${arch}` einschließen; für `@img/sharp-*` prüfen,
  dass nur `win32-x64` mitkommt).
- `extraResources`: `resources/exiftool/win` → `exiftool`, Ortsdaten → `geo`; Pfade zur Laufzeit
  über `process.resourcesPath` (gepackt) bzw. `resources/` (Entwicklung) – nur an einer Stelle
  (`exiftool/binPath.ts`).
- `win.signAndEditExecutable: false` – der Installer bleibt bewusst unsigniert (entschieden 25.10.2026; Grund für die Einstellung in der Mottulbox).
- **Deinstallation:** Index und Cache (`%LOCALAPPDATA%\<App>`) enthalten Vorschaubilder privater
  Fotos und müssen weg. `deleteAppDataOnUninstall` greift nur bei One-Click und nur für den
  Benutzerdaten-Ordner – für den Cache-Ordner ein `include`-Skript (`build/installer.nsh`,
  Makro `customUnInstall`) prüfen. Sicherungen (`Sicherungen/`) **nicht** still löschen – Doku
  bzw. Rückfrage in der App („Alle Daten entfernen“ vor dem Deinstallieren).
- **Dateizuordnung** (Phase 7): `fileAssociations` für `jpg`, `jpeg`, `png`, `webp`, `gif`,
  `avif`, `tif`, `tiff` mit Rolle `Viewer`; prüfen, dass ein Installer je Benutzer sie unter
  HKCU einträgt und die Deinstallation sie entfernt. Die App bekommt den Pfad als Argument und
  zeigt die Datei, ohne den Ordner in die Bibliothek aufzunehmen (Rückfrage „Ordner aufnehmen?“).
- **Portable** (Phase 7): Ziel `portable`; Daten wahlweise neben der exe
  (`PORTABLE_EXECUTABLE_DIR`), dann gilt Schicht D (Verschlüsselung) erst recht – der Stick kann
  verloren gehen.

## ExifTool bündeln

- `scripts/download-exiftool.mjs` (Muster `download-ffmpeg.mjs` der Mottulbox): Version **und
  SHA-256 fest im Skript** (wie ein Lockfile); Download nur von der offiziellen Quelle
  (exiftool.org), Prüfsumme vor dem Auspacken, Ablage `resources/exiftool/win/` (nicht im Git,
  `.gitignore`). Neue Version = Skript ändern (Version, Hash), mit 7 Tagen Abstand wie npm.
- Die Windows-Ausgabe besteht aus einer exe und einem Ordner mit Perl-Laufzeit – beide
  mitnehmen; den Namen der exe so ablegen, dass sie ohne Tastendruck-Pause startet (Aufbau des
  Archivs beim Einrichten prüfen und im Skript kommentieren).
- Lizenztexte (ExifTool, libvips LGPL, sharp Apache-2.0, GeoNames CC BY 4.0) in „Über“ und
  als Datei im Paket.

## Prüfen

1. `npm run package:dir` und `npm run e2e -- paket`: gepackte App startet aus `app.asar`,
   sharp lädt aus `app.asar.unpacked`, ExifTool aus `resources/exiftool`, ein Vorschaubild
   entsteht, ein Metadaten-Schreiben gelingt. **Gegenprobe:** ohne `asarUnpack` für `@img`
   muss der Schritt rot werden.
2. Größe des Installers notieren (Plan: Phase 0) – Sprünge erklären können.
3. **Windows-Sandbox ohne Netz** (Windows Pro/Enterprise): `.wsb`-Datei mit
   `<Networking>Disable</Networking>` und dem Installer als gemapptem Ordner (nur lesen).
   Ablauf: installieren (keine UAC-Abfrage, keine Fragen) → starten → Testbilder-Ordner
   hinzufügen → ansehen, sortieren → Metadaten schreiben → Export ohne Standort →
   deinstallieren → `%LOCALAPPDATA%` und `%APPDATA%` ohne Reste (außer Sicherungen laut Doku).
   SmartScreen-Meldung dabei mit Bild für `docs/INSTALL.md` festhalten.
4. Aktualisieren: alte Version installieren, Bibliothek anlegen, neue Version darüber
   installieren → Bibliothek, Einstellungen, Journal bleiben, Migration läuft.
5. Für alle Läufe auf GitHub: *Actions → Installer bauen → Run workflow*; bei Änderungen an
   `electron-builder.yml` läuft er im Pull Request mit.

## Release

Version in `package.json` erhöhen, Tag `v<version>` – der Installer-Workflow prüft, dass Tag
und Version passen, baut und hängt den Installer an das GitHub Release. Ohne Auto-Update
(offline): In den Release-Notes steht, dass man den neuen Installer einfach darüber installiert.
