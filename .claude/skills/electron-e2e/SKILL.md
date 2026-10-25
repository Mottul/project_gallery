---
name: electron-e2e
description: E2E-Tests der gebauten App Galeria Beata mit Playwright schreiben, ausführen und Fehler daran suchen – Harness, Testbibliothek, Prüfsummen der Originale, Netz-Spion, Dialoge ersetzen, bewährte Muster und Grenzen aus der Mottulbox. Verwenden, wenn Oberfläche, IPC, Protokolle, Bilddienst, Dateischreiben oder das Paket geändert wurden oder ein Verhalten in der echten App geprüft werden soll. (Übernommen aus der Mottulbox und angepasst.)
---

# Electron-E2E

Ausführen: `npm run e2e` (baut die App, dann alle Skripte) oder gezielt `npm run e2e -- galerie
stapel`; ohne neuen Build `npm run e2e:run -- smoke`. Skripte in `e2e/`, `run.mjs` kennt sie über
die Liste `all` – **ein neues Skript dort eintragen**. Harness: `e2e/harness.mjs` aus der
Mottulbox (`launchApp`, `openRoute`, `waitFor`, `stubConfirm`, `stubConfirmSequence`, `Skip`,
`runSteps`).

## Geplante Skripte

| Skript | Prüft |
|---|---|
| `smoke.mjs` | Start, Hauptfenster, keine Konsolenfehler, Datei-Dialoge merken sich den Ordner |
| `security.mjs` | Sandbox, keine Navigation/neuen Fenster, Berechtigungen, `thumb://`/`bild://` mit erfundener Kennung, `..`, Symlink nach außen |
| `netz.mjs` | lokaler Spion-Server: kein einziger Zugriff während Scan, Ansicht, Export – auch mit Testbildern, die Fremd-URLs enthalten (SVG, XMP) |
| `originale.mjs` | Prüfsummen aller Testbilder vor/nach den Schritten; nur ausdrücklich geänderte Dateien weichen ab; keine Fremddateien (`_original`, Temp) im Bibliotheksordner |
| `galerie.mjs` | Ordner hinzufügen/entfernen, Scan, Kacheln/Liste, Größenregler, Auswahl, Watcher (Datei von außen ändern/löschen), Betrachter |
| `sortieren.mjs` | Reihenfolgen exakt nach bekannten Testbildern (Datum, Name natürlich, Ort A–Z, Kamera), fehlende Werte am Ende – „Ohne Standort“ auch absteigend |
| `metadaten.mjs` | Bearbeiten einzeln/mehrfach, Werte in der Datei, Pixel-Hash gleich, Konflikt bei Änderung von außen, Rückgängig |
| `stapel.mjs` | Vorschau = Ergebnis, Konflikte blockieren, Abbrechen ohne Reste, Rückgängig |
| `editor.mjs` | Rezept, Als Kopie speichern, Original ersetzen mit Sicherung |
| `paket.mjs` | gepackte App: Start aus `app.asar`, sharp aus `app.asar.unpacked`, ExifTool aus `resources/` |

## Neues Skript

```js
import assert from 'node:assert/strict'
import { launchApp, openRoute, runSteps } from './harness.mjs'

const ctx = await launchApp() // frisches userData je Lauf (ctx.userData)
const { app, page } = ctx
try {
  await runSteps('Galerie', [
    ['zeigt den Ordner', async () => { await openRoute(page, '/') /* assert … */ }]
  ])
} finally {
  await ctx.close()
}
```

## Galeria-Beata-spezifisch

- **Testbibliothek je Lauf** frisch aus `scripts/testbilder.mjs` in einen Temp-Ordner – nie
  echte Fotos, nie ein Ordner des Entwicklers. Inhalt (Namen, Daten, GPS, Ausrichtungen) ist
  bekannt, also Reihenfolgen und Werte **exakt** erwarten.
- **Cache und Index** liegen im frischen Benutzerordner des Laufs; der Harness leitet
  `%LOCALAPPDATA%`-Pfade dorthin um (Einstellung oder Umgebungsvariable), sonst landen
  Testdaten im echten Profil.
- **Ordner-Dialog** per `app.evaluate` ersetzen (`dialog.showOpenDialog` → fester Pfad); die
  Optionen stehen im letzten Argument (davor ggf. das Fenster).
- **Bilder prüfen:** Ob ein Vorschaubild erscheint, an `naturalWidth > 0` des `<img>` erkennen,
  nicht an der Existenz des Elements; Pixel per Canvas `getImageData` (Farbe des Testmotivs).
- **Watcher:** nach einer Änderung von außen mit `waitFor` auf das Ergebnis warten (Debounce),
  nie feste Pausen.

## Was sich in der Mottulbox bewährt hat

- **Zustand über die Brücke setzen** statt klicken: `page.evaluate(() => window.api.…)`.
- **Nach Öffnen oder Klick nie sofort zählen oder Attribute lesen** – auf langsamen CI-Rechnern
  ist die Oberfläche noch nicht nachgezogen. Bis zu 5 s mit `waitFor` warten, Trefferzahl in die
  Fehlermeldung. Zustand, den ein anderer Teil nachmeldet, ebenso.
- **Native Dialoge ersetzen** (`api.confirm` → `dialog.showMessageBox`): Stub per
  `app.evaluate`; `stubConfirmSequence(app, [1])` wählt den zweiten Knopf.
- **Einstellungs-Broadcast erreicht das auslösende Fenster nicht** – „anderes Fenster ändert“
  mit einem echten zweiten Fenster testen.
- **`app.evaluate` in Warteschleifen** mit `.catch(() => false)` (kurz nach dem Start wirft
  Playwright gelegentlich „Resulting promise was garbage collected“).
- **Beenden testen:** `app.quit()` per `app.evaluate` in `setTimeout`, auf `'exit'` warten; danach
  prüfen, dass kein Bilddienst/ExifTool-Prozess übrig ist.
- **Die CI-Bildschirme sind klein** (Windows etwa 1024 × 768): vor Mausbewegungen
  `scrollIntoViewIfNeeded()`; virtualisiertes Raster zeigt dort weniger Kacheln – nie eine
  feste Zahl sichtbarer Kacheln erwarten.
- **Namen matchen als Teilstring:** `getByRole(…, { name, exact: true })` oder ein genaues Muster.
- **Windows meldet minimierte Fenster als unsichtbar**; verdeckte Fenster bekommen kein
  `requestAnimationFrame`.
- **Tests laden nichts aus dem Netz** – auch nicht nebenbei; Aufräumen darf nie einen grünen
  Lauf rot machen (Temp-Ordner mehrfach versuchen zu löschen, notfalls liegen lassen).
- **Ein Test darf die Regeln der App nicht umgehen** (kein Schalter, der Berechtigungen oder
  die Netzsperre aushebelt); jede neue Prüfung einmal gegen den alten Stand laufen lassen – sie
  muss dort scheitern.
- **Fehlersuche:** `E2E_DEBUG=1` schreibt Ausgabe des main-Prozesses und Fenster-Ereignisse mit.
- Unter Linux ohne Display `xvfb-run -a …`; der Harness setzt dort `--no-sandbox`.

## Grenzen

- Alle Skripte laufen nacheinander in einem Prozess. Jeder Schritt in `runSteps` hat ein
  Zeitlimit (60 s, neu gegenüber der Mottulbox – dort hielt ein hängender Schritt den Lauf an);
  `ctx.close()` beendet mit Zeitlimit (20 s) und danach hart; neue Wartestellen im Skript
  außerhalb von `runSteps` immer mit Zeitlimit.
- `page.evaluate` läuft über das DevTools-Protokoll und **umgeht die CSP** (`eval` geht dort
  immer). CSP-Regeln deshalb mit Code prüfen, der später im Seitenkontext läuft (String-Timer,
  `securitypolicyviolation`-Ereignis) – Muster in `e2e/security.mjs`.
- Fehlschlag zuerst als Testproblem prüfen (Zeitfenster zu eng, Route nicht neu geladen), bevor
  die App geändert wird.
