# CLAUDE.md

Galeria Beata (Arbeitstitel, Repo `project_gallery`): Bild- und Videobetrachter mit
Bildbearbeitung für Windows (Electron + React + TypeScript), offline, mit Schutz der Bilddaten
als oberster Regel. UI-Sprache und Code-Kommentare sind Deutsch.

## Stand

**Phase 0 abgeschlossen** (25.10.2026): Gerüst, Netzsperre, Fenster-Härtung, Hell/Dunkel, Tests,
CI, gepinntes ExifTool/ffmpeg, Testbibliothek, Labor-Messungen, Installer und Abnahme in der
Windows-Sandbox. **Phase 1 umgesetzt** (Bibliothek und Galerie) in den Teilschritten 1.1–1.6 aus
dem Plan, je ein PR gegen `main`; 1.1 (Index, Bilddienst, Ordner), 1.2 (Grundfelder per ExifTool,
Sortieren), 1.3 (Vorschaubilder, verschlüsselter Cache, `thumb://`), 1.4 (Galerie-Oberfläche:
Ordnerbaum, virtualisiertes Raster, Liste, Auswahl, Ordner per Drag & Drop), 1.5 (Betrachter,
`bild://`, Papierkorb; Feinschliff nach Rückmeldung: Bildwechsel ohne Blitzer, Zoom-Regler) und
1.6 (Überwachen, Abnahme mit 50.000 Bildern, Sandbox mit Testbildern). **Phase 2 läuft**
(Metadaten lesen, Filtern, Suchen; Teilschritte 2.1–2.5 im Plan); 2.1 (alle Metadaten, Info-Panel,
Fehlende entfernen), 2.2 (Orte offline, Sortieren nach Ort A–Z) und 2.3 (weitere Sortierfelder,
Gruppen-Überschriften in Raster und Liste), 2.3b (Blocksatz) und 2.4 (Filterleiste, Volltextsuche)
sind umgesetzt. Grundlage ist
[`docs/PLAN.md`](docs/PLAN.md): vor jeder Arbeit lesen, offene Fragen dort klären, Erledigtes nach
der Umsetzung in die Doku überführen. Klickbare Entwürfe der Oberfläche: Abschnitt „Vorschau der
Oberfläche“ im Plan.

Galeria Beata ist eigenständig. Die Mottulbox (`Mottul/project_mega`) ist nur Kopiervorlage und
liegt lokal neben diesem Repo (`..\project_mega`, sonst dorthin klonen). Kopiert wird vom Stand
`origin/main` (`git -C ../project_mega show origin/main:<pfad>`), nie aus deren Arbeitsordner – dort
können andere Branches oder ungesicherte Dateien liegen; den Arbeitsordner nicht ändern. Kopierte
Dateien tragen im Kopf ihre Herkunft. Was übernommen wird: Tabelle im Plan.

## Kommandos

```bash
npm run dev             # Entwicklung (Hot Reload; holt beim ersten Mal die Electron-Binary)
npm run lint            # ESLint (--max-warnings 0), sperrt Netz-Module im main
npm run format:check    # Prettier-Prüfung (format = schreiben, nur gezielt auf geänderte Dateien)
npm run check:files     # Dateinamen, die unter Windows kollidieren
npm run check:refs      # Dateiverweise in CLAUDE.md, docs/ und Skills existieren (geplante:
                        # scripts/geplante-dateien.json)
npm run typecheck       # tsc: node- + web-Projekt
npm run typecheck:test  # tsc: Testdateien
npm test                # Vitest
npm run e2e             # App bauen + E2E (Playwright, e2e/; `-- smoke netz` wählt aus)
npm run build           # typecheck + electron-vite build -> out/
npm run exiftool:fetch  # ExifTool nach resources/exiftool/<os>/ (gepinnt, SHA-256)
npm run ffmpeg:fetch    # ffmpeg/ffprobe nach resources/ffmpeg/<os>/ (gepinnt, SHA-256)
npm run orte:bauen      # Ortsdaten aus GeoNames neu bauen -> resources/geo/ (im Repo, selten)
npm run testbilder -- <ordner>  # synthetische Testbibliothek + testbilder.json (nie echte Fotos)
npm run package         # Installer nach dist/ (package:dir = entpackt, für e2e:run -- paket)
npm run abnahme:sandbox # Installer in der Windows-Sandbox ohne Netz prüfen
```

Messskripte des Labors: `scripts/labor/` (Ergebnisse im Plan, Phase 0).

Labortests (`*.lab.test.*`) laufen mit `npm test`, sobald ExifTool und ffmpeg geladen sind, sonst
werden sie übersprungen. sharp im Bilddienst und in Tests immer mit `sharp.cache({ files: 0 })`
(sonst hält libvips Dateien offen, Windows sperrt sie).

Ein einzelner Test: `npx vitest run src/main/services/netzRegel.test.ts`. Voraussetzungen, Aufbau
und Grundmuster: [`docs/ENTWICKLUNG.md`](docs/ENTWICKLUNG.md); Sicherheitsstand:
[`docs/SICHERHEIT.md`](docs/SICHERHEIT.md).

## Architektur (Kurzform)

`src/main` (Node: `index.ts`, IPC in `ipc/`, Dienste in `services/`), `src/preload` (nur die
`GalerieApi`), `src/renderer` (React, Tailwind), `src/shared` (rein, getestet). Aliase `@shared`,
`@renderer`.

- **IPC:** `src/shared/ipc-contracts.ts` ist die einzige Quelle; Handler nur über `handle`/`on`
  aus `src/main/ipc/handle.ts` (prüft den Absender); Eingaben prüfen (Muster `settingsCheck.ts`).
  Neue Fläche: Skill `ipc-kanal`. Renderer nur über `api` (`@renderer/lib/api`).
- **Netz:** Netzsperre (`services/netzsperre.ts`, Regel rein in `netzRegel.ts`) vor dem ersten
  Fenster; neue eigene Protokolle dort UND in der CSP (`src/renderer/index.html`) eintragen.
- **Fenster:** nur über `secureWebPreferences` (`services/windows/appWindows.ts`); Wächter in
  `windowGuards.ts` geben nichts an den Browser weiter.
- **Einstellungen:** `services/store.ts` (atomar), Renderer `useSettings`/`updateSettings` aus
  `@renderer/lib/settings`; localStorage nur als Boot-Spiegel.
- **Bibliothek:** Index `services/db.ts` (SQLite, Migrationen) im lokalen Datenordner
  (`lokaleDaten.ts`, `%LOCALAPPDATA%`), nur main schreibt (`services/library/`); Nutzerordner liest
  nur der **Bilddienst** (eigener Prozess, `services/bilddienst/`). Der Renderer schickt Kennungen,
  nie Pfade; Ordner kommen aus dem Dialog des main oder per Drag & Drop – dann liest der Preload
  den Pfad aus dem gezogenen Datei-Objekt (`webUtils.getPathForFile`), die Seite gibt keinen vor.
  Überwachen: Wächter im Bilddienst (`bilddienst/beobachter.ts`), Teil-Abgleich und
  live/periodisch in `library/ueberwachen.ts`. Skill `bibliothek-index`.
- **Galerie-Oberfläche:** `renderer/src/galerie/` (Ordnerbaum, Raster virtualisiert, Liste),
  Zustand in `renderer/src/lib/` (`ansicht.ts` je Ordner gemerkt, `auswahl.ts`, `bildliste.ts`:
  Kennungen samt Gruppen je Knoten, Details nur für das Sichtbare). Gruppen folgen der Sortierung
  (`shared/gruppen.ts`, Grenzen im main); Zeilen mit Überschriften rein in `lib/zeilen.ts`,
  Blocksatz (Seitenverhältnisse aus `queryGroups`) in `lib/blocksatz.ts`. Filter und Suche:
  `shared/bildFilter.ts` (geprüft, SQL nur mit Platzhaltern), `images_fts` per Trigger aktuell,
  Oberfläche `galerie/Filterleiste.tsx`, Zustand nur für die Sitzung in `lib/filter.ts`.
- **Vorschaubilder:** erzeugt im Bilddienst (`bilddienst/vorschau.ts`), Warteschlange im main
  (`library/vorschauen.ts`), nur AES-256-GCM-verschlüsselt im Cache (`services/cache/`, Schlüssel
  per `safeStorage`), ausgeliefert über `thumb://id/<kennung>/<stufe>`
  (`services/protocols/thumb.ts`); Ordner „privat“ nur im Arbeitsspeicher.
- **Betrachter:** `renderer/src/galerie/Betrachter.tsx`; Original über `bild://id/<kennung>`
  (`services/protocols/bild.ts`, Nachschlagen und Prüfen in `library/anzeige.ts`, TIFF als
  Umrechnung aus dem Bilddienst, nur im Arbeitsspeicher); Bildwechsel über zwei Ebenen (das alte
  Bild bleibt, bis das neue dekodiert ist), Zoom rein in `lib/zoom.ts`. Eigene Protokolle nur in
  `protocols/schemata.ts` anmelden. Vor jedem Lesen einer Nutzerdatei `dateien/pruefeDatei.ts`.
  Papierkorb nur über `inPapierkorb` (`library.ts`: Rückfrage, nie „nur lesen“, `shell.trashItem`).
- **Farben:** nur Tailwind-Tokens (`tailwind.config.js` → Variablen in `assets/main.css`),
  Hell = `.light` am `<html>`, Standard „wie Windows“.

## Leitplanken (gelten für jede Änderung)

- **Offline:** Die App öffnet von sich aus keine Netzverbindung. Netz-Module im main sind per
  Lint gesperrt, eine Netzsperre in der Sitzung weist alles Fremde ab; alles Nötige liegt im
  Paket (ExifTool, ffmpeg, Ortsdaten). Einzige Ausnahme: `services/update/` (App-Aktualisierung)
  – nur nach Zustimmung, feste Adresse, eigene Ed25519-Signatur.
- **Bilddaten geschützt:** Originale nur auf ausdrücklichen Befehl ändern (Sicherung, atomar,
  nachgeprüft, Journal), Löschen in den Papierkorb, Renderer ohne Dateizugriff (nur
  `thumb://`/`bild://` mit Kennungen), Vorschaubilder verschlüsselt, Log ohne Metadaten-Werte,
  Export ohne Standort. Prüfliste: Skill `bildschutz`.
- **Einfache Installation:** eine Datei, ohne Administratorrechte, ohne Downloads beim Start;
  bewusst unsigniert.
- **Erscheinungsbild:** System/Hell/Dunkel, Akzent Hellgrün (nicht das Gold der Mottulbox),
  Farben nur über Tokens/CSS-Variablen.
- **Nie echte Fotos oder Videos** in Repository, Tests oder Logs – Testdateien synthetisch.

## Skills

Projekt-Skills in `.claude/skills/`: `abschluss-check`, `review-checkliste`, `bildschutz`,
`ipc-kanal`, `electron-e2e`, `abhaengigkeiten` (aus der Mottulbox angepasst) sowie `bild-labor`,
`bibliothek-index`, `metadaten-schreiben`, `stapelverarbeitung`, `windows-paket` (neu). Pfade in
den Skills beschreiben teils den geplanten Aufbau aus `docs/PLAN.md` („Architektur“). Vor dem
Abschluss einer Änderung: Skill `abschluss-check`.
