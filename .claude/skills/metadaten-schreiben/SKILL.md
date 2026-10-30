---
name: metadaten-schreiben
description: Metadaten in Bild- und Videodateien mit Galeria Beata sicher schreiben – bearbeitbare Felder (Allowlist), Zuordnung zu EXIF/IPTC/XMP, ExifTool-Aufrufe ohne Argument-Injektion, Konfliktprüfung, Journal für Rückgängig, Sicherung, Nachprüfung, XMP-Sidecars für RAW. Verwenden, bevor an metaFields.ts, services/metadata/, services/exiftool/ oder einer Stapel-Aktion gearbeitet wird, die Metadaten ändert.
---

# Metadaten schreiben

Metadaten zu schreiben heißt, **Originale des Nutzers zu verändern**. Jede Regel hier dient
Schicht B des Schutzkonzepts (`docs/PLAN.md`, Skill `bildschutz`).

## Wo was liegt

| Was | Ort |
|---|---|
| Bearbeitbare Felder: Name, Typ, Grenzen, Prüfung, Tags je Feld und Format, Nachprüfung | `src/shared/metaFields.ts` + Test |
| ExifTool-Prozess (`-stay_open`), Pool, Warteschlange je Prozess, Zeitlimit, Neustart (im Bilddienst) | `src/main/services/exiftool/exiftool.ts` |
| Argumente bauen (rein, getestet) | `src/main/services/exiftool/args.ts` |
| Der eigentliche Schreibvorgang: Nachbardatei, Nachprüfung, Sicherung, Ersetzen | `src/main/services/bilddienst/schreiben.ts` + `schreiben.lab.test.ts` |
| Freigabe, Journal, Sicherungen, Rückgängig, Aufräumen | `src/main/services/metadata/schreiben.ts` + Test |
| IPC | `src/main/ipc/meta.handlers.ts` (Skill `ipc-kanal`) |

## Felder

- **Nur Felder aus `metaFields.ts`** – der Renderer schickt `{ feld, wert }`, nie einen Tag-Namen.
  main prüft Feld (Allowlist), Typ und Grenzen (Länge, Bewertung 0–5, Breite −90…90, Länge
  −180…180, Datum gültig) und bildet erst dann die Tags.
- Zuordnung: Tabelle in `docs/PLAN.md`, „Metadaten bearbeiten“. Einzelne Tags statt der MWG-Gruppe:
  So kennt das Journal je Tag den alten Wert, und die Nachprüfung vergleicht genau das Geschriebene.
  Was je Format geht, ist gemessen (`scripts/labor/exiftool-schreiben.mjs`). **Neues Feld zuerst
  dort messen**, auch im Explorer (`System.Title` usw. über die Shell) – erst dann gilt es.
- **Grenzen der Formate beachten** (gemessen): IPTC begrenzt die Länge je Feld in Bytes – was nicht
  passt, schnitte ExifTool ab, darum dort entfernen (`IPTC_MAX`); XP-Felder speichern keine Emoji, ein
  Stichwort mit Emoji fehlt dort ganz, weil es gekürzt als zweites zurückkäme. Stichwörter stehen in
  XMP, IPTC und XP und werden beim Lesen zusammengeführt: Ersetzen muss alle drei schreiben.
- **Neues Feld:** in `VOLL` von `schreiben.lab.test.ts`. Dort muss es in allen Formaten durch den
  Schreibweg und aus `werteAus` und `grundfelderAus` genau so wieder herauskommen.
- **Mehrfachauswahl:** nur geänderte Felder schreiben; Stichwörter als Hinzufügen/Entfernen
  (`-Keywords+=`/`-Keywords-=`), nie die Liste der ersten Datei auf alle kopieren.
- **Lesen für den Index** mit `-json -n -G0` (Zahlen statt Text; Tags fest in
  `GRUNDFELD_TAGS`, Prüfung in `grundfelder.ts`, seit 2.1 auch Objektiv, Belichtung, GPS,
  Bewertung, Farblabel, Titel, Beschreibung, Stichwörter); Anzeigetexte macht die Oberfläche
  selbst. „Alle Felder“ fürs Info-Panel liest der Bilddienst auf Abruf mit `-json -G1 -a -s`
  (lesbare Werte) – nicht für den Index.

## ExifTool-Aufrufe

- **Immer über den Wrapper**, nie `spawn('exiftool', …)` an anderer Stelle; Pfad zur Binary nur
  aus `exiftool/binPath.ts` (gebündelt unter `resources/exiftool/win/`).
- **Argumente über die Argumentdatei** (`-@ -` bzw. stdin im `-stay_open`-Modus), **ein Argument
  je Zeile**, nie über eine Shell.
- **Keine Argument-Injektion:** `args.ts` setzt jeden Wert als `#[CSTR]-Tag=Wert` – Zeilenumbruch und
  Backslash werden C-Zeichen, die Zeile bleibt eine. Roh wäre der Rest ein neues Argument (gemessen:
  er schrieb wirklich in einen anderen Tag). Tag-Namen nur aus `metaFields.ts`, Pfade nur absolut und
  aus dem Index. `ausfuehren` lehnt Argumente mit Zeilenumbruch zusätzlich ab.
- **Windows:** `-charset filename=utf8` (Unicode-Namen); lange Pfade und Netzlaufwerke laut
  Labor-Ergebnis behandeln.
- **Ausgabe prüfen:** Erfolg nur bei „1 image files updated“ (o. Ä.) **und** ohne `Error:`;
  Warnungen ins Journal, nicht verschlucken.

## Ablauf beim Schreiben

Festgelegt nach dem Labor (30.10.2026): **Das Nachprüfen liegt vor dem Ersetzen.** So bleibt das
Original heil, bis alles stimmt – auch ohne Sicherung (Ordner „privat“).

Im main (`metadata/schreiben.ts`), Aufträge nacheinander:

1. **Freigabe:** Zeile frisch aus dem Index, Ordner nicht „nur lesen“, Format beschreibbar, Datei ok.
2. **Journal:** alte Werte je Tag lesen und eintragen, mit dem Namen der Nachbardatei (`zwischen`).
3. **Sicherung planen:** eine je Datei, keine im Ordner „privat“.

Im Bilddienst (`bilddienst/schreiben.ts`):

4. **Konflikt:** `pruefeDatei` (Größe, Zeit, echter Pfad), schreibgeschützt? Sonst nichts tun.
5. **Schreiben** mit `-o` in die versteckte Nachbardatei (`zwischenName`). Ohne `-P`: Das
   Änderungsdatum soll sich ändern (entschieden). Ohne `-m`: Kleine Fehler in fremden Metadaten
   führen zur Ablehnung, nicht zu stillem Übergehen.
6. **Nachprüfen an der Nachbardatei:** Sollwerte (`abweichend`), Bilddaten gleich (`bildKennung`:
   ExifTool `ImageDataHash`, für GIF und TIFF die dekodierten Pixel).
7. **Sicherung** kopieren (`COPYFILE_EXCL`), scheitert sie, wird nicht ersetzt.
8. **Noch einmal `pruefeDatei`, dann atomar ersetzen** (`rename` mit Wiederholung; gesperrt = Code).
9. Die Nachbardatei geht in `finally` weg. Grundfelder frisch lesen und zurückmelden.

Zurück im main: Journal fertig, Index, Vorschaubild neu (der Cache hängt an Größe und Zeit).
Ausgang offen (Dienst weg, App beendet): Die Journal-Zeile bleibt, `schreibenAufraeumen` entfernt beim
nächsten Start die Nachbardatei.

**Rückgängig:** alte Werte je Tag über denselben Weg, nur wenn Größe und Zeit noch die nach dem
Schreiben sind; eigene Journal-Zeile.

## Sidecars (XMP)

- Name `<bild>.xmp` neben dem Bild (Konvention von Lightroom/darktable prüfen: `bild.CR3.xmp`
  vs. `bild.xmp`) – Entscheidung im Labor, dann fest.
- Lesen: Sidecar-Werte haben Vorrang vor eingebetteten; der Index merkt sich die Quelle.
- Umbenennen/Verschieben im Stapel nimmt den Sidecar mit (Skill `stapelverarbeitung`).

## Tests

- Rein: `metaFields` (jede Grenze, Ungültiges), `args` (Injektion per Zeilenumbruch, führendes
  `-`, Unicode, ab 3.3 Mehrfachauswahl mit `+=`/`-=`).
- Labor (`*.lab.test.ts`, echtes ExifTool): jedes Feld schreiben → lesen → gleich; Pixel-Hash
  gleich; Rückgängig stellt den alten Stand her; schreibgeschützte Datei → Sidecar.
- E2E `metadaten`: Bearbeiten-Panel einzeln und mehrfach, Rückfrage bei Konflikt (Datei während
  der Bearbeitung von außen ändern), Rückgängig.
