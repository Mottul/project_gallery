---
name: ipc-kanal
description: Neue IPC-Fläche in Galeria Beata anlegen (Channel + GalerieApi-Methode + Preload-Mapping + Handler, optional Event an den Renderer), mit Eingabeprüfung und ohne große Daten über IPC. Verwenden, sobald der Renderer etwas vom main braucht – Bibliothek, Metadaten, Stapel, Bearbeitung, Dialoge – oder main dem Renderer etwas melden soll. (Übernommen aus der Mottulbox und angepasst.)
---

# Neue IPC-Fläche anlegen

Vier Stellen gehören immer zusammen; der Typ `GalerieApi` zwingt den Preload zur
Vollständigkeit – `npm run typecheck` zeigt vergessene Stellen.

1. **Typen** in `src/shared/types.ts` (Anfrage, Antwort, Event-Nutzlast).
2. **Vertrag** in `src/shared/ipc-contracts.ts`:
   - `Channels`: Schema `<bereich><Aktion>: '<bereich>:<aktion>'`, z. B.
     `libraryQuery: 'library:query'`. Events mit Kommentar `// Event: Typ`.
   - `GalerieApi`: Methode im Namensraum des Bereichs (`library: { … }`, `meta`, `batch`,
     `edit`) mit kurzem Kommentar zum Warum. Events als `onXyz(cb): () => void` (Rückgabe = Abmelden).
3. **Preload** `src/preload/index.ts`: `ipcRenderer.invoke(Channels.x, …)`; Events über
   `subscribe(Channels.x, (v) => cb(v as never))` (räumt Listener auf).
4. **Handler** in `src/main/ipc/<bereich>.handlers.ts`: `handle(Channels.x, (_e, arg) => …)` bzw.
   `on(…)` aus `src/main/ipc/handle.ts` – nie direkt `ipcMain`, die beiden prüfen den Absender
   (App-Seite). Neue Datei → `registerXHandlers()` in `src/main/ipc/registry.ts`. Events per
   `broadcast`. Vorbild: `src/main/ipc/settings.handlers.ts` mit `src/shared/settingsCheck.ts`.

## Regeln

- **Eingaben prüfen**, auch vom eigenen Renderer: Typen, Allowlist, Grenzen für Zahlen und
  Längen, Anzahl (eine Auswahl von 100.000 Kennungen ist erlaubt, 10 Mio. nicht). Ungültig =
  Fehler, nie still „korrigiert“ weiterarbeiten.
- **Pfade:** Der Renderer schickt **Bild-Kennungen**, keine Pfade. main löst sie über den Index
  auf. Ziel-Pfade für neue Dateien (Export, Kopie) stammen aus einem Dialog des main
  (`services/fileDialogs.ts`) oder aus einem Bibliotheksordner (+ von main erzeugter Name). Kein
  ungeprüfter Pfad an ExifTool, sharp, `shell.openPath` oder `shell.trashItem`.
- **Große Daten nie über IPC:** Bilder gehen über `thumb://`/`bild://` (Skill `bildschutz`,
  Schicht C); Abfragen liefern Kennungslisten und Details nur für den sichtbaren Ausschnitt.
  Ein neues Protokoll braucht vier Stellen: `protocol.registerSchemesAsPrivileged` vor
  `app.whenReady`, `protocol.handle` danach, CSP in `src/renderer/index.html`, `docs/SICHERHEIT.md`.
- Der Renderer spricht **nur** über `api` (`@renderer/lib/api`), nie direkt mit `ipcRenderer`.
- Logik aus dem Handler in einen Dienst (`src/main/services/<bereich>/`) oder in `src/shared/`
  ziehen und dort testen; der Handler bleibt eine dünne Hülle.
- **Schreibende Aufrufe** (Metadaten, Stapel, Bearbeitung speichern) laufen als Auftrag in der
  Warteschlange und melden Fortschritt per Event – nie lange in einem `invoke` warten.
- Rückfragen (`api.confirm`/`api.choose`) im main über `dialog.showMessageBox` des
  auslösenden Fensters.

## Abschluss

`/abschluss-check` ausführen; neue Fähigkeit in der Doku ergänzen.
