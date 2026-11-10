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
| Mehrfachauswahl (3.3): Änderung als Felder + Stichwörter dazu/weg, Prüfung, je Datei ableiten (`aenderungFuer`), gemischte Werte (`zusammenfassen`), Auftragstypen (rein) | `src/shared/metaMehrfach.ts` + Test |
| Aufträge über viele Dateien: einer zur Zeit, Fortschritt als Ereignis, Abbrechen, Rückfrage, Platz für Sicherungen | `src/main/services/metadata/mehrfach.ts`, `platz.ts` + Tests |
| Drehen (3.4): Rechnung mit Spiegelung, drehbare Formate, Texte (rein) | `src/shared/ausrichtung.ts` + Test |
| Ein Bild drehen (`metaDrehen`, sofort) – derselbe Schritt wie `dateiAendern` | `src/main/services/metadata/schreiben.ts` |
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
- **Mehrfachauswahl** (seit 3.3): Der Renderer schickt eine `MehrfachAenderung` – Felder setzen,
  Stichwörter als `stichwoerterDazu`/`stichwoerterWeg`, nie eine ganze Liste (`pruefeMehrfachAenderung`
  lehnt `stichwoerter` ab). Der main liest jede Datei frisch (`WERTE_TAGS`) und bildet mit
  `aenderungFuer` ihre eigene `MetaAenderung`: nur Felder, die sich dort ändern; die neue
  Stichwortliste aus ihrer zusammengeführten Liste (ohne Groß/Klein, Schreibweise der Datei bleibt).
  Nichts zu tun → Datei unberührt (keine Sicherung, kein Journal). Das Ergebnis muss
  `pruefeMetaAenderung` bestehen (z. B. höchstens 200 Stichwörter) – sonst Fehler für diese Datei.
  **Nicht** ExifTools `+=`/`-=` (gemessen 13.59, Labortest): `-=` achtet auf Groß/Klein (ein „meer“
  bliebe und käme beim Zusammenführen zurück), `+=` legt Doppelte an, `XPKeywords` ist keine Liste.
- **Ausrichtung** (seit 3.4): nie ein Wert aus dem Renderer, nur eine Drehung (`rechts`/`links`,
  `pruefeDrehung`); der main liest die Datei frisch und bildet mit `aenderungFuer` die neue
  (`gedreht`, die Spiegelung bleibt). Tag `EXIF:Orientation#` – das `#` schreibt die Zahl; ohne lehnt
  ExifTool sie ab und kopiert die Datei nur (gemessen). `args.ts` erlaubt das `#` am Tag-Namen,
  `leseSchluessel` streicht es (Ausgabe ohne `#`). Nur in drehbaren Formaten (`drehbar`: JPEG, TIFF –
  Labor 3.4); `verweigert(z, true)` lehnt die übrigen ab, ohne die Datei zu lesen. Eine vorhandene
  `XMP-tiff:Orientation` zieht mit (`ausrichtung.xmp`), eine neue entsteht nicht. Eine im main
  gebildete Änderung prüft `pruefeAbgeleitet` (wie eine Eingabe, dazu die Ausrichtung).
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

**Aufträge über viele Dateien** (3.3, `metadata/mehrfach.ts`): einer zur Zeit; der Start antwortet
sofort mit der Kennung (oder einem Grund), Fortschritt, Ergebnis je Datei und Bericht kommen als
Ereignis `meta:job` – gedrosselt, das Ende immer. Je Datei ein Schritt der Warteschlange
(`dateiAendern`, `zeileZuruecknehmen`; Lesen in Teilen zu 200, `dateienLesen`): Dazwischen kommen
andere Aufträge dran, und jeder Schritt sieht den Stand des vorigen. Abbrechen hält nach der
laufenden Datei an. Vor dem Schreiben: Platz für die Sicherungen **aller** Dateien zusammen
(`platzFuerSicherungen`, 1 GB Reserve); die Schnellbewertung im Raster fragt im main mit der Anzahl.
Konflikt (`GEAENDERT`) = Status „konflikt“, nur diese Datei wird abgeglichen; „Neu lesen und erneut
versuchen“ (`nochmal`) gleicht die Dateien ab und wartet darauf. „Rückgängig“ bekommt alle
Journal-Zeilen eines Auftrags (samt erneutem Versuch) und nimmt sie in einem Schritt zurück.
Schreibt beim Schließen des Fensters noch ein Auftrag, fragt die App und schließt erst nach der
laufenden Datei (`src/main/index.ts`).

## Sidecars (XMP)

- Name `<bild>.xmp` neben dem Bild (Konvention von Lightroom/darktable prüfen: `bild.CR3.xmp`
  vs. `bild.xmp`) – Entscheidung im Labor, dann fest.
- Lesen: Sidecar-Werte haben Vorrang vor eingebetteten; der Index merkt sich die Quelle.
- Umbenennen/Verschieben im Stapel nimmt den Sidecar mit (Skill `stapelverarbeitung`).

## Tests

- Rein: `metaFields` (jede Grenze, Ungültiges), `args` (Injektion per Zeilenumbruch, führendes
  `-`, Unicode), `metaMehrfach` (Prüfung, `aenderungFuer` je Datei, `zusammenfassen`, Rückfrage),
  `lib/mehrfachFormular` (‹verschieden› leer behält, Chips, nur dazu/weg). Auftrag im main
  (`mehrfach.test.ts`): nie die Liste einer Datei auf andere, Unberührtes ohne Sicherung, Konflikt,
  Abbrechen nach der laufenden Datei, einer zur Zeit, Platz, Rückgängig als ein Schritt.
- Labor (`*.lab.test.ts`, echtes ExifTool): jedes Feld schreiben → lesen → gleich; Pixel-Hash
  gleich; Rückgängig stellt den alten Stand her; Stichwörter dazu/weg in allen sechs Formaten
  (XMP, IPTC, XP); Drehen in JPEG und TIFF für alle acht Ausrichtungen (Lage des Vierfarb-Motivs per
  sharp, Bilddaten gleich, Maße im Index getauscht, Rückgängig), XMP-Ausrichtung zieht mit, AVIF
  beachtet die EXIF-Ausrichtung nicht; schreibgeschützte Datei → Sidecar.
- Rein seit 3.4: `ausrichtung.test.ts` (jede Ausrichtung gegen Matrizen aus der EXIF-Norm, auch
  gespiegelt), `metaFields`/`metaMehrfach` (Tags, `pruefeAbgeleitet`, Drehung je Datei), `mehrfach.test.ts`
  (je Datei von der eigenen Ausrichtung, PNG ungelesen abgelehnt, Platz nur für Drehbare, `metaDrehen`).
- E2E `metadaten`: Bearbeiten-Panel einzeln und die Ansicht „Metadaten bearbeiten“ mehrfach (Werte
  unabhängig mit ExifTool nachgelesen), Rückfrage bei Konflikt (Datei während der Bearbeitung von
  außen ändern), Abbrechen, Rückgängig, „nur lesen“ und „privat“ in der Auswahl, Schnellbewertung in
  Raster und Liste; Drehen im Betrachter und für eine Auswahl (Ausrichtung nachgelesen, Anzeige und
  Vorschaubild per Lage des Motivs, nicht drehbare Formate bytegleich).
