---
name: review-checkliste
description: Projektspezifische Prüfliste für Änderungen an Galeria Beata – bestätigte Fehlerklassen aus den Reviews der Mottulbox (Zustand nach await, Dateisystem und Fehlercodes, atomares Schreiben, fremde Eingaben, Fenster, Tests, die nie scheitern) plus Bild-spezifische (Ausrichtung, Farbraum, Metadaten, große Bibliotheken). Verwenden zusätzlich zu /code-review, bevor eine Änderung als fertig gilt. (Übernommen aus der Mottulbox und angepasst.)
---

# Review-Checkliste Galeria Beata

Die Abschnitte „aus der Mottulbox“ sind dort tatsächlich vorgekommen (Reviews Oktober 2026).
Zusätzlich gelten `/code-review` und der Skill `bildschutz`.

## Zustand nach `await` (aus der Mottulbox)

- **Nach einer Rückfrage oder jedem `await` nicht mit dem Stand vom Klick weiterarbeiten.**
  Frischen Stand holen; Listen in Einstellungen werden ersetzt, nicht gemergt.
- **Ein Start mit `await` kann von einem Stopp oder zweiten Start überholt werden.** Generation
  zählen, nach jedem `await` vergleichen, gerade Erstelltes wieder abbauen. Hier: Scan eines
  Ordners, der inzwischen entfernt wurde; Vorschaubild für eine Datei, die inzwischen geändert ist.
- **Fehlschläge nicht zwischenspeichern, wenn sie vorübergehend sein können** (Zeitlimit,
  gesperrte Datei, Netzlaufwerk) – Erfolg merken, Fehlschlag später neu versuchen.
- **zustand-Store und lokaler `useState` nach `await` nicht im selben Atemzug setzen**, wenn ein
  Effekt beide liest.
- **Eine Liste aus main, die mehrere Teile anzeigen, über einen gemeinsamen Hook laden**, nicht
  je Komponente beim Einhängen (sonst merkt die zweite Ansicht Änderungen nicht).
- **`key` von Listen nie aus der Position**, wenn Einträge wandern (Raster nach Umsortieren:
  Bilder würden neu geladen und flackern) – immer die Bild-Kennung.

## Dateisystem (aus der Mottulbox)

- **Fehlercodes unterscheiden:** „fehlt“ nur bei `ENOENT`/`ENOTDIR`; jeder andere Fehler bricht
  ab oder wird später wiederholt – nie eine vorhandene Datei als gelöscht/neu behandeln.
- **Neue Dateien exklusiv anlegen**, aber nicht unter dem Zielnamen schreiben: fertig in die
  Nachbardatei, dann atomar an den Namen (`link`/EEXIST bzw. reservieren + umbenennen).
- **`writeSync` schreibt bei fast voller Platte still nur einen Teil** – ganze Inhalte mit
  `writeFile`; jeder Fehlerweg räumt seine Nachbardatei weg; unter Windows `rename` bei
  `EPERM`/`EACCES`/`EBUSY` (Virenscanner, Explorer-Vorschau) kurz wiederholen.
- **Nie synchron auf Nutzerordner** (`statSync`, `existsSync`) – `isDirReachable()` mit Zeitlimit.
- **Zerstörende Schritte erst nach Erfolg** (Index-Zeile erst löschen, wenn die Datei wirklich
  im Papierkorb ist).
- **Was die App selbst erzeugt, muss ihre eigene Prüfung bestehen** (Stapel-Rezept speichern →
  wieder laden; Export → wieder in die Bibliothek aufnehmen).
- **Grenzen in Summe prüfen, nicht nur je Teil** (eine Auswahl × Aktionen × Dateien).

## Fremde Eingaben (aus der Mottulbox)

- Bilder, Metadaten, Sidecars und Stapel-Rezepte sind fremde Eingaben: nur in den Speicher lesen,
  mit Grenzen (Größe, Anzahl, Längen), feldweise prüfen.
- **Schlüssel aus fremden Daten nie mit `obj[key] ?? …` oder `key in obj` nachschlagen** –
  „constructor“ liefert eine Funktion. `Object.hasOwn` oder `Map`.
- **Texte aus Metadaten immer escapen** (Titel als HTML-Text, nie `innerHTML`); Stilwerte nie
  ungeprüft ins CSS.
- **Inhalte nur unter ihrem geprüften Hash ablegen**, wenn der Hash ihr Name ist (Cache).

## Fenster (aus der Mottulbox)

- **`before-quit`: `preventDefault()` hält die übrigen Handler nicht an** – laufende Aufträge
  (Stapel, Metadaten schreiben) fragt ein erster Handler ab, alle weiteren prüfen die Freigabe.
- **Electron meldet `'closed'` asynchron** – `const self = win` im Handler, `if (win !== self) return`.
- „Läuft gerade“-Anzeigen brauchen die Wahrheit aus dem main (Event), nicht den letzten Klick.

## Bilder, Videos und Metadaten (Galeria Beata)

- **Ausrichtung:** Wird ein Bild irgendwo ohne EXIF-Ausrichtung angezeigt oder berechnet
  (Canvas, Zuschneide-Koordinaten, Seitenverhältnis im Raster)? Breite/Höhe im Index sind die
  **aufgerichteten** Maße – oder klar als Roh-Maße benannt.
- **Farbraum:** Vorschaubild und Export in sRGB; ein P3-Testbild sieht im Raster wie im Betrachter aus.
- **Metadaten:** Mehrfachauswahl schreibt nur Geändertes; Stichwörter hinzufügen/entfernen statt
  ersetzen; Datum ohne Zeitzone bleibt lokal (keine Verschiebung um die UTC-Differenz).
- **Groß/Klein unter Windows:** Pfadvergleiche, Konflikte und Duplikate ohne Groß/Klein und mit
  Unicode-Normalisierung (NFC).
- **Große Bibliotheken:** keine Schleife über alle Bilder im Renderer, keine Objektlisten über
  IPC, keine Abfrage ohne Index (`EXPLAIN QUERY PLAN`), keine Arbeit pro Bild beim Start.
- **Bilddienst:** Jede neue Aufgabe mit Zeitlimit; Absturz an einer Datei → Datei markieren,
  Dienst neu, Rest läuft weiter.

## Tests (aus der Mottulbox)

- **Tests laden nichts aus dem Netz**; Hintergrund-Arbeit beim Start im Harness abschalten.
- **Ein Messskript ist keine Gegenprobe** – Aussagen über die App erst nach E2E in der App.
- **Ein Test darf die Regeln der App nicht umgehen**; Gegenprobe gegen den alten Stand: Der Test
  muss dort scheitern.
- **Erwartungen, die nie scheitern können:** `expect(liste).not.toContain(expect.stringMatching(…))`
  ist immer wahr (stattdessen `liste.some(…)` erwarten); kein stilles `if (…) return` im Test,
  wenn eine Vorbedingung fehlt – die Vorbedingung selbst erwarten.
- **Reine Module importieren Stores nur als Typ** (ein Store zieht `api`/`window` mit, Node-Tests
  brechen beim Import).

## Vor dem Abschluss

Hat der Befund ein Gegenstück in der echten App? Mit `/electron-e2e` nachstellen, bevor man ihn
behebt, und danach als Regressionstest behalten. Gewicht benennen: Datenverlust an Originalen
wiegt schwerer als ein langsamer Durchsatz.
