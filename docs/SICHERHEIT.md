# Sicherheit

Galeria Beata hat private Fotos und Videos vor sich. Das Schutzkonzept steht in
[PLAN.md, „Schutzkonzept für Bilddaten“](PLAN.md#schutzkonzept-für-bilddaten) (Schichten A–F),
die Prüfliste für jede Änderung im Skill `bildschutz`. Hier steht, was davon **umgesetzt** ist
und wie es nachgewiesen wird.

## Stand (Phase 0)

| Schicht | Umgesetzt | Nachweis |
|---|---|---|
| **A – Nichts verlässt den Rechner** | Netzsperre auf der Standard-Sitzung (`src/main/services/netzsperre.ts`, Regel in `netzRegel.ts`); ESLint sperrt Netz-Module und `fetch`/`WebSocket` im main (Ausnahme nur `services/update/`, gibt es noch nicht); CSP `connect-src 'self'`; keine Rechtschreibprüfung (lädt außerhalb von Windows Wörterbücher); Wächter geben Navigationen und `window.open` nicht an den Browser weiter | `netzRegel.test.ts`; E2E `netz` (Spion-Server bekommt nichts aus Fenster, `net.fetch` und vom main geöffneten Fenstern; Gegenprobe mit einer Sitzung ohne Sperre) |
| **B – Originale unantastbar** | noch keine Dateizugriffe auf Bilder | – |
| **C – Renderer ohne Dateizugriff** | Sandbox, contextIsolation, kein Node, keine Webviews (`secureWebPreferences`); keine Navigation, keine neuen Fenster, Berechtigungen nur Vollbild und Zwischenablage (`windowGuards.ts`, `windowPolicy.ts`); Netzsperre lässt `file:` nur im Ordner der App-Seite zu; IPC-Handler prüfen den Absender (`ipc/handle.ts`) und die Eingaben (`settingsCheck.ts`); CSP im Build ohne Inline-Skripte und ohne `eval` | `windowPolicy.test.ts`, `settingsCheck.test.ts`; E2E `security` |
| **D – Abgeleitete Daten geschützt** | Log ohne Inhalte: abgewiesene Adressen nur mit Protokoll und Rechner (`kurzeAdresse`) | E2E `netz` (Pfad nicht im Log) |
| **E – Weitergeben ohne Spuren** | noch kein Export | – |
| **F – Lieferkette und Programm** | siehe unten; Fehlergrenze im Renderer, defekte `settings.json` wird weggesichert, nur eine Instanz je Benutzer | CI `npm audit --omit=dev` |

Gefunden beim Übernehmen aus der Mottulbox: Deren `isAppPage` wirft bei kaputter %-Kodierung
(`file:///C:/x%E0.html`), der Wächter verhindert die Navigation dann nicht. Hier behoben
(`filePathKey` in `windowPolicy.ts`), mit Unit-Test und E2E-Schritt; die Gegenprobe mit dem alten
Verhalten macht den E2E-Schritt rot.

## Lieferkette

- **`package-lock.json` ist eingecheckt** (sha512-Integrity je Paket). Die Versionen stammen aus
  dem Lockfile der Mottulbox (dort schon geprüft), Abweichungen unten.
- **Keine Laufzeit-Abhängigkeit** bisher: Alles in `devDependencies` ist Werkzeug oder wird von
  Vite in den Renderer gebaut. Kommen sharp und better-sqlite3 dazu (Labor, Phase 1), stehen sie
  hier mit Grund.
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
