# CLAUDE.md

Galeria Beata (Arbeitstitel, Repo `project_gallery`): Bild- und Videobetrachter mit
Bildbearbeitung für Windows (Electron + React + TypeScript), offline, mit Schutz der Bilddaten
als oberster Regel. UI-Sprache und Code-Kommentare sind Deutsch.

## Stand

**Planungsphase – noch kein Code.** Grundlage ist [`docs/PLAN.md`](docs/PLAN.md): vor jeder
Arbeit lesen, offene Fragen dort klären, Erledigtes nach der Umsetzung in die Doku überführen.
Gerüst, Kommandos und Konventionen kommen in Phase 0 aus der Mottulbox (`Mottul/project_mega`,
dort `CLAUDE.md`) – Tabelle „Was aus der Mottulbox übernommen wird“ im Plan. Klickbare Entwürfe
der Oberfläche: Abschnitt „Vorschau der Oberfläche“ im Plan.

## Erste Schritte (lokale Session, Windows)

1. Voraussetzungen: Git, Node.js ≥ 22.12 (wie die Mottulbox), kein C++-Compiler.
2. Die Mottulbox neben dieses Repo klonen, damit Bausteine kopiert werden können:
   `git clone https://github.com/Mottul/project_mega ..\project_mega`.
3. Für Phase 0 einen eigenen Branch anlegen (z. B. `phase-0-geruest`) und den Plan Abschnitt
   „Phase 0 – Fundament und Labor“ abarbeiten; beim Kopieren den Kopfkommentar mit Herkunft setzen.
4. Danach füllt sich hier der Abschnitt „Kommandos“ (wie in der Mottulbox: `npm run dev`,
   `lint`, `typecheck`, `test`, `e2e`, `package`).

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
den Skills beschreiben den geplanten Aufbau aus `docs/PLAN.md` („Architektur“).
