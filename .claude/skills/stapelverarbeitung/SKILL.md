---
name: stapelverarbeitung
description: Stapel-Aktionen der Galerie bauen oder ändern – Umbenennen mit Namensmuster, Metadaten für viele Bilder, Zeit verschieben, Drehen, Konvertieren/Exportieren, in Ordner einsortieren. Regeln für Planen (rein), Konflikte unter Windows, Vorschau, zweistufiges Umbenennen, Ausführen in der Warteschlange, Abbrechen, Bericht und Rückgängig. Verwenden, bevor an batchPlan.ts, renamePattern.ts, services/batch/ oder dem Stapel-Assistenten gearbeitet wird.
---

# Stapelverarbeitung

Ablauf für **jede** Aktion: **Auswahl → Aktionen → Vorschau → Ausführen → Bericht → Rückgängig**.
Nichts läuft, bevor die Vorschau gezeigt wurde und frei von Konflikten ist.

## Wo was liegt (geplant)

| Was | Ort |
|---|---|
| Namensmuster `{datum:…}`, `{zähler:3}` … (rein) | `src/shared/renamePattern.ts` + Test |
| Planen: Ziel je Datei, Konflikte, Vorschau-Zeilen (rein) | `src/shared/batchPlan.ts` + Test |
| Ausführen je Aktion, Journal | `src/main/services/batch/` |
| Warteschlange und Auftragsliste | `src/main/services/jobs/queue.ts`, `jobList.ts` (aus Mottulbox: von `JobList` erben, nur `run()` schreiben) |
| Assistent | `src/renderer/src/stapel/` |

## Planen (rein, getestet)

- `planBatch(bilder, aktionen, umgebung)` liefert je Datei: Quelle, Ziel(e), Änderungen, Status
  (`ok` | `konflikt` | `übersprungen`) mit Grund. **Dieselbe Funktion** für Vorschau und
  Ausführung – main plant beim Start neu (die Dateien können sich seit der Vorschau geändert
  haben) und bricht ab, wenn das Ergebnis von der bestätigten Vorschau abweicht.
- Platzhalter-Werte (Datum, Kamera, Ort) kommen aus dem Index; fehlt ein Wert, sagt die Vorschau
  es („kein Aufnahmedatum“) statt still „undefined“ einzusetzen. Zähler in Reihenfolge der
  aktuellen Sortierung, Startwert und Stellen einstellbar.

## Konflikte unter Windows

Vor dem Start erkennen, in der Vorschau markieren:

- **Gleicher Zielname** zweier Dateien – auch wenn sie sich nur in Groß/Klein unterscheiden
  (NTFS ist nicht case-sensitiv): Vergleich über `toLocaleLowerCase('de')` + NFC-Normalisierung.
- **Ziel existiert schon** (und ist keine Datei derselben Aktion).
- **Unzulässige Namen:** `< > : " / \ | ? *`, Steuerzeichen, Punkt/Leerzeichen am Ende,
  reservierte Namen (`CON`, `PRN`, `AUX`, `NUL`, `COM1`–`COM9`, `LPT1`–`LPT9`, auch mit Endung).
- **Pfad zu lang** (laut Labor-Ergebnis, Skill `bild-labor`).
- **Ordner „nur lesen“** oder fehlende Schreibrechte; Ziel auf anderem Laufwerk (Verschieben =
  Kopieren + Löschen, nicht `rename`).
- **Sidecars** (`.xmp`) wandern mit und haben dieselben Konflikte.

## Ausführen

- **Je Datei ein Schritt**; ein Fehler stoppt nicht den Rest, er landet im Bericht. Abbrechen
  jederzeit per `AbortSignal` – die gerade laufende Datei wird fertig oder vollständig
  zurückgenommen, nie halb.
- **Umbenennen zweistufig:** erst alle Quellen auf eindeutige Zwischennamen
  (`.<name>.galerie-tmp-<zufall>`), dann auf die Ziele. Nur so gehen Tausch (A↔B), Ketten
  (A→B, B→C) und reine Groß/Klein-Änderungen. Bricht es zwischen den Stufen ab, stellt der
  Bericht/Neustart die Zwischennamen wieder her (Journal kennt beide Stufen).
- **Neue Dateien** (Export, Kopie) exklusiv anlegen: fertig in die Nachbardatei, dann atomar
  an den Zielnamen (`fsAtomic.writeNewFileAsync` aus der Mottulbox); nie über eine Datei, die
  inzwischen jemand angelegt hat.
- **Metadaten** über den Ablauf aus `metadaten-schreiben` (Konfliktprüfung, Journal, Sicherung,
  Nachprüfen); ExifTool kann mehrere Dateien je Befehl – Stapel bilden, aber Fehler je Datei
  auswerten.
- **Drehen** ab Werk verlustfrei über die EXIF-Ausrichtung; pixelweise nur auf ausdrücklichen
  Wunsch (dann neu kodiert, Hinweis in der Vorschau).
- **Export:** Datenschutz-Vorgabe „ohne Standort“ (Skill `bildschutz`, Schicht E), Farbraum sRGB.
- Index und Oberfläche erst nach Erfolg je Datei aktualisieren; der Watcher meldet die eigenen
  Änderungen ebenfalls – nicht doppelt verarbeiten (eigene Pfade kurz vormerken).

## Bericht und Rückgängig

- Bericht: erledigt / übersprungen / Fehler je Datei mit Grund; Liste kopierbar.
- **Rückgängig** aus dem Journal, je Aktion definiert: Umbenennen/Verschieben zurück (wieder
  zweistufig), Metadaten zurückschreiben, Export = erzeugte Dateien in den Papierkorb.
  Nur Dateien, die seither unverändert sind; der Rest steht im Bericht.
- Stapel-„Rezepte“ (Aktionen + Einstellungen) als JSON speicherbar; beim Laden mit derselben
  Prüfung wie fremde Eingaben (Allowlist, Grenzen).

## Tests

- Rein: Namensmuster (jeder Platzhalter, fehlende Werte, Zähler), Konflikte (Groß/Klein,
  reservierte Namen, Punkt am Ende, Tausch A↔B, Kette), Plan bei Änderung zwischen Vorschau und Start.
- E2E `stapel`: Vorschau = Ergebnis (Dateiliste danach), Konflikt blockiert den Start,
  Abbrechen mitten im Lauf hinterlässt keine Zwischennamen und keine halben Dateien,
  Rückgängig stellt Namen und Metadaten her; Prüfsummen unbeteiligter Dateien unverändert.
