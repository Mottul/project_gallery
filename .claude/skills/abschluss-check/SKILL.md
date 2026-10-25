---
name: abschluss-check
description: Prüfung vor dem Abschluss einer Änderung in der Galerie – Prettier, ESLint, Typecheck, Tests, Labortests, bei App-Änderungen E2E, Bildschutz-Prüfliste, Doku, ehrlicher Bericht. Verwenden, bevor etwas als fertig gemeldet oder committet wird. (Übernommen aus der Mottulbox und angepasst.)
---

# Abschluss-Check

Solange das Gerüst aus Phase 0 noch nicht steht, gelten nur die Schritte 1, 7 und 8.

1. **Geänderte Dateien** ansehen: `git status --short`. Markdown ist von Prettier ausgenommen.
2. **Format, Dateinamen, Verweise:** `npm run format:check`, `npm run check:refs` (nennen
   CLAUDE.md, Doku und Skills eine Datei, die es nicht gibt?) und `npm run check:files` (Namen,
   die sich nur in Groß/Klein unterscheiden – unter Windows liegt dann nur eine auf der Platte).
   Bei Treffern nur die betroffenen Dateien formatieren (`npx prettier --write <Dateien>`),
   **nie** `npm run format` auf alles.
3. **Lint** (warnungsfrei): `npm run lint` – die Sperre für Netz-Module im main (Skill
   `bildschutz`, Schicht A) ist Teil davon und wird nicht gelockert.
4. **Typen:** `npm run typecheck` und `npm run typecheck:test`.
5. **Tests:** erst die betroffenen (`npx vitest run <Pfad>`), zum Schluss `npm test` – unter
   Windows wie Linux grün; Pfade in Tests mit `path.join`. Labortests (`*.lab.test.ts`) laufen
   mit, wenn ExifTool gebündelt ist (`npm run exiftool:fetch`); übersprungene Labortests im
   Bericht nennen.
6. **App-Verhalten geändert** (Oberfläche, IPC, Protokolle, Bilddienst, Dateien schreiben)?
   Dann `npm run e2e` – mindestens `smoke`, `netz`, `originale` und das Skript des Bereichs
   (Skill `electron-e2e`). **Paket betroffen** (`electron-builder.yml`, `asarUnpack`,
   `extraResources`, neues natives Modul)? Dann `npm run package:dir` und `npm run e2e -- paket`
   (Skill `windows-paket`).
7. **Prüflisten:** Berührt die Änderung Dateien, Cache, Log, Protokolle, IPC, Export oder
   Abhängigkeiten → Skill `bildschutz` durchgehen; zusätzlich `review-checkliste`.
   **Doku:** neue oder geänderte Funktion in die Doku, Erledigtes im Plan (`docs/PLAN.md`)
   abhaken bzw. in die Doku überführen; neue Lese-/Schreibwege in `docs/SICHERHEIT.md`.
8. **Bericht:** kurz sagen, was grün ist und was nicht (mit Ausgabe), was übersprungen wurde
   und warum – nichts beschönigen. Danach committen und auf einem eigenen Branch je Vorhaben
   pushen, nie auf `main`. Pull Requests nur, wenn der Nutzer sie freigegeben hat; gemergt wird
   vom Nutzer.
