# CLAUDE.md

Galerie (Arbeitstitel, Repo `project_gallery`): Bildbetrachter und -bearbeiter für Windows
(Electron + React + TypeScript), offline, mit Schutz der Bilddaten als oberster Regel.
UI-Sprache und Code-Kommentare sind Deutsch.

## Stand

**Planungsphase – noch kein Code.** Grundlage ist [`docs/PLAN.md`](docs/PLAN.md): vor jeder
Arbeit lesen, offene Fragen dort klären, Erledigtes nach der Umsetzung in die Doku überführen.
Gerüst, Kommandos und Konventionen kommen in Phase 0 aus der Mottulbox (`Mottul/project_mega`,
dort `CLAUDE.md`) – Tabelle „Was aus der Mottulbox übernommen wird“ im Plan.

## Leitplanken (gelten für jede Änderung)

- **Offline:** Die App öffnet keine Netzverbindung. Netz-Module im main sind per Lint gesperrt,
  eine Netzsperre in der Sitzung weist alles Fremde ab; alles Nötige liegt im Paket.
- **Bilddaten geschützt:** Originale nur auf ausdrücklichen Befehl ändern (Sicherung, atomar,
  nachgeprüft, Journal), Löschen in den Papierkorb, Renderer ohne Dateizugriff (nur
  `thumb://`/`bild://` mit Kennungen), Vorschaubilder verschlüsselt, Log ohne Metadaten-Werte,
  Export ohne Standort. Prüfliste: Skill `bildschutz`.
- **Einfache Installation:** eine Datei, ohne Administratorrechte, ohne Downloads beim Start.
- **Nie echte Fotos** in Repository, Tests oder Logs – Testbilder synthetisch.

## Skills

Projekt-Skills in `.claude/skills/`: `abschluss-check`, `review-checkliste`, `bildschutz`,
`ipc-kanal`, `electron-e2e`, `abhaengigkeiten` (aus der Mottulbox angepasst) sowie `bild-labor`,
`bibliothek-index`, `metadaten-schreiben`, `stapelverarbeitung`, `windows-paket` (neu). Pfade in
den Skills beschreiben den geplanten Aufbau aus `docs/PLAN.md` („Architektur“).
