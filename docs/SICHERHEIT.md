# Sicherheit

Galeria Beata hat private Fotos und Videos vor sich. Das Schutzkonzept steht in
[PLAN.md, „Schutzkonzept für Bilddaten“](PLAN.md#schutzkonzept-für-bilddaten) (Schichten A–F),
die Prüfliste für jede Änderung im Skill `bildschutz`. Hier steht, was davon **umgesetzt** ist
und wie es nachgewiesen wird.

## Stand (Phase 1.2)

| Schicht | Umgesetzt | Nachweis |
|---|---|---|
| **A – Nichts verlässt den Rechner** | Netzsperre auf der Standard-Sitzung (`src/main/services/netzsperre.ts`, Regel in `netzRegel.ts`); ESLint sperrt Netz-Module und `fetch`/`WebSocket` im main (Ausnahme nur `services/update/`, gibt es noch nicht); CSP `connect-src 'self'`; keine Rechtschreibprüfung (lädt außerhalb von Windows Wörterbücher); Wächter geben Navigationen und `window.open` nicht an den Browser weiter | `netzRegel.test.ts`; E2E `netz` (Spion-Server bekommt nichts aus Fenster, `net.fetch` und vom main geöffneten Fenstern; Gegenprobe mit einer Sitzung ohne Sperre) |
| **B – Originale unantastbar** | Phase 1 liest nur: Der Scan im Bilddienst listet Verzeichnisse und liest Größe/Zeiten (`lstat`); Symlinks/Junctions werden nicht verfolgt. ExifTool (gebündelt, nie aus dem `PATH`) läuft im Bilddienst und bekommt nur Lesebefehle mit fester Tag-Liste (`grundfelder.ts`); Pfade gehen als absolute Pfade über stdin (UTF-8), Argumente mit Zeilenumbruch werden abgelehnt. Nichts wird in Bibliotheksordner geschrieben; „Ordner entfernen“ löscht nur Index-Zeilen, nach Rückfrage | E2E `originale` (Prüfsumme und Änderungszeit jeder Testdatei vorher/nachher, keine Datei dazu oder weg – nachdem ExifTool jede gelesen hat), `galerie` (Dateien nach dem Entfernen noch da); `exiftool.lab.test.ts` |
| **C – Renderer ohne Dateizugriff** | Sandbox, contextIsolation, kein Node, keine Webviews (`secureWebPreferences`); keine Navigation, keine neuen Fenster, Berechtigungen nur Vollbild und Zwischenablage (`windowGuards.ts`, `windowPolicy.ts`); Netzsperre lässt `file:` nur im Ordner der App-Seite zu; IPC-Handler prüfen den Absender (`ipc/handle.ts`) und die Eingaben (`settingsCheck.ts`, `eingaben.ts`); Bibliotheksordner kommen nur aus dem Ordner-Dialog des main, der Renderer schickt Kennungen statt Pfaden und bekommt Bild-Details ohne Pfad (höchstens 1000 je Anfrage); ins SQL der Sortierung kommen nur Spalten aus der Allowlist (`sortFilter.ts`); gemerkte Dialog-Ordner setzt nur main; CSP im Build ohne Inline-Skripte und ohne `eval` | `windowPolicy.test.ts`, `settingsCheck.test.ts`, `eingaben.test.ts`, `sortFilter.test.ts`; E2E `security`, `galerie`, `sortieren` (ungültige Anfragen abgelehnt) |
| **D – Abgeleitete Daten geschützt** | Log ohne Inhalte: abgewiesene Adressen nur mit Protokoll und Rechner (`kurzeAdresse`), Bibliothek nur mit Ordner-Kennungen und Anzahlen, nie Metadaten-Werte (ExifTool-Ausgaben gehen nicht ins Log); Metadaten aus fremden Dateien werden vor dem Eintragen geprüft (Typ, Grenzen, Steuerzeichen; `grundfelder.ts`); Index unter `%LOCALAPPDATA%\Galeria Beata\index` (nicht Roaming, nicht OneDrive; `lokaleDaten.ts`); Ordner entfernen löscht seine Zeilen sofort (Fremdschlüssel mit `ON DELETE CASCADE`); die Deinstallation entfernt den lokalen Datenordner, ein Update nicht (`build/installer.nsh`) | E2E `netz`, `galerie` (Index im lokalen Ordner, nach Entfernen 0 Zeilen); `db.test.ts`; Sandbox-Abnahme (Index angelegt, nach Deinstallation weg) |
| **E – Weitergeben ohne Spuren** | noch kein Export | – |
| **F – Lieferkette und Programm** | siehe unten; Fehlergrenze im Renderer, defekte `settings.json` wird weggesichert, nur eine Instanz je Benutzer | CI `npm audit --omit=dev` |

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
