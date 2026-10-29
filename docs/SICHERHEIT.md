# Sicherheit

Galeria Beata hat private Fotos und Videos vor sich. Das Schutzkonzept steht in
[PLAN.md, „Schutzkonzept für Bilddaten“](PLAN.md#schutzkonzept-für-bilddaten) (Schichten A–F),
die Prüfliste für jede Änderung im Skill `bildschutz`. Hier steht, was davon **umgesetzt** ist
und wie es nachgewiesen wird.

## Stand (Phase 1.5)

| Schicht | Umgesetzt | Nachweis |
|---|---|---|
| **A – Nichts verlässt den Rechner** | Netzsperre auf der Standard-Sitzung (`src/main/services/netzsperre.ts`, Regel in `netzRegel.ts`); ESLint sperrt Netz-Module und `fetch`/`WebSocket` im main (Ausnahme nur `services/update/`, gibt es noch nicht); CSP `connect-src 'self'`; keine Rechtschreibprüfung (lädt außerhalb von Windows Wörterbücher); Wächter geben Navigationen und `window.open` nicht an den Browser weiter; ffmpeg (BMP für Vorschaubilder) nur mit `-protocol_whitelist file` und `file:`-Pfad; `thumb:` und `bild:` in Netzsperre und CSP (`img-src`) eingetragen, angemeldet an einer Stelle (`protocols/schemata.ts`) | `netzRegel.test.ts`; E2E `netz` (Spion-Server bekommt nichts aus Fenster, `net.fetch` und vom main geöffneten Fenstern; Gegenprobe mit einer Sitzung ohne Sperre); `vorschau.lab.test.ts` (eine „BMP“-Playlist auf einen Spion-Server löst keine Anfrage aus) |
| **B – Originale unantastbar** | Phase 1 liest nur: Der Scan im Bilddienst listet Verzeichnisse und liest Größe/Zeiten (`lstat`); Symlinks/Junctions werden nicht verfolgt. ExifTool (gebündelt, nie aus dem `PATH`) läuft im Bilddienst und bekommt nur Lesebefehle mit fester Tag-Liste (`grundfelder.ts`); Pfade gehen als absolute Pfade über stdin (UTF-8), Argumente mit Zeilenumbruch werden abgelehnt. Nichts wird in Bibliotheksordner geschrieben; „Ordner entfernen“ löscht nur Index-Zeilen, nach Rückfrage. Vorschaubilder: Der Bilddienst liest die Datei nur (in den Speicher; sharp hält so keine Datei offen), Ergebnisse gehen in den eigenen Cache, nie in den Bibliotheksordner. `bild://` öffnet Originale nur lesend (Stream bzw. Umrechnung im Bilddienst aus dem Speicher). **Papierkorb** (seit 1.5): nur auf Befehl (Entf, Knopf) und nach Rückfrage im main, die die Namen nennt (Vorgabe „Abbrechen“); nie in Ordnern „nur lesen“ – auch nicht, wenn ein Ordner während der offenen Rückfrage dahin wechselt (nach der Rückfrage frischer Stand aus dem Index); je Datei vorher dieselbe Prüfung wie bei `bild://` (mit Zeitlimit), dann nur `shell.trashItem`; Index-Zeile und Vorschaubilder erst nach Erfolg weg; geht der Papierkorb nicht (Netzlaufwerk), bleibt alles – endgültiges Löschen gibt es noch nicht. **Überwachen** (seit 1.6): `fs.watch` im Bilddienst öffnet nur den Ordner (lesend, gibt Löschen und Umbenennen frei); der Teil-Abgleich liest wie der Scan nur Verzeichnisse, Größe und Zeiten und folgt keiner Verknüpfung, auch nicht auf dem Weg zu einem gemeldeten Pfad; Netzlaufwerke werden nicht beobachtet | E2E `originale` (Prüfsumme und Änderungszeit jeder Testdatei vorher/nachher, keine Datei dazu oder weg – nachdem ExifTool jede gelesen hat), `galerie` (Dateien nach dem Entfernen noch da); `exiftool.lab.test.ts`; E2E `originale` nach dem Erzeugen aller Vorschaubilder und nachdem jedes Bild einmal über `bild://` gelesen wurde; `library.test.ts` (Papierkorb: Abbrechen, „nur lesen“, Wechsel während der Rückfrage – Gegenprobe ohne frischen Stand rot –, Papierkorb scheitert); E2E `galerie` (Papierkorb mit ersetztem `shell.trashItem`: „nur lesen“ verweigert, sonst Datei, Index-Zeile und Vorschaubilder weg); `scan.test.ts` (Teil-Scan: Junction als Ziel und auf dem Weg), E2E `ueberwachen`, Sandbox-Abnahme (Prüfsummen der Testbilder vor/nach dem Lauf mit der installierten App) |
| **C – Renderer ohne Dateizugriff** | Sandbox, contextIsolation, kein Node, keine Webviews (`secureWebPreferences`); keine Navigation, keine neuen Fenster, Berechtigungen nur Vollbild und Zwischenablage (`windowGuards.ts`, `windowPolicy.ts`); Netzsperre lässt `file:` nur im Ordner der App-Seite zu; IPC-Handler prüfen den Absender (`ipc/handle.ts`) und die Eingaben (`settingsCheck.ts`, `eingaben.ts`); Bibliotheksordner kommen aus dem Ordner-Dialog des main oder per Drag & Drop – dann liest der Preload den Pfad aus dem gezogenen Datei-Objekt (`webUtils.getPathForFile`; ein in der Seite erzeugtes File hat keinen Pfad und fällt weg), der main prüft ihn wie beim Dialog (absolut, erreichbarer Ordner, keine Überlappung); der Renderer schickt sonst Kennungen statt Pfaden und bekommt Bild-Details ohne Pfad (höchstens 1000 je Anfrage); Ordner-Filter (Unterordner ohne `..`, Steuerzeichen, Rückstriche), Ausschnitt (≤ 1000) und Summe (≤ 200.000 Kennungen) werden geprüft; ins SQL der Sortierung kommen nur Spalten aus der Allowlist (`sortFilter.ts`); gemerkte Dialog-Ordner setzt nur main; CSP im Build ohne Inline-Skripte und ohne `eval`; Bilder nur über `thumb://id/<kennung>/<stufe>` (Adresse streng geprüft, Kennung im Index nachgeschlagen, nur GET, nur aus dem Cache) und `bild://id/<kennung>` (ebenso streng; Original gestreamt mit geprüftem `Range`, Typ nach Inhalt statt Endung, `nosniff`; TIFF als Umrechnung aus dem Bilddienst); vor dem Lesen prüfen Bilddienst und `bild://` (gemeinsam `dateien/pruefeDatei.ts`, mit Zeitlimit), dass die Datei zum Index passt (Größe, Änderungszeit, keine Verknüpfung) und ihr echter Pfad im Bibliotheksordner liegt (Junctions/Symlinks nach außen abgelehnt) – geändert = 409, außerhalb = 403 | `windowPolicy.test.ts`, `settingsCheck.test.ts`, `eingaben.test.ts`, `sortFilter.test.ts`; E2E `security`, `galerie` (echter Ordner-Drop; ein untergeschobenes File, dessen Name ein echter Ordner ist, wird nicht aufgenommen – Gegenprobe: mit dem Namen als Pfad würde er es), `sortieren` (ungültige Anfragen abgelehnt), `vorschau.test.ts` (Adressen, `..`, `%2e%2e`), `vorschau.lab.test.ts` (Junction nach außen, geänderte Datei); E2E `security` (`thumb://`: erfundene Kennung, falsche Stufe, Ziffern als Rechnername, POST); `bild.test.ts` (Adressen, `Range`), `anzeige.test.ts` (fehlt, geändert, Junction nach außen – Gegenproben ohne Größen- bzw. `realpath`-Prüfung rot); E2E `security` (`bild://` wie `thumb://`), `galerie` (byte-gleich, Range, geänderte Datei 409 und Hinweis im Betrachter) |
| **D – Abgeleitete Daten geschützt** | Log ohne Inhalte: abgewiesene Adressen nur mit Protokoll und Rechner (`kurzeAdresse`), Bibliothek nur mit Ordner-Kennungen und Anzahlen, nie Metadaten-Werte (ExifTool-Ausgaben gehen nicht ins Log); Metadaten aus fremden Dateien werden vor dem Eintragen geprüft (Typ, Grenzen, Steuerzeichen; `grundfelder.ts`); Index unter `%LOCALAPPDATA%\Galeria Beata\index` (nicht Roaming, nicht OneDrive; `lokaleDaten.ts`); Ordner entfernen löscht seine Zeilen sofort (Fremdschlüssel mit `ON DELETE CASCADE`); die Deinstallation entfernt den lokalen Datenordner, ein Update nicht (`build/installer.nsh`); Vorschaubilder nur AES-256-GCM-verschlüsselt im lokalen Datenordner (zufälliger Nonce, Zusatzdaten binden an Bild, Stufe, Größe, Änderungszeit und Verfahren – manipuliert oder veraltet = gelöscht und neu erzeugt), Schlüssel per `safeStorage` (DPAPI; ohne sicheren Speicher nur für die Sitzung), an den Bilddienst nur als Nachricht; Ordner „privat“: Vorschau nur im Arbeitsspeicher, beim Wechsel nach „privat“ werden die Cache-Dateien sofort gelöscht; „Ordner entfernen“ löscht sie mit; `thumb://` und `bild://` antworten mit `no-store`; Umrechnungen für den Betrachter (TIFF) liegen nur im Arbeitsspeicher (höchstens 64 MB), Papierkorb und „Ordner entfernen“ werfen sie mit weg; das Log nennt bei `bild://` nur Kennung und Fehlercode, beim Überwachen nur Ordner-Kennung, Anzahl und Code; wird eine Datei als verschoben erkannt, fällt die doppelte Zeile samt Vorschaubildern weg. Offen: Wie lange eine von außen gelöschte Datei als „fehlt“ samt verschlüsseltem Vorschaubild bleibt (Plan, „Noch offen“) | E2E `netz`, `galerie` (Index im lokalen Ordner, nach Entfernen 0 Zeilen); `db.test.ts`; Sandbox-Abnahme (Index angelegt, nach Deinstallation weg); `verschluesselung.test.ts` (falscher Schlüssel, gekipptes Byte, vertauschte Zusatzdaten), `library.test.ts` („privat“, Entfernen); E2E `galerie` (keine JPEG-/WebP-Signatur im Cache, „privat“ ohne Platte, Neustart ohne Neuerzeugen, nach dem Entfernen leer, Log ohne Koordinaten/Titel/Dateinamen) |
| **E – Weitergeben ohne Spuren** | noch kein Export | – |
| **F – Lieferkette und Programm** | siehe unten; Fehlergrenze im Renderer, defekte `settings.json` wird weggesichert, nur eine Instanz je Benutzer; Bildverarbeitung nur im Bilddienst (auch die Umrechnung für den Betrachter, höchstens 3840 px), Zeitlimit je Datei (30 s), `limitInputPixels` gesetzt, zweiter Absturz an derselben Datei = defekt | CI `npm audit --omit=dev` |

Gefunden beim Übernehmen aus der Mottulbox: Deren `isAppPage` wirft bei kaputter %-Kodierung
(`file:///C:/x%E0.html`), der Wächter verhindert die Navigation dann nicht. Hier behoben
(`filePathKey` in `windowPolicy.ts`), mit Unit-Test und E2E-Schritt; die Gegenprobe mit dem alten
Verhalten macht den E2E-Schritt rot.

## Lieferkette

- **`package-lock.json` ist eingecheckt** (sha512-Integrity je Paket). Die Versionen stammen aus
  dem Lockfile der Mottulbox (dort schon geprüft), Abweichungen unten.
- **Laufzeit-Abhängigkeiten** (alles andere ist Werkzeug oder wird von Vite in den Renderer gebaut):

  | Paket | Version | Grund |
  |---|---|---|
  | `sharp` | 0.35.5 (27.09.2026) | Bilder dekodieren, Vorschaubilder, Export (libvips, Plan „Entscheidungen“); kein Install-Skript, fertige Binaries als `@img/sharp-<plattform>`; Lizenz Apache-2.0, libvips LGPL-3.0 |
  | `better-sqlite3` | 13.0.3 (05.08.2026) | Index (SQLite mit FTS5, Plan „Entscheidungen“); N-API-Binaries im Paket (`prebuilds/`), kein Install-Skript, kein node-gyp; Lizenz MIT |

  Beide liegen im Paket entpackt neben dem `app.asar` (`asarUnpack`), geprüft per E2E `paket`.
  Ins Renderer-Bündel kommt seit 1.4 `@tanstack/react-virtual` 3.14.21 (16.10.2026, mit 7 Tagen
  Abstand; Raster und Liste virtualisiert, Plan „Entscheidungen“; Lizenz MIT, kein Install-Skript,
  eine Unterabhängigkeit `@tanstack/virtual-core`).
- **electron-builder** ist keine Abhängigkeit, sondern kommt beim Paketieren gepinnt per `npx`
  (`electron-builder@26.17.0`, 26.09.2026) – seine Werkzeugkette bleibt aus `npm ci` heraus
  (Muster Mottulbox).
- **Gebündelte Programme fest gepinnt:** ExifTool und ffmpeg mit Version und SHA-256 im
  Download-Skript (`scripts/download-exiftool.mjs`, `scripts/download-ffmpeg.mjs`); geprüft wird
  vor dem Auspacken, eine veränderte Quelle kann so nichts unterschieben. Die Pins sind älter als
  7 Tage.
- **`.npmrc`:** `ignore-scripts=true` (keine Install-Skripte), `save-exact=true`,
  `engine-strict=true`.
- **7 Tage Abstand** für jede neue Version (Skill `abhaengigkeiten`, Dependabot mit `cooldown`).
- **Electron-Binary** per `scripts/fetch-electron-bin.mjs` aus dem GitHub-Release, geprüft gegen
  `electron/checksums.json` aus dem npm-Paket.

### Stand der bekannten Lücken (25. Oktober 2026)

`npm audit --omit=dev`: keine. `npm audit` (mit Entwicklungswerkzeugen):

| Paket | Meldung | Bewertung |
|---|---|---|
| `electron` 44.8.0 | GHSA-jr5w-w6x2-84p9: Zertifikate einer kompromittierten Zwischenstelle (eMudhra) noch vertrauenswürdig, behoben in 44.9.1 | betrifft nur TLS-Verbindungen, die die App nicht aufbaut; 44.9.x ist erst ab 28.10.2026 sieben Tage alt – dann per Dependabot. Bis zum ersten Release (Phase 5) erledigt. |
| `tailwindcss` 3 (über `postcss-selector-parser`) | GHSA-rj75-hqrm-r3gf: quadratischer Aufwand beim Parsen von Selektoren | nur beim Bauen, nur mit eigenem CSS; in Tailwind 3 gibt es keine Korrektur – erledigt sich mit dem Umstieg auf Tailwind 4 (gemeinsam mit der Mottulbox) |

Beim Einrichten mit `--before` eingespielt: `electron` 44.7.0 → 44.8.0, `vitest` 4.1.11 → 4.1.12
(behebt GHSA-qxg6-89mg-rqv8 und GHSA-xp26-3454-mjgp), `undici` und `zod` (transitiv) per
`npm audit fix --before 2026-10-18`.
