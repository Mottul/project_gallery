---
name: windows-paket
description: Windows-Installer von Galeria Beata bauen und prüfen – NSIS One-Click je Benutzer, alles im Paket (ExifTool, ffmpeg, sharp/libvips, Ortsdaten), keine Downloads beim Start, Deinstallation ohne Reste, Dateizuordnung, portable Variante, Abnahme in der Windows-Sandbox ohne Netz, App-Aktualisierung mit eigener Ed25519-Signatur. Verwenden bei Änderungen an electron-builder.yml, asarUnpack/extraResources, scripts/download-exiftool.mjs, scripts/download-ffmpeg.mjs, services/update/, dem Installer-Workflow oder vor einem Release.
---

# Windows-Paket

Ziel aus `docs/PLAN.md`: **eine Datei, Doppelklick, ohne Administratorrechte, ohne Fragen, ohne
Netz.** Die Konfiguration steht in `electron-builder.yml` (Kommentare dort lesen), Symbole
erzeugt `scripts/icon.mjs` aus `build/icon.svg`. Installer 179 MB (Phase 0), 187 MB (1.3).

## electron-builder.yml – Galeria-Beata-spezifisch

- `nsis`: `oneClick: true`, `perMachine: false` (je Benutzer → keine UAC-Abfrage),
  Startmenü- und Desktop-Verknüpfung, `runAfterFinish: true`.
- `asarUnpack`: `**/node_modules/sharp/**/*` und `**/node_modules/@img/**/*` (so verlangt es
  die sharp-Doku für electron-builder), `**/node_modules/better-sqlite3/**`.
- Nur die Binaries der Zielplattform ins Paket (Muster Mottulbox für better-sqlite3:
  `prebuilds/**` ausschließen, `${platform}-${arch}` einschließen; für `@img/sharp-*` prüfen,
  dass nur `win32-x64` mitkommt). **Einschließende Muster nie mit `**/` beginnen:** das holte in
  1.1/1.2 Binaries alter Builds aus `dist/<name>/` ins Paket; dazu `!dist{,/**}` (electron-builder
  schließt nur den eigenen Ausgabeordner aus).
- `productName: Galeria Beata`, `artifactName: Galeria-Beata-${version}-setup.${ext}` (ohne
  Leerzeichen im Dateinamen).
- `extraResources`: `resources/exiftool/win` → `exiftool`, `resources/ffmpeg/win` → `ffmpeg`,
  Ortsdaten `resources/geo` → `geo` (seit 2.2; liegen im Repository, nicht per Download); Pfade zur Laufzeit über `process.resourcesPath` (gepackt) bzw. `resources/`
  (Entwicklung) – je Programm nur an einer Stelle (`exiftool/binPath.ts`, `ffmpeg/ffmpegPath.ts`).
- `win.signExecutable: false` – der Installer bleibt bewusst unsigniert (entschieden 25.10.2026),
  aber Symbol und Versionsangaben kommen in die exe (seit electron-builder 26.17; die Mottulbox
  braucht noch `signAndEditExecutable: false` und verliert dadurch beides). electron-builder ist
  gepinnt (`npx --yes electron-builder@<version>` in `package.json` und den Workflows – alle
  Stellen zusammen ändern, 7 Tage Abstand).
- **Deinstallation:** Index und Cache (`%LOCALAPPDATA%\<App>`) enthalten Vorschaubilder privater
  Fotos und müssen weg. `deleteAppDataOnUninstall` greift nur bei One-Click und nur für den
  Benutzerdaten-Ordner – für den Cache-Ordner ein `include`-Skript (`build/installer.nsh`,
  Makro `customUnInstall`) prüfen. Sicherungen (`%LOCALAPPDATA%\Galeria Beata Sicherungen`, bewusst
  neben dem Datenordner) **nicht** still löschen – Doku
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
- Die Windows-Ausgabe besteht aus `exiftool(-k).exe` und dem Ordner `exiftool_files` (Perl-
  Laufzeit) – das Skript legt sie als `exiftool.exe` (ohne Tastendruck-Pause) samt Ordner ab;
  `extraResources` nimmt den ganzen Ordner `resources/exiftool/win` mit (35 MB).
- **ffmpeg:** `scripts/download-ffmpeg.mjs`, fest gepinnt (Skill `abhaengigkeiten`). Windows als
  LGPL-„shared“-Build: `ffmpeg.exe`, `ffprobe.exe` und ihre DLLs (`avcodec-*.dll` …) gehören
  zusammen in einen Ordner – 150 MB statt 257 MB bei zwei statischen exe. Kein Selbst-Update
  von ffmpeg in der App: Es kommt mit der App-Aktualisierung.
- Lizenztexte (ExifTool, ffmpeg LGPL, libvips LGPL, sharp Apache-2.0, GeoNames CC BY 4.0) in
  „Über“ und als Datei im Paket.

## Prüfen

1. `npm run package:dir` und `npm run e2e:run -- paket`: gepackte App startet aus `app.asar`,
   sharp lädt aus `app.asar.unpacked`, ExifTool aus `resources/exiftool`, ein Vorschaubild
   entsteht (seit 1.3 im Bilddienst: ExifTool liest, sharp erzeugt, BMP über ffmpeg), ein
   Metadaten-Schreiben gelingt. **Gegenprobe:** ohne `asarUnpack` für `@img` wird der
   sharp-Schritt rot (Phase 0) – aber nur an der Ordnerprüfung: electron-builder packt native
   Teile per `smartUnpack` ohnehin aus, sharp rechnet weiter (gemessen 1.3; `smartUnpack` lässt
   sich in 26.17 nicht abschalten). Echte Gegenprobe: in einer Kopie des Pakets
   `app.asar.unpacked/node_modules/@img` löschen – dann wird auch der Bilddienst-Schritt rot. Scheitert das Paketieren mit „Device or
   resource busy“, hält ein anderes Electron-Programm `app.asar` offen (`docs/ENTWICKLUNG.md`,
   „Paket und Abnahme“).
2. Größe des Installers notieren (Plan: Phase 0) – Sprünge erklären können.
3. **Windows-Sandbox ohne Netz** (Windows Pro/Enterprise): `npm run abnahme:sandbox`
   (`scripts/sandbox-abnahme.mjs` schreibt die `.wsb` mit `<Networking>Disable</Networking>`,
   Installer nur lesend; `scripts/sandbox/abnahme.ps1` prüft automatisch und schreibt
   `dist/abnahme/ergebnis/abnahme.txt`). Neue Prüfschritte dort ergänzen, sobald die Funktion da
   ist. **Seit 1.6 mit Testbildern:** `sandbox-abnahme.mjs` erzeugt sie auf dem Rechner und bindet
   sie, das Projekt (`C:\Repo`, für playwright-core) und den Ordner des laufenden Node
   (`C:\Node`) nur lesend ein; `scripts/sandbox/galerie.mjs` steuert darin die **installierte**
   App über Playwright mit den echten Datenordnern (Ordner hinzufügen mit ersetztem Dialog,
   Vorschaubilder, Sortieren, Betrachter, Überwachen, Prüfsummen der Testbilder vorher/nachher);
   `abnahme.ps1` prüft danach den verschlüsselten Cache und nach der Deinstallation, dass er weg
   ist. Ablauf: installieren (keine UAC-Abfrage, keine Fragen) → starten → Testbilder-Ordner
   hinzufügen → ansehen, sortieren → Metadaten schreiben → Export ohne Standort →
   deinstallieren → `%LOCALAPPDATA%` und `%APPDATA%` ohne Reste (außer Sicherungen laut Doku).
   SmartScreen-Meldung dabei mit Bild für `docs/INSTALL.md` festhalten.
4. Aktualisieren: alte Version installieren, Bibliothek anlegen, neue Version darüber
   installieren → Bibliothek, Einstellungen, Journal bleiben, Migration läuft.
5. Für alle Läufe auf GitHub: *Actions → Installer bauen → Run workflow*; bei Änderungen an
   `electron-builder.yml` läuft er im Pull Request mit.

## Release

Version in `package.json` erhöhen, Tag `v<version>` – der Installer-Workflow prüft, dass Tag
und Version passen, baut und hängt den Installer an das GitHub Release (Entwurf). Dann lokal
signieren und das Release veröffentlichen (unten). Release-Notes nennen, ob das Update
**wichtig** ist und welche Komponenten es betrifft (Electron/Chromium, ExifTool, sharp/libvips,
ffmpeg – mit Versionen).

## App-Aktualisierung (ab Phase 5)

Ablauf und Gründe: `docs/PLAN.md`, „App-Aktualisierung“. Regeln für Code und Release:

- **Nur `services/update/` hat Netz** (Skill `bildschutz`, Schicht A). Reine Logik (Release-Liste
  prüfen, Version vergleichen, „wichtig“ erkennen) in `shared/updatePlan.ts` mit Tests.
- **Release-Beschreibung** `update.json` je Release: Version, Datum, `wichtig`, betroffene
  Komponenten, Dateiname und SHA-256 des Installers; daneben `update.json.sig` (Ed25519).
  Die App prüft die Signatur mit dem **fest eingebauten öffentlichen Schlüssel** (Node `crypto`,
  `crypto.verify(null, daten, schlüssel, signatur)`), dann den SHA-256 des geladenen Installers.
  Unbekannte Felder ignorieren, fehlende oder ungültige = Release verwerfen.
- **Signieren lokal:** `npm run release:sign` liest den privaten Schlüssel aus einer Datei
  außerhalb des Repos (Pfad per Umgebungsvariable), lädt den Installer aus dem Release-Entwurf,
  rechnet SHA-256, schreibt `update.json` + `.sig` und hängt beides an. Der private Schlüssel
  kommt nie ins Repo, nie in die CI, nie in ein Log; eine Sicherungskopie liegt offline.
- **Nie automatisch installieren:** laden und starten nur nach Klick; laufende Aufträge vorher
  abwarten oder nachfragen (Rückfrage „Wirklich beenden?“ wie in der Mottulbox).
- **Herabstufen verhindern:** nur Versionen größer als die laufende annehmen.
- **Prüfen:** E2E `update` gegen einen lokalen Schein-Release-Server (Adresse per
  Umgebungsvariable nur im Test, Muster `e2e/ffmpeg-update.mjs` der Mottulbox): gültiges Update,
  falsche Signatur, manipulierter Installer, ältere Version, kein Netz, Zustimmung „Nein“ =
  keine Anfrage. In der Windows-Sandbox (dieses eine Mal mit Netz) von der Vorversion
  aktualisieren; notieren, ob SmartScreen beim selbst geladenen Installer erscheint.
