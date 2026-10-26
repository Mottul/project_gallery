---
name: bild-labor
description: Bild- und Videoverfahren von Galeria Beata vor dem Einbau messen statt raten – sharp/libvips (Dekodieren, Vorschaubilder, Export, Farbraum, Ausrichtung), ExifTool (Lesen, Schreiben, Durchsatz), Formatunterstützung, Speicher und Zeit, mit synthetischen Testbildern. Verwenden bei neuen Formaten, Vorschaubild- oder Export-Einstellungen, Bearbeitungsschritten, ExifTool-Aufrufen oder wenn eine Leistungszahl im Plan steht.
---

# Bild-Labor

Grundsatz aus der Mottulbox (`ffmpeg-labor`): **Verhalten am gebündelten Werkzeug messen**,
nicht aus Doku oder Erinnerung übernehmen – und das Ergebnis als Test verankern. Messwerte und
Stolpersteine gehören in `docs/PLAN.md` (Phase 0, „Labor“) bzw. später in die Doku.

## 1. Testbilder – nie echte Fotos

Synthetisch über `scripts/testbilder.mjs` (sharp erzeugt Pixel, ExifTool setzt Metadaten), im
Scratchpad oder im Temp-Ordner des Tests, nie im Repository. Absichtlich unbequeme Fälle:

| Fall | Warum |
|---|---|
| EXIF-Ausrichtung 1–8 mit erkennbarem Motiv (Farbe oben/unten/links/rechts) | Drehung pixelgenau prüfbar (Muster `e2e/fotos.mjs` der Mottulbox) |
| Hoch- und Querformat, 1 × 1 px, Panorama 30.000 × 2.000, > 100 MP | Grenzen (`limitInputPixels`), Speicher |
| Progressives JPEG, CMYK-JPEG, 16-Bit-PNG, PNG mit Alpha, animiertes GIF/WebP | Dekoder-Pfade |
| AdobeRGB- und Display-P3-Profil | Farben im Vorschaubild (Umrechnung nach sRGB) |
| Kaputt: abgeschnitten, falsche Endung (PNG als `.jpg`), 0 Byte, EXIF mit falschen Längen | darf nur „defekt“ ergeben, nie den Dienst hängen lassen |
| GPS, Datum mit/ohne `OffsetTimeOriginal`, Unicode in Titel/Stichwörtern | Lesen/Schreiben, Sortierung |
| Namen: Umlaute, Emoji, `Bild 2` / `Bild 10`, führendes `-`, sehr lange Pfade (> 260 Zeichen) | Windows-Pfade, natürliche Sortierung, Argument-Injektion |

## 2. sharp – was zu prüfen ist

- **Fähigkeiten zuerst:** `sharp.format` (Ein-/Ausgabe je Format) und `sharp.versions` in der
  laufenden App ausgeben, nicht aus der Doku schließen. Die fertigen Binaries lesen JPEG, PNG,
  WebP, GIF, AVIF, TIFF, SVG; **kein HEIC** (HEVC) – BMP/ICO prüfen.
- **Ausrichtung:** `.rotate()` ohne Argument richtet nach EXIF auf. Gegenprobe gegen die
  Mottulbox-Funktion `orientBitmap` mit allen acht Ausrichtungen.
- **Farbraum:** Vorschaubilder nach sRGB umrechnen; Testbild mit P3-Rot – das Ergebnis darf
  nicht blasser/greller sein als Chromium das Original zeigt (Pixel vergleichen).
- **Vorschaubilder:** JPEG-Verkleinern beim Dekodieren (`fastShrinkOnLoad`) macht den Großteil
  der Geschwindigkeit; messen mit und ohne. Stufen 256/768, Qualität 80 als Start.
- **Gleichzeitigkeit:** `sharp.concurrency()` und `UV_THREADPOOL_SIZE` im Bilddienst; mehr als
  Kerne bringt nichts, aber teilt den Threadpool mit `fs` – ein Scan darf das Lesen nicht verhungern lassen.
- **Grenzen:** `limitInputPixels` bewusst setzen; zu große Bilder → verständlicher Fehler, kein Absturz.
- **Datei-Cache aus (gemessen 25.10.2026):** libvips hält gelesene Dateien im Cache offen – unter
  Windows lassen sie sich dann nicht löschen oder umbenennen. Im Bilddienst und in jedem Labortest
  `sharp.cache({ files: 0 })`.
- **Defekt erkennt sharp, nicht ExifTool (gemessen):** ExifTool liest nur den Kopf – ein
  abgeschnittenes JPEG meldet es ohne Fehler; den Typ bestimmt es aus dem Inhalt (Text mit
  `.png`-Endung = `TXT`). Sharp mit `failOn: 'truncated'` lehnt alle kaputten Testdateien ab.
- **Vorschaubilder (gemessen 26.10.2026, `vorschau.lab.test.ts`):** Ausrichtung 1–8 pixelgenau;
  P3-Rot nach sRGB kräftig – Gegenprobe mit `ignoreIcc: true` ist blasser, ein Verfahren ohne
  Profil fiele also auf; **GIF hat bei sharp immer einen Alpha-Kanal** (→ WebP-Vorschau); BMP
  lesen die fertigen Binaries nicht (ffmpeg wandelt es in PNG). Dateien vorher selbst in den
  Speicher lesen: Sperren und Rechte kommen dann mit Code (`EBUSY`, `EACCES`) statt als
  sharp-Fehler, der wie „defekt“ aussähe.
- **Metadaten beim Export:** sharp entfernt sie ab Werk; `keepExif`/`withMetadata` nur mit
  Absicht und danach per ExifTool prüfen, dass kein GPS übrig ist (Schicht E im `bildschutz`).
- **Pixel vergleichen statt ansehen:** `.raw()` → sha256 (gleich/ungleich) oder PSNR gegen eine
  Referenz (Vorschau ↔ Ergebnis im Editor).

## 3. ExifTool – was zu prüfen ist

- **Version und Quelle:** `exiftool -ver` der gebündelten Binary (`resources/exiftool/win/`),
  nicht einer aus dem PATH.
- **Durchsatz:** `-stay_open True -@ -`, je Befehl `-execute<n>`, Ende an `{ready<n>}` erkennen.
  Lesen von 1.000 Dateien (`-json -n -G1`, mit und ohne `-fast2`), Schreiben von 100 Dateien;
  Kaltstart der Windows-exe getrennt messen (Perl entpackt sich beim ersten Start).
- **Windows-Pfade:** Unicode nur mit `-charset filename=utf8`; lange Pfade (> 260) und
  Netzlaufwerke einzeln prüfen und das Ergebnis notieren.
- **Schreiben:** Bild nach dem Schreiben mit sharp dekodieren – Pixel-sha256 muss gleich sein;
  Dateidatum mit/ohne `-P`; was passiert bei schreibgeschützter oder gesperrter Datei.
- **Feld-Zuordnung:** jedes Feld aus `shared/metaFields.ts` schreiben und in Windows-Explorer
  (Eigenschaften → Details), digiKam und – wenn vorhanden – Lightroom ablesen. Tabelle mit
  Ergebnis in den Plan (Skill `metadaten-schreiben`).

## 3a. Videos (ffmpeg, Chromium)

- **Testvideos per lavfi** (`testsrc2`, `sine`; Mottulbox-Skill `ffmpeg-labor`): H.264/AAC in MP4,
  HEVC in MOV, VP9 in WebM, Hochkant mit Drehungs-Metadaten, 29,97 fps, ohne Ton, sehr kurz (< 1 s).
- **Abspielbarkeit:** je Datei in der gebauten App prüfen, ob `<video>` startet
  (`canPlayType` reicht nicht – HEVC hängt am Rechner und an der GPU); Ergebnis in die Formatmatrix.
- **Standbild:** Zeitpunkt ~10 % der Dauer, nie das schwarze erste Bild; Drehung beachten
  (Hochkant-Handyvideo); Dauer für 1 Standbild je Video messen.
- **Datum und Ort:** QuickTime-`CreateDate` ist UTC, Apple-`CreationDate` trägt die Zone – mit
  ExifTool an Handy- und Kamera-Testvideos vergleichen und die Rangfolge im Plan bestätigen.
- **Metadaten schreiben:** danach Video- und Tonspuren unverändert (`ffmpeg -i x -map 0 -c copy
  -f streamhash -` vorher/nachher gleich).
- **Sicherheit:** immer `-protocol_whitelist file` und `file:`-Pfade; Gegenprobe mit einer
  Playlist-Datei, die auf eine lokale Spion-Adresse zeigt – es darf keine Anfrage ankommen.

## 4. Zeit und Speicher

- Wanduhr je Lauf und Spitzen-Arbeitsspeicher des Bilddienstes. Windows (PowerShell):
  `Start-Process -PassThru`, dann in kurzen Abständen `$p.Refresh(); $p.PeakWorkingSet64`;
  Linux: `/usr/bin/time -v`. Wächst der Speicher mit der Bildzahl, fehlt ein Freigeben.
- Zielwerte stehen im Plan (Phase 1, „Abnahme“); Ergebnis gegen den Zielwert eintragen, auch
  wenn er verfehlt wird – dann mit Grund und Vorschlag.

## 5. Ergebnis festhalten

1. Befehl/Code, Messwert, Rechner (CPU, Kerne, SSD/HDD), Version von sharp/libvips/ExifTool.
2. Stolperstein in den Plan oder die Doku.
3. Verfahren als Test verankern: rein in `shared/` (vitest), mit echten Werkzeugen als
   `*.lab.test.ts` (überspringt sich ohne gebündeltes ExifTool), oder als Schritt in `e2e/`.

Aufräumen: große Testbibliotheken (50.000 Bilder) nach der Messung löschen, nur das
Erzeugungsskript bleibt.
