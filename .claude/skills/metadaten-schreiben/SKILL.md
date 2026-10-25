---
name: metadaten-schreiben
description: Metadaten in Bild- und Videodateien mit Galeria Beata sicher schreiben – bearbeitbare Felder (Allowlist), Zuordnung zu EXIF/IPTC/XMP, ExifTool-Aufrufe ohne Argument-Injektion, Konfliktprüfung, Journal für Rückgängig, Sicherung, Nachprüfung, XMP-Sidecars für RAW. Verwenden, bevor an metaFields.ts, services/metadata/, services/exiftool/ oder einer Stapel-Aktion gearbeitet wird, die Metadaten ändert.
---

# Metadaten schreiben

Metadaten zu schreiben heißt, **Originale des Nutzers zu verändern**. Jede Regel hier dient
Schicht B des Schutzkonzepts (`docs/PLAN.md`, Skill `bildschutz`).

## Wo was liegt (geplant)

| Was | Ort |
|---|---|
| Bearbeitbare Felder: Name, Typ, Grenzen, Prüfung, Tags je Feld | `src/shared/metaFields.ts` + Test |
| ExifTool-Prozess (`-stay_open`), Warteschlange je Prozess, Zeitlimit, Neustart | `src/main/services/exiftool/exiftool.ts` |
| Argumentdatei bauen (rein, getestet) | `src/main/services/exiftool/args.ts` |
| Lesen → Index, Schreiben, Journal, Sidecars | `src/main/services/metadata/` |
| IPC | `src/main/ipc/meta.handlers.ts` (Skill `ipc-kanal`) |

## Felder

- **Nur Felder aus `metaFields.ts`** – der Renderer schickt `{ feld, wert }`, nie einen Tag-Namen.
  main prüft Feld (Allowlist), Typ und Grenzen (Länge, Bewertung 0–5, Breite −90…90, Länge
  −180…180, Datum gültig) und bildet erst dann die Tags.
- Zuordnung als Startpunkt (Tabelle in `docs/PLAN.md`, „Metadaten bearbeiten“): Titel,
  Beschreibung, Stichwörter, Bewertung, Farblabel, Aufnahmedatum, Standort, Ort, Urheber,
  Copyright. Für die MWG-Felder `-use MWG` setzen, dann schreibt ExifTool EXIF, IPTC und XMP
  stimmig. **Jede Zuordnung im Labor gegen Windows-Explorer und digiKam prüfen** (Skill
  `bild-labor`) und das Ergebnis in die Tabelle eintragen – erst dann gilt sie.
- **Mehrfachauswahl:** nur geänderte Felder schreiben; Stichwörter als Hinzufügen/Entfernen
  (`-Keywords+=`/`-Keywords-=`), nie die Liste der ersten Datei auf alle kopieren.
- **Lesen für den Index** mit `-json -n -G1` (Zahlen statt Text, Gruppen eindeutig); Anzeige-
  texte macht die Oberfläche selbst.

## ExifTool-Aufrufe

- **Immer über den Wrapper**, nie `spawn('exiftool', …)` an anderer Stelle; Pfad zur Binary nur
  aus `exiftool/binPath.ts` (gebündelt unter `resources/exiftool/win/`).
- **Argumente über die Argumentdatei** (`-@ -` bzw. stdin im `-stay_open`-Modus), **ein Argument
  je Zeile**, nie über eine Shell.
- **Keine Argument-Injektion:**
  - Dateien nur als **absolute Pfade** (beginnen nie mit `-`), vorher aus dem Index aufgelöst und
    geprüft (liegt in einem Bibliotheksordner, Ordner nicht „nur lesen“).
  - Werte dürfen keine Zeilenumbrüche oder Steuerzeichen in die Argumentdatei tragen – sonst wird
    der Rest der Zeile ein neues Argument. Steuerzeichen entfernen; mehrzeilige Beschreibungen
    über eine Escape-Option (`-ec` o. Ä.) schreiben, **im Labor bestätigen**, dass ein Wert
    `x\n-delete_original` als Text ankommt. Test in `args.test.ts`.
  - Tag-Namen nur aus `metaFields.ts`, nie aus der Eingabe.
- **Windows:** `-charset filename=utf8` (Unicode-Namen); lange Pfade und Netzlaufwerke laut
  Labor-Ergebnis behandeln.
- **Ausgabe prüfen:** Erfolg nur bei „1 image files updated“ (o. Ä.) **und** ohne `Error:`;
  Warnungen ins Journal, nicht verschlucken.

## Ablauf beim Schreiben

1. **Freigabe:** Datei ist im Index, Ordner-Modus erlaubt Schreiben, Format kann ExifTool
   schreiben; sonst Sidecar (RAW, schreibgeschützt) oder verständliche Absage.
2. **Konflikt:** Größe + Änderungszeit gleich wie beim Lesen? Sonst neu lesen und den Nutzer
   fragen – nie über eine inzwischen geänderte Datei schreiben (anderes Programm, Kollege).
3. **Journal:** alte Werte der betroffenen Felder in `journal` (vor dem Schreiben, in einer
   Transaktion mit dem Auftrag).
4. **Sicherung** (Einstellung, ab Werk an): Kopie unter `Sicherungen/` mit Hash im Namen, nie
   überschreiben (`COPYFILE_EXCL`), Aufbewahrung nach Tagen/Größe.
5. **Schreiben** mit `-overwrite_original` (ExifTool schreibt eine Nachbardatei und ersetzt dann)
   und – wenn eingestellt – `-P` (Dateidatum behalten). Kein `_original`-Rest im Ordner des Nutzers.
6. **Nachprüfen:** neu lesen, Sollwerte vergleichen, Pixeldaten-Hash unverändert (Labor/E2E);
   Index aktualisieren. Abweichung = Fehler im Bericht, Sicherung bleibt.
7. **Rückgängig:** alte Werte aus dem Journal zurückschreiben (gleicher Ablauf, eigene
   Journal-Zeile), nur wenn die Datei seither nicht anderweitig geändert wurde.

## Sidecars (XMP)

- Name `<bild>.xmp` neben dem Bild (Konvention von Lightroom/darktable prüfen: `bild.CR3.xmp`
  vs. `bild.xmp`) – Entscheidung im Labor, dann fest.
- Lesen: Sidecar-Werte haben Vorrang vor eingebetteten; der Index merkt sich die Quelle.
- Umbenennen/Verschieben im Stapel nimmt den Sidecar mit (Skill `stapelverarbeitung`).

## Tests

- Rein: `metaFields` (jede Grenze, Ungültiges), `args` (Injektion per Zeilenumbruch, führendes
  `-`, Unicode, Mehrfachauswahl mit `+=`/`-=`).
- Labor (`*.lab.test.ts`, echtes ExifTool): jedes Feld schreiben → lesen → gleich; Pixel-Hash
  gleich; Rückgängig stellt den alten Stand her; schreibgeschützte Datei → Sidecar.
- E2E `metadaten`: Bearbeiten-Panel einzeln und mehrfach, Rückfrage bei Konflikt (Datei während
  der Bearbeitung von außen ändern), Rückgängig.
