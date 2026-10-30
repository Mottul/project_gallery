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
| `galerie.mjs` | Ordner hinzufügen/entfernen, Scan, Kacheln/Blocksatz/Liste (Seitenverhältnis, bündige Zeilen, Rahmen), Größenregler, Auswahl, Watcher (Datei von außen ändern/löschen), Betrachter |
| `betrachter.mjs` | Bildwechsel ohne leeren Moment (Blättern, Diashow, große Originale), Vorladen ohne zweiten Abruf, Filmstreifen ganz sichtbar, Zoom (Regler, Stufen-Menü, sanft, Touchpad), Diashow-Effekte (Überblenden, Ken Burns, Anhalten, Menü, „Bewegung reduzieren“) |
| `ueberwachen.mjs` | Änderungen von außen ohne „Neu einlesen“ (dazu, geändert, gelöscht), umbenannter Unterordner behält Kennungen und Vorschaubilder, 120 Dateien auf einmal, Versteckte draußen, Bibliotheksordner weg und wieder da (Fokus), UNC-Pfad `\\localhost\C$\…` periodisch, Log ohne Namen |
| `abnahme50k.mjs` | nur auf Wunsch: Abnahme-Messung mit 50.000 synthetischen Bildern (Erstindex, Neustart als Median aus 3, Sortieren, Scrollen, Speicher, Blockaden des main aus dem Log); `ABNAHME_BEHALTEN=1` / `ABNAHME_DATEN=<Ordner>` zum schnellen Nachmessen ohne neues Einlesen |
| `sortieren.mjs` | Reihenfolgen exakt nach bekannten Testbildern (Datum, Name natürlich, Ort A–Z, Kamera, Bewertung, Ordner), fehlende Werte am Ende – „Ohne Standort“ auch absteigend; Gruppen (Monat/Jahr/Tag, Ort) und der Schalter „Gruppen“ in Raster und Liste |
| `filter.mjs` | Filter und Suche exakt gegen die Testbilder, Ungültiges abgelehnt, Suchfeld, Filterleiste (Liste ganz sichtbar), Chips, „N von M“, Filter über Ordner/Ansichten/Betrachter, nach Neuladen weg, Suchindex folgt den Dateien, Log ohne Suchbegriffe |
| `ansichten.mjs` | Speichern über die Filterleiste, Öffnen stellt Ordner, Darstellung, Sortierung, Gruppen, Größe, Filter und Suche wieder her, Ersetzen nur ausdrücklich, Ungültiges abgelehnt, nach dem Neustart nicht aktiv, Löschen mit Rückfrage, entfernter Ordner nimmt seine Ansichten mit, Log ohne Namen |
| `metadaten.mjs` | Schnellbewertung: Werte unabhängig von der App mit ExifTool nachgelesen, Pixel gleich, Rückgängig, Sicherung einmal und bytegleich, Konflikt bei Änderung von außen, schreibgeschützt, BMP, „privat“, „nur lesen“, Einschleusen, Log ohne Werte, keine Nachbardatei; ab 3.2 Panel, ab 3.3 mehrfach |
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

- **Testbibliothek je Lauf** frisch aus `scripts/testbilder.mjs` in einen Temp-Ordner –
  `testbibliothek()` im Harness (liefert `dir`, `manifest`, `aufraeumen`); nie echte Fotos, nie
  ein Ordner des Entwicklers. Inhalt (Namen, Daten, GPS, Ausrichtungen) ist bekannt, also
  Reihenfolgen und Werte **exakt** erwarten; `erwarteteBilder(manifest)` = Dateien, die in die
  Galerie gehören. Braucht das gebündelte ExifTool und ffmpeg.
- **Cache und Index** liegen im frischen Benutzerordner des Laufs: Der Harness setzt
  `LOCALAPPDATA` auf `<userData>/lokal`, sonst landen Testdaten im echten Profil. Für einen
  Neustart denselben `userData` an `launchApp` geben und selbst aufräumen (Muster `galerie.mjs`).
- **Ordner-Dialog** per `stubOrdnerDialog(app, pfad)` ersetzen (`null` = Abbrechen); die
  Optionen des letzten Aufrufs stehen in `globalThis.__ordnerDialog`.
- **Sichtbar heißt nicht „Rahmen im Fenster“:** Ein Aufklappmenü kann im Fenster liegen und
  trotzdem vom `overflow` eines Containers abgeschnitten sein. Prüfen mit
  `document.elementFromPoint` an den Ecken (liegt dort das Element selbst obenauf?) – Muster im
  Modus-Schritt von `e2e/galerie.mjs`; gefunden per Bildschirmfoto in 1.1, nicht per Test.
- **Zustand über die Brücke abfragen** (`window.api.library.state()`) und mit `waitFor` auf
  „fertig eingelesen“ warten (`status === 'bereit'` und `lastScan`), nie feste Pausen.
- **Bilder prüfen:** Ob ein Vorschaubild erscheint, an `naturalWidth > 0` des `<img>` erkennen,
  nicht an der Existenz des Elements. **Pixel nicht per Canvas:** `thumb:` ist ein anderer
  Ursprung, die Canvas wäre „tainted“. Stattdessen im main holen – `app.evaluate(({ net }) =>
  net.fetch('thumb://id/…'))` geht durch denselben Handler wie die Seite – und mit sharp prüfen
  (Muster `e2e/galerie.mjs`).
- **Eigene Protokolle und die Konsole:** Jede 4xx-Antwort auf ein `<img>` erscheint in der Seite
  als Konsolenfehler (gemessen 1.3), 204 nicht. Erwartete Lücken (defektes Bild) also mit 204
  beantworten, sonst wird „keine Konsolenfehler“ zufällig rot – je nachdem, ob die Zeile sichtbar war.
- **Betrachter (1.5):** `shell.trashItem` per `app.evaluate` durch einen Stub ersetzen, der die
  Datei in einen Temp-Ordner verschiebt (nie den echten Papierkorb). Chromium zeigt ein schon
  geladenes `bild://`-Bild weiter, auch wenn die Datei inzwischen anders ist – „geändert“ mit
  einem Bild prüfen, das in der Sitzung noch nicht offen war. Ein Schritt, der mit offenem
  Betrachter scheitert, lässt den Dialog über der Galerie liegen: Folgeschritte beginnen mit
  `betrachterZu()`. Ausrichtung lässt sich per CSS nicht abschalten (`image-orientation: none`
  gilt nicht für Bilder fremder Herkunft wie `bild:`) – Gegenprobe über die angezeigten Maße.
- **„Kein Moment ohne Bild“ prüfen** (1.5+, `betrachter.mjs`): Wächter in der Seite per
  `MutationObserver` auf dem Betrachter – er läuft nach jedem Commit von React, vor dem Zeichnen –
  plus `requestAnimationFrame`. Nur mit `requestAnimationFrame` war die Diashow am alten Stand
  zufällig grün: Ein verdecktes Fenster bekommt kaum Animationsbilder (13 in mehreren Sekunden).
  Große Originale (4000 × 3000, Rauschen) erzeugt das Skript selbst – an den kleinen Testbildern
  fällt eine Dekodier-Lücke kaum auf.
- **Abrufe über eigene Protokolle zählen:** `page.context().newCDPSession(page)`,
  `Network.enable`, `Network.requestWillBeSent` – `bild://`-Anfragen erscheinen dort wie
  http-Anfragen. Gemessen: Chromium nimmt ein vorgeladenes Bild für dieselbe Adresse wieder,
  obwohl die Antwort `no-store` trägt.
- **Web-Animationen prüfen** (2.5): Bewegung über `getComputedStyle(img).transform` in kurzen
  Abständen messen (`ebenenProben` in `betrachter.mjs`: Matrix, Deckkraft, je Ebene), laufend über
  `img.getAnimations()`, die Bahn über `effect.getKeyframes()`. Eine weite Grenze („höchstens
  Stärke mal Maßstab“) ließ eine Bahn im alten Maßstab durch – direkt den Maßstab der Keyframes
  gegen die Bühne vergleichen. „Bewegung reduzieren“: `page.emulateMedia({ reducedMotion: 'reduce' })`.
- **Ecken mit `elementFromPoint` prüfen:** 8 px Abstand zum Rand – abgerundete Ecken treffen sonst
  das Element dahinter. `name: 'Diashow'` trifft auch „Einstellungen der Diashow“: `exact: true`.
- **Schreiben prüfen** (3.1): Werte nicht über die App lesen, sondern mit `werkzeug('exiftool')` aus
  `scripts/testbilder.mjs` – sonst bestätigt die App sich selbst. Pixel per sharp `.raw()`, Reste per
  `reste()` (nichts mit `galerie-tmp` im Ordner). Der `LOCALAPPDATA`-Umweg gilt auch für die
  Sicherungen (Windows: `<userData>/lokal/Galeria Beata Sicherungen`, Linux-CI: `<userData>/lokal
  Sicherungen`). Ein E2E, das beim ersten Mal grün ist,
  beweist nichts: Gegenproben im main und im Dienst.
- **Knopf-Namen mit Zahlen exakt:** `getByRole('button', { name: '100 %', exact: true })` – die
  Zoomstufe heißt „Zoomstufe 100 %“ und träfe sonst mit.
- **Änderungszeit zurücksetzen:** `utimesSync(p, a, st.mtime)` mit einem `Date` landet unter
  Windows gelegentlich knapp unter der vollen Millisekunde (Sekunden als Kommazahl) – dann passt
  die Datei nicht mehr zum Index. `(Math.trunc(st.mtimeMs) + 0.5) / 1000` übergeben.
- **Cache und Log prüfen:** Cache-Dateien rekursiv unter `<userData>/lokal` suchen (Windows und
  Linux liegen verschieden); Log `<userData>/galeria-debug.log` auf Koordinaten, Titel und
  Dateinamen der Testbibliothek prüfen – mit Gegenprobe, dass das Log den Lauf überhaupt enthält.
  Koordinaten mit vier Nachkommastellen und ohne Ziffer davor suchen: Mit drei Stellen fand der
  Test „2.295“ (Paris) in einem Zeitstempel „…:02.295Z“ (Linux-CI, 1.3).
- **`paket`** nimmt die neueste entpackte App unter `dist/` (auch `dist/<name>/win-unpacked`).
- **Drag & Drop aus dem Explorer** nachstellen: `page.context().newCDPSession(page)` und
  `Input.dispatchDragEvent` (`dragEnter`, `dragOver`, `drop`) mit `data.files: [pfad]` – die Seite
  bekommt echte Datei-Objekte mit Pfad, auch für Ordner (Muster `ablegen` in `e2e/galerie.mjs`).
  Ein per `new File()` in der Seite erzeugtes Objekt hat dagegen keinen Pfad.
- **Virtualisiert:** Raster und Liste enthalten nur die gezeigten Kacheln/Zeilen – Reihenfolge am
  Anfang prüfen (`zeigtAnfang` in `sortieren.mjs`), für „alle“ die Brücke fragen. `getByRole('option')`
  immer auf die Bilderliste eingrenzen (`getByRole('listbox', { name: 'Bilder' })`) – sonst trifft
  es die Einträge der Sortier-Auswahl.
- **Watcher:** nach einer Änderung von außen mit `waitFor` auf das Ergebnis warten (Debounce),
  nie feste Pausen. Seit 1.6 gleicht die App jede Änderung im Ordner selbst ab – ein Test, der
  „Datei geändert, Index weiß es noch nicht“ braucht (409), ändert über einen **Hardlink
  außerhalb** des Ordners (`linkSync`, dann über den Link anhängen): Das meldet `fs.watch` nicht
  (gemessen). Neue Testdateien mit gleicher Endung, Größe und Änderungszeit wie eine gerade
  gelöschte gelten als verschoben (gleiche Kennung) – für „neu“ eine andere Größe nehmen.
- **Fokus nachstellen:** `app.emit('browser-window-focus', {}, win)` per `app.evaluate` – die App
  prüft dann nicht erreichbare und periodische Ordner.
- **Lange Messungen:** `runSteps` hat 60 s je Schritt; drittes Element `[Name, fn, ms]` für mehr.
  Ein abgelaufener Schritt läuft im Hintergrund weiter (das Zeitlimit hält ihn nicht an) – die
  folgenden Schritte sehen dann eine App, die noch arbeitet (gesehen bei `abnahme50k`).
- **Gruppen-Überschriften** (2.3) tragen `data-gruppe` (Titel) – im Raster `role="presentation"`,
  in der Liste eine Zeile (`role="row"`). Mit Gruppen kann eine Kachelzeile kürzer sein als die
  Spaltenzahl: Zeilen nach `getBoundingClientRect().top` bilden, nie `index / spalten` rechnen.
  Geometrie-Tests (Rahmen) knapp an Kanten enden lassen (± 3 px) – großzügige Ziele lassen eine
  um eine Überschrift (40 px) verschobene Rechnung durch (Gegenprobe 2.3).
- **Filter** (2.4): Treffer sind wenige, also alle gezeichnet – `zeigt([...])` vergleicht das Raster
  genau. `Filter (N aktiv)` zählt die Chips, nicht die Suche. Der Filter gilt über alle Ordner:
  Ein gescheiterter Schritt lässt ihn stehen, Folgeschritte werden dann mit rot (erst den ersten
  Fehler ansehen). Die Testbilder enthalten kein Hochformat – „hoch“ prüft `repo.test.ts`.
  Oberfläche immer auch mit `E2E_FENSTER=1024x700` laufen lassen: So fiel in 2.4 auf, dass eine
  Auswahlliste am rechten Fensterrand abgeschnitten wurde – im Standardfenster war alles grün.
- **Gespeicherte Ansichten** (2.4b): Die Suche greift erst nach 250 ms – vor dem Speichern auf den
  Zähler warten (`1 von 4 Bildern`), sonst landet der alte Begriff in der Ansicht. Die Liste
  meldet der main vor der Antwort auf `saveView`: Der Eintrag steht schon da, während das
  Namensfeld noch offen ist – auf sein Verschwinden warten, nicht zählen.
- **Blocksatz** (2.3b): Kacheln ohne Text darunter; die Lage einer Kachel ist die Box ihres
  ersten Kindes (das Bild). Erwartungen aus dem Gezeichneten ableiten (Rahmen: was die Box
  schneidet) und mit den Maßen aus `library.details` vergleichen (Seitenverhältnis begrenzt auf
  1:3 … 3:1). Am Ende auf Kacheln zurückschalten – spätere Schritte erwarten Text unter den Kacheln.
- **Sichtbares Raster:** neue Dateien stehen je nach Sortierung unten (virtualisiert) – „ist da“
  über die Statusleiste („N Bilder“) oder die Brücke prüfen, nicht über eine Kachel.

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
- **Die CI-Bildschirme sind klein** (Windows etwa 1024 × 768, abzüglich Taskleiste): vor
  Mausbewegungen `scrollIntoViewIfNeeded()`; virtualisiertes Raster zeigt dort weniger Kacheln –
  nie eine feste Zahl sichtbarer Kacheln erwarten. Eine Kachel per Namen immer über
  `kachel(page, name)` aus dem Harness holen (scrollt, bis sie gezeichnet ist); ein Locator allein
  wartet vergeblich, sobald sie außerhalb liegt (2.3: Gruppen-Überschriften schoben „Bild 2.jpg“
  in der Windows-CI hinaus). **Nachstellen:** `E2E_FENSTER=1024x700 npm run e2e:run -- galerie`
  setzt die Fenstergröße – damit wurde der CI-Fehler lokal rot, der neue Stand grün.
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
