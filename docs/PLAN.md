# Plan: Galerie – Bildbetrachter und -bearbeiter für Windows

Arbeitstitel „Galerie“ (Name offen, siehe [Offene Fragen](#offene-fragen)). Stand 25. Oktober 2026,
noch keine Zeile Code. Dieser Plan ist die Grundlage für die Umsetzung: vor jeder Phase lesen,
offene Fragen klären, nach der Umsetzung Erledigtes in die Doku überführen.

- [Ziele](#ziele)
- [Leitplanken](#leitplanken)
- [Entscheidungen](#entscheidungen)
- [Was aus der Mottulbox übernommen wird](#was-aus-der-mottulbox-übernommen-wird)
- [Architektur](#architektur)
- [Funktionen im Detail](#funktionen-im-detail)
- [Schutzkonzept für Bilddaten](#schutzkonzept-für-bilddaten)
- [Installation und Auslieferung](#installation-und-auslieferung)
- [Phasen](#phasen)
- [Tests und Qualität](#tests-und-qualität)
- [Risiken](#risiken)
- [Offene Fragen](#offene-fragen)
- [Skills](#skills)

## Ziele

Aus der Anfrage:

1. **Windows-Desktop-App** zum Betrachten und Bearbeiten von Bildern.
2. **Ordner angeben**, deren Bilder in der Galerie erscheinen (Bibliotheksordner, rekursiv).
3. **Sortieren** nach Aufnahme-/Erstelldatum, GPS, Name und weiteren Metadaten (Kamera, Objektiv,
   Bewertung, Größe …).
4. **Anzeigegröße einstellbar:** Kacheln (stufenlos), Liste, weitere Ansichten.
5. **Metadaten bearbeiten** (einzeln und für viele Bilder auf einmal).
6. **Stapelverarbeitung** generell: Umbenennen, Metadaten, Drehen, Konvertieren, Exportieren …
7. **Installation so einfach wie möglich.**
8. **Alles funktioniert offline.**
9. **Bilddaten gut geschützt.**

**Nicht-Ziele (vorerst):** Cloud, Konten, Synchronisation, RAW-Entwicklung, Ebenen/Retusche wie
in einem Grafikprogramm, Gesichtserkennung, Video-Bearbeitung.

## Leitplanken

Drei Anforderungen gelten für jede Funktion und entscheiden im Zweifel:

| Leitplanke | Heißt konkret |
|---|---|
| **Offline** | Keine Funktion braucht Netz. Die App öffnet von sich aus **keine einzige** Verbindung – technisch erzwungen (Netzsperre in der Sitzung, Lint-Regel gegen Netz-Module im main, E2E mit Spion-Server). Alles Nötige liegt im Paket: ExifTool, Bildbibliothek, Ortsdaten, Schriften, Symbole. |
| **Bilddaten geschützt** | Originale werden nur auf ausdrücklichen Befehl verändert, dann mit Sicherung, atomar und nachgeprüft. Löschen geht in den Papierkorb. Abgeleitete Daten (Vorschaubilder, Index mit GPS) bleiben lokal, verschlüsselt bzw. löschbar. Details: [Schutzkonzept](#schutzkonzept-für-bilddaten). |
| **Einfache Installation** | Eine Datei, Doppelklick, ohne Administratorrechte, ohne Fragen, ohne Downloads beim ersten Start, ohne Laufzeitumgebung (.NET, Java, Python). |

## Entscheidungen

| Thema | Entscheidung | Warum |
|---|---|---|
| Plattform | **Electron + React + TypeScript**, Build mit electron-vite | Wie die Mottulbox: Bausteine, Sicherheits-Härtung, E2E-Harness, CI und Skills lassen sich übernehmen. Tauri/.NET wären kleiner, aber alles neu – und das Bild-Ökosystem (sharp) ist Node. Die Paketgröße (~100–150 MB) ist zweitrangig. |
| Versionen | **Gleicher Stand wie die Mottulbox** beim Start (Electron 44, React 18, Tailwind 3, zustand 5, vitest 4) | UI-Bausteine und Konfigurationen 1:1 nutzbar; große Umstiege (React 19, Tailwind 4) später gemeinsam mit der Mottulbox. |
| Bilder dekodieren, Vorschaubilder, Export | **sharp** (libvips) | Schnell (Verkleinern schon beim Dekodieren bei JPEG), liest JPEG, PNG, WebP, GIF, AVIF, TIFF, SVG; N-API-Binaries im Paket, in der aktuellen Version (0.35) **ohne Install-Skript** (passt zu `ignore-scripts=true`). HEIC (HEVC) ist in den fertigen Binaries **nicht** enthalten → eigene Phase. |
| Metadaten lesen/schreiben | **ExifTool** (gebündelte Windows-Version, eigener dünner Wrapper im `-stay_open`-Modus) | Einziges Werkzeug, das EXIF, IPTC und XMP in allen Formaten (auch RAW, HEIC, Sidecars) zuverlässig schreibt. Wie ffmpeg in der Mottulbox: Download-Skript mit Prüfsumme, im Paket unter `resources/`, kein npm-Paket mit eigenen Abhängigkeiten. |
| Bildarbeit im eigenen Prozess | **utilityProcess „Bilddienst“** (sharp + ExifTool-Steuerung) | Eine präparierte oder kaputte Datei kann einen Dekoder abstürzen lassen – dann stirbt nur der Dienst (Neustart, Datei als „nicht lesbar“ markiert), nicht die App. Der main bleibt für Fenster und IPC frei. |
| Index | **SQLite** (better-sqlite3, wie Mottulbox) mit FTS5 für die Suche, Datenbank nur im main (ein Schreiber) | Sortieren/Filtern über Indizes in Millisekunden auch bei 100.000 Bildern; der Bilddienst liefert Ergebnisse in Stapeln, main schreibt sie in Transaktionen. |
| Galerie-Raster | Virtualisiert (`@tanstack/react-virtual`, wird ins Renderer-Bündel gebaut) | Nur sichtbare Kacheln im DOM; flüssig bei großen Bibliotheken. |
| Bilder zum Renderer | **Eigene Protokolle** `thumb://` und `bild://` mit Bild-Kennung aus dem Index, nie `file://` | Der Renderer kennt keine Pfade und kann keine beliebige Datei lesen (Muster `foto://` der Mottulbox). |
| Bearbeitung | **Nicht-destruktiv:** Bearbeitungsrezept (reines, getestetes `editPlan`), Vorschau im Renderer, Ergebnis mit sharp aus dem Original | Original bleibt, bis ausdrücklich „Original ersetzen“ gewählt wird; Rezepte lassen sich auf viele Bilder übertragen (Stapel). |
| Stapelverarbeitung | **Plan → Vorschau → Ausführen → Bericht → Rückgängig**, Warteschlange aus der Mottulbox (`JobQueue`/`JobList`) | Niemand startet blind eine Aktion auf 5.000 Dateien; Konflikte stehen vor dem Start in der Vorschau. |
| Sprache | Deutsch für Oberfläche und Code-Kommentare (wie Mottulbox) | Einheitlich mit dem bestehenden Projekt. |
| Zielsystem | **Windows 10/11 x64**; Linux läuft in der CI für E2E mit | Gewünscht ist Windows; Linux kostet in der CI nichts und fängt Pfadannahmen. macOS optional später. |

## Was aus der Mottulbox übernommen wird

Kopiert (mit Herkunft im Kopfkommentar), nicht als gemeinsames Paket – das hält beide Projekte
unabhängig. Pfade beziehen sich auf `Mottul/project_mega`.

| Baustein | Herkunft | Wofür hier |
|---|---|---|
| Build-Gerüst | `electron.vite.config.ts`, `tsconfig*.json`, `eslint.config.mjs`, `.prettierrc.json`, `.npmrc` | gleiche Konventionen (kein Semikolon, 100 Zeichen, `--max-warnings 0`, `ignore-scripts`) |
| Electron-Binary mit Prüfsumme | `scripts/fetch-electron-bin.mjs` | Einrichten ohne Install-Skripte |
| Prüfskripte | `scripts/check-filenames.mjs`, `scripts/check-doc-refs.mjs` | Dateinamen-Kollisionen unter Windows, tote Verweise in Doku/Skills |
| Fenster-Härtung | `services/windows/appWindows.ts` (`secureWebPreferences`), `windowGuards.ts`, `windowPolicy.ts` | Sandbox, keine Navigation, keine neuen Fenster, Berechtigungen per Allowlist |
| Einstellungen, Log, atomares Schreiben | `services/store.ts`, `log.ts`, `fsAtomic.ts`, `broadcast.ts` | settings.json mit Wiederherstellung, Schreiben über Nachbardatei + Umbenennen |
| Datei-Dialoge | `services/fileDialogs.ts`, `dialogStartPath.ts` | Ordner merken (Electron startet sonst in „Downloads“) |
| Netzlaufwerke | `services/reachableDir.ts` | nie synchron auf Nutzerordner zugreifen, Zeitlimit |
| Datenbank | `services/db.ts` (Muster) | WAL, Migrationen, Wiederherstellung einer defekten DB |
| Warteschlange | `services/jobs/queue.ts`, `jobList.ts` | Vorschaubilder, Metadaten schreiben, Stapel, Export |
| EXIF-Ausrichtung | `services/fotos/fotoImage.ts` | Gegenprobe im Test (sharp dreht selbst) |
| Eigenes Protokoll | `ipc/fotos.handlers.ts` (`foto://`) | Vorbild für `thumb://`/`bild://` |
| IPC-Vertrag | `shared/ipc-contracts.ts`, `preload/index.ts` | Channels + typisierte API, Renderer nur über `api` |
| UI-Bausteine | `renderer/src/components/ui/*`, `lib/settings`, `lib/persistStorage`, `lib/useDraft`, Theme/Akzent | Felder, Knöpfe, Auswahl, Hell/Dunkel |
| E2E-Harness | `e2e/harness.mjs`, `e2e/run.mjs` | gebaute App mit Playwright starten, frischer Benutzerordner |
| CI und Abhängigkeiten | `.github/workflows/ci.yml`, `installer.yml`, `dependabot.yml` (7 Tage Abstand) | Prüfungen, E2E auf Windows/Linux, Installer bei Tag `v*` |

## Architektur

```
src/
├── main/
│   ├── index.ts                  # Lebenszyklus, Netzsperre, Protokolle, Wächter
│   ├── ipc/                      # library · meta · batch · edit · settings (*.handlers.ts), registry.ts
│   └── services/
│       ├── store.ts · db.ts · log.ts · fsAtomic.ts · fileDialogs.ts · reachableDir.ts · broadcast.ts
│       ├── netzsperre.ts          # alle Anfragen außer App-Seite und eigenen Protokollen abweisen
│       ├── windows/              # appWindows, windowGuards, windowPolicy (aus Mottulbox)
│       ├── library/              # Ordner, Scan, Überwachen, Index schreiben, Abfragen
│       ├── bilddienst/           # utilityProcess: Einstieg, Client mit Neustart und Zeitlimits
│       ├── images/               # Vorschaubilder, Rendern von Rezepten, Export (läuft im Bilddienst)
│       ├── cache/                # Vorschaubild-Ablage (verschlüsselt), Schlüssel über safeStorage
│       ├── exiftool/             # stay_open-Wrapper, Argumentdateien bauen, Pfad zur Binary
│       ├── metadata/             # lesen, schreiben, Journal (Rückgängig), Sidecars
│       ├── batch/                # Stapel-Aufträge (Umbenennen, Metadaten, Export …)
│       ├── protocols/            # thumb:// und bild://
│       └── jobs/                 # queue, jobList (aus Mottulbox)
├── shared/                       # rein und getestet, auch im Renderer nutzbar
│   ├── types.ts · ipc-contracts.ts
│   ├── metaFields.ts             # bearbeitbare Felder: Allowlist, Prüfung, Zuordnung zu Tags
│   ├── sortFilter.ts             # Sortier-/Filter-/Gruppier-Beschreibung -> SQL-Bausteine
│   ├── renamePattern.ts          # Namensmuster {datum:yyyy-MM-dd}_{zähler:3}
│   ├── batchPlan.ts              # Stapel planen: Ziele, Konflikte, Vorschau
│   ├── editPlan.ts               # Bearbeitungsrezept -> Arbeitsschritte (Vorschau und Rendern)
│   └── dates.ts · geo.ts         # Aufnahmedatum ermitteln, Entfernungen, nächster Ort
├── preload/index.ts              # typisierte API über contextBridge
└── renderer/src/
    ├── galerie/                  # Ordnerbaum, Raster, Liste, Filterleiste, Auswahl
    ├── betrachter/               # Vollbild, Zoom, Filmstreifen, Diashow, Info-Panel
    ├── metadaten/                # Bearbeiten-Panel (einzeln und mehrfach)
    ├── stapel/                   # Assistent: Aktionen, Vorschau, Fortschritt, Bericht
    ├── editor/                   # Zuschneiden, Drehen, Regler, Vorher/Nachher
    ├── einstellungen/            # Ordner, Cache, Datenschutz, Darstellung
    └── components/ui/ · lib/     # aus Mottulbox
e2e/                              # harness, smoke, netz, originale, galerie, metadaten, stapel …
scripts/                          # fetch-electron-bin, download-exiftool, testbilder, check-*
resources/exiftool/win/           # gebündeltes ExifTool (nicht im Git, per Skript geladen)
```

### Datenfluss

1. Nutzer fügt einen Ordner hinzu (Ordner-Dialog im main → Ordner gilt als freigegeben).
2. **Scan** (Bilddienst): Dateiliste rekursiv, Ausschlüsse (`$RECYCLE.BIN`, `System Volume
   Information`, versteckte Ordner, eigene Cache-Ordner) → main schreibt Grunddaten in Stapeln.
3. **Metadaten** (Bilddienst, ExifTool stapelweise) → Spalten im Index + vollständige Liste als JSON.
4. **Vorschaubilder** (Bilddienst, sharp): sichtbare Bilder zuerst, dann der Rest im Hintergrund;
   verschlüsselt in den Cache.
5. **Überwachen:** `fs.watch` rekursiv (lokal), Abgleich beim Start und bei Fokus; Netzlaufwerke
   periodisch mit Zeitlimit. Bei Überlauf der Ereignisse: Ordner neu abgleichen.
6. **Renderer** fragt `library.query({ sortierung, filter, gruppierung })` → geordnete Liste der
   Bild-Kennungen + Anzahl; Details nur für den sichtbaren Ausschnitt; Bilder über `thumb://<id>/<stufe>`.

### Index (Skizze)

```sql
folders  (id, path UNIQUE, mode /* normal | nur-lesen | privat */, added_at, last_scan)
images   (id, folder_id, rel_path, name, name_sort, ext, size, mtime, btime,
          width, height, orientation, taken_at /* lokal, ISO */, taken_offset, taken_source,
          gps_lat, gps_lon, gps_alt, place_id, camera_make, camera_model, lens,
          iso, aperture, exposure, focal, rating, color_label, title, description,
          thumb_state, meta_json, meta_read_at, status /* ok | fehlt | defekt */)
keywords (image_id, keyword)          -- normalisiert, für Filter und Gruppen
journal  (id, at, action, image_id, before_json, after_json, undone_at)   -- Rückgängig
recipes  (image_id, recipe_json, version, updated_at)                    -- Bearbeitungen
images_fts (name, title, description, keywords, place)                   -- FTS5
```

Indizes auf jede Sortierspalte (mit `folder_id`), `taken_at` mit Rückfall-Reihenfolge, `rating`,
`camera_model`. Schema mit Version und Migrationen wie `db.ts` der Mottulbox.

### Protokolle

| Protokoll | Liefert | Prüfung |
|---|---|---|
| `thumb://<id>/<stufe>` | Vorschaubild (Stufe 256 oder 768 px, entschlüsselt) | Kennung ganzzahlig, Stufe aus Allowlist, nur aus dem Cache |
| `bild://<id>` | Original, wenn Chromium es darstellen kann (JPEG, PNG, WebP, GIF, AVIF, BMP); sonst eine bildschirmgroße Umrechnung (TIFF, später HEIC/RAW) | Kennung muss im Index stehen, Pfad liegt (nach `realpath`) in einem Bibliotheksordner, Datei unverändert seit dem Index |

CSP der Seite: `img-src 'self' data: blob: thumb: bild:`, `connect-src 'self'`, kein `unsafe-eval`.

## Funktionen im Detail

### Bibliothek und Ordner

- Ordner hinzufügen/entfernen (Dialog), rekursiv, Unterordner einzeln ausschließen.
- **Ordner-Modus:** *normal*; *nur lesen* (die App schreibt dort nie, auch nicht im Stapel – fürs
  Archiv); *privat* (keine Vorschaubilder auf der Platte, nur im Arbeitsspeicher).
- Ordnerbaum links mit Anzahl; „Alle Bilder“, „Zuletzt hinzugefügt“, „Ohne Datum“, „Ohne GPS“.
- Entfernen eines Ordners löscht seine Index-Zeilen und Vorschaubilder sofort (keine Reste).
- Fehlende Dateien (USB-Platte ab) bleiben als „nicht erreichbar“ sichtbar statt zu verschwinden.

### Galerie-Ansichten

- **Kacheln** mit stufenlosem Größenregler (ca. 80–400 px, auch Strg + Mausrad), quadratisch
  beschnitten oder im Seitenverhältnis.
- **Blocksatz** (Justified, Zeilen gleicher Höhe wie in Google Fotos/Lightroom) – Phase 2.
- **Liste/Details:** Tabelle mit wählbaren, sortierbaren Spalten (Name, Datum, Kamera, Maße,
  Größe, Bewertung, Ort …) und kleinem Vorschaubild.
- **Gruppen-Überschriften** (Tag, Monat, Jahr, Ordner, Kamera, Ort) in allen Ansichten.
- Auswahl wie im Explorer (Klick, Strg, Umschalt, Strg+A, Rahmen ziehen), Statusleiste mit
  Anzahl und Summe.
- Ansicht, Größe und Sortierung je Ordner gemerkt (Bedienzustand, nicht im Bild).

### Sortieren, Filtern, Gruppieren, Suchen

- **Aufnahmedatum** mit fester Rangfolge: EXIF `DateTimeOriginal` (+ `SubSecTimeOriginal`,
  `OffsetTimeOriginal`) → `CreateDate` → XMP `photoshop:DateCreated` → Dateierstellung →
  Änderungsdatum. Die Quelle wird gespeichert und im Info-Panel genannt („Datum aus Datei, nicht
  aus der Kamera“).
- **Name** natürlich sortiert („Bild 2“ vor „Bild 10“), ohne Groß/Klein, Umlaute richtig.
- **GPS:** (a) nach Entfernung zu einem Bezugspunkt (gewähltes Bild oder Ort aus der Liste),
  (b) gruppiert nach Ort (offline: nächster Ort aus GeoNames-Daten im Paket), (c) Filter
  „mit/ohne Standort“; Karte offline in Phase 7.
- **Weitere:** Kamera, Objektiv, ISO, Blende, Belichtungszeit, Brennweite, Bewertung, Farblabel,
  Auflösung, Seitenverhältnis, Dateigröße, Typ, Ordner, Änderungsdatum.
- **Filterleiste:** Zeitraum, Bewertung ≥, Farblabel, Kamera, Stichwort, Ort, Format,
  Ausrichtung (hoch/quer), mit/ohne GPS; kombinierbar, als Ansicht speicherbar.
- **Suche:** Volltext (FTS5) über Name, Titel, Beschreibung, Stichwörter, Ort.

### Betrachter

- Doppelklick öffnet; Vollbild (F11), Anpassen / 100 % / Mausrad-Zoom am Mauszeiger, Verschieben,
  Vor/Zurück (Pfeiltasten, auch über Gruppengrenzen), Filmstreifen, Diashow mit Intervall.
- Info-Panel: Aufnahme, Kamera, Ort, Datei, Beschreibung, „alle Felder“; Histogramm.
- Schnell bewerten (Tasten 0–5), Farblabel (6–9), drehen (verlustfrei, siehe Stapel), löschen
  (Papierkorb).
- Vorladen der Nachbarbilder; EXIF-Ausrichtung beachtet Chromium selbst, sharp bei Vorschaubildern.
- Vergleichsansicht (zwei Bilder nebeneinander, gekoppelter Zoom) – Phase 7.

### Metadaten bearbeiten

Einzeln und für eine Auswahl: gemischte Werte zeigen „‹verschieden›“; geschrieben werden nur
geänderte Felder; Stichwörter **hinzufügen/entfernen** statt ersetzen.

| Feld | Schreibt in (Startpunkt – im Labor gegen Windows-Explorer, digiKam und Lightroom prüfen) |
|---|---|
| Titel | `XMP-dc:Title`, `IPTC:ObjectName`, `XPTitle` |
| Beschreibung | MWG `Description` (EXIF `ImageDescription`, IPTC `Caption-Abstract`, `XMP-dc:Description`) |
| Stichwörter | MWG `Keywords` (IPTC `Keywords`, `XMP-dc:Subject`) und `XPKeywords` |
| Bewertung (0–5) | `XMP-xmp:Rating` und EXIF `Rating`/`RatingPercent` (Explorer) |
| Farblabel | `XMP-xmp:Label` |
| Aufnahmedatum | `DateTimeOriginal`, `CreateDate`, `OffsetTime*`, `XMP-photoshop:DateCreated` |
| Standort | `GPSLatitude/Ref`, `GPSLongitude/Ref`, `GPSAltitude/Ref`; entfernen = alle GPS-Tags |
| Ort (Text) | MWG `City`, `State`, `Country`, `Location` |
| Urheber, Copyright | MWG `Creator`, MWG `Copyright` |

- **Schreiben:** über die Warteschlange; vorher prüfen, ob die Datei seit dem Lesen geändert wurde
  (Größe + Änderungszeit); alte Werte ins Journal (Rückgängig); optional vollständige Sicherung;
  danach neu lesen und vergleichen; Dateidatum auf Wunsch behalten.
- **RAW und schreibgeschützte Dateien:** XMP-Sidecar (`bild.xmp`) statt Datei ändern.
- Regeln im Skill [`metadaten-schreiben`](../.claude/skills/metadaten-schreiben/SKILL.md).

### Stapelverarbeitung

Assistent in fünf Schritten: **Auswahl → Aktionen (Kette) → Vorschau → Ausführen → Bericht**,
danach „Rückgängig“ für umkehrbare Aktionen. Voreinstellungen („Rezepte“) speicherbar.

| Aktion | Details |
|---|---|
| Umbenennen | Muster mit Platzhaltern `{name}`, `{datum:yyyy-MM-dd_HH-mm-ss}`, `{zähler:3}`, `{kamera}`, `{ort}`, `{titel}`, `{ext}`; Groß/Klein; Suchen/Ersetzen |
| Metadaten | Felder setzen, Stichwörter hinzufügen/entfernen, Urheber/Copyright für alle |
| Zeit verschieben | Uhrzeit der Kamera falsch gestellt: ± Tage/Stunden/Minuten, oder „dieses Bild war um 14:32“ → Versatz für alle |
| Standort | entfernen; setzen (Ort wählen); später aus GPX-Track zuordnen |
| Drehen/Spiegeln | verlustfrei über die EXIF-Ausrichtung (Standard) oder pixelweise |
| Konvertieren/Exportieren | Format (JPEG, PNG, WebP, AVIF, TIFF), Qualität, längste Kante, Farbraum sRGB, Metadaten behalten / ohne Standort / alle entfernen, Zielordner, Namensmuster |
| Ordnen | in Ordner nach Datum verschieben/kopieren (`{jahr}/{monat}`) |
| Bearbeitung übertragen | Rezept eines Bildes auf die Auswahl anwenden (Phase 5) |

- **Vorschau** als Tabelle vorher/nachher mit Konflikten (gleicher Zielname, Groß/Klein unter
  Windows, reservierte Namen, Pfad zu lang, Ordner nur lesen) – nichts startet mit offenen Konflikten.
- **Ausführen** einzeln je Datei: ein Fehler stoppt nicht den Rest; Abbrechen jederzeit;
  Bericht mit Fehlern je Datei.
- Regeln im Skill [`stapelverarbeitung`](../.claude/skills/stapelverarbeitung/SKILL.md).

### Bildbearbeitung

- Drehen (90° und frei/Begradigen), Spiegeln, Zuschneiden (frei und Seitenverhältnisse),
  Größe ändern, Belichtung, Helligkeit, Kontrast, Sättigung, Farbtemperatur, Schärfen,
  Auto-Korrektur, Schwarzweiß.
- **Rezept** (versioniert, rein in `shared/editPlan.ts`) im Index; Vorschau im Renderer
  (Canvas/WebGL auf dem 768-px-Vorschaubild bzw. einer bildschirmgroßen Umrechnung), Ergebnis
  mit sharp aus dem Original. Test: Vorschau und Ergebnis stimmen innerhalb einer Toleranz überein.
- Speichern: **„Als Kopie speichern“** (Standard), „Original ersetzen“ (Sicherung, Metadaten
  übernehmen, Ausrichtung auf 1 setzen), Rückgängig/Wiederholen im Editor, Vorher/Nachher.

## Schutzkonzept für Bilddaten

„Gut geschützt“ wird in sechs Schichten umgesetzt. A–D sind Pflicht ab Phase 1, E–F folgen.
Checkliste: Skill [`bildschutz`](../.claude/skills/bildschutz/SKILL.md).

| | Schicht | Umsetzung | Nachweis |
|---|---|---|---|
| **A** | **Nichts verlässt den Rechner** | Netzsperre: `session.webRequest` weist alles außer App-Seite und eigenen Protokollen ab; ESLint verbietet `node:http(s)`, `node:net`, `node:dgram`, Electrons `net` im main; keine Telemetrie, keine Absturzberichte, kein Auto-Update; Schriften/Symbole/Ortsdaten im Paket | E2E `netz`: lokaler Spion-Server bekommt nie eine Anfrage, auch nicht über Bilder mit Fremd-URLs (SVG, XMP) |
| **B** | **Originale unantastbar** | Standard ist lesen; jede schreibende Aktion ist ausdrücklich und nennt die Dateien; vorher Sicherung (`Sicherungen/`, Aufbewahrung einstellbar), atomar ersetzen, danach nachprüfen; Löschen nur in den Papierkorb (`shell.trashItem`), sonst ausdrückliche Rückfrage; Ordner-Modus „nur lesen“; Journal für Rückgängig | E2E `originale`: Prüfsummen aller Testbilder vor/nach jedem Lauf; nach Metadaten-Schreiben sind die **Pixeldaten** gleich (sharp roh → sha256) |
| **C** | **Renderer ohne Dateizugriff** | Sandbox, contextIsolation, kein Node, keine Webviews, keine Navigation (aus Mottulbox); Bilder nur über `thumb://`/`bild://` mit Kennungen aus dem Index; jeder IPC-Eingang wird geprüft (Allowlist, Grenzen); Schreiben nur in freigegebene Pfade | Unit-Tests der Protokolle (erfundene Kennung, `..`, Symlink aus dem Ordner) und E2E `security` |
| **D** | **Abgeleitete Daten geschützt** | Index und Vorschaubilder unter `%LOCALAPPDATA%` (nicht im Roaming-Profil, nicht in OneDrive); Vorschaubilder **AES-256-GCM-verschlüsselt**, Schlüssel über `safeStorage` (Windows-DPAPI, an das Benutzerkonto gebunden); „privat“-Ordner ohne Cache auf der Platte; Cache leeren; Ordner entfernen löscht alles Abgeleitete; Log ohne Metadaten-Werte (keine GPS-Daten, Titel o. Ä.) | Unit-Test Verschlüsselung (falscher Schlüssel, manipulierte Datei); E2E: Cache enthält keine JPEG-Signatur |
| **E** | **Weitergeben ohne Spuren** | Export standardmäßig **ohne Standort**, wahlweise ohne Seriennummern/Besitzer oder ohne alle Metadaten; „Was steckt drin?“-Bericht vor dem Export | Labortest: exportierte Datei enthält keine GPS-Tags |
| **F** | **Lieferkette und Programm** | Wenige Laufzeit-Abhängigkeiten, exakt gepinnt, 7 Tage Abstand, `ignore-scripts`, Lockfile mit Integrity; ExifTool/Electron mit Prüfsumme; Fehlergrenzen, Wiederherstellung defekter DB/Einstellungen; Bilddienst als eigener Prozess | CI: `npm audit --omit=dev` ohne Befund, Prüfsummen in den Skripten |

**Optional (Entscheidung offen):** App-Sperre mit PIN, verschlüsselte Index-Datenbank
(SQLCipher-Variante – nur, wenn sie ohne Install-Skript und Compiler auskommt), „Tresor“-Ordner
mit verschlüsselten Originalen. Siehe [Offene Fragen](#offene-fragen).

## Installation und Auslieferung

- **Eine Datei:** `Galerie-<Version>-setup.exe` (NSIS, **One-Click, je Benutzer**): Doppelklick,
  keine Administratorrechte, keine Fragen, Startmenü- und Desktop-Verknüpfung, startet danach.
- **Alles im Paket:** ExifTool, sharp/libvips, Ortsdaten, Schriften. Beim ersten Start wird
  **nichts** geladen; keine Laufzeitumgebung nötig (Electron bringt Chromium mit).
- **Portable Variante** (`Galerie-<Version>-portable.exe`, Phase 7): ohne Installation, z. B.
  vom USB-Stick; Daten wahlweise neben der Datei.
- **Ohne Code-Signatur** meldet SmartScreen „Unbekannter Herausgeber“ (*Weitere Informationen →
  Trotzdem ausführen*). Das ist die größte Hürde für „so einfach wie möglich“ → [Offene Fragen](#offene-fragen).
- **Updates:** offline gedacht → neue Version = neuen Installer ausführen, Bibliothek und
  Einstellungen bleiben. Kein automatisches Nachladen.
- **Deinstallation** entfernt Programm **und** Cache/Index (enthält Vorschaubilder); Einstellungen
  und Sicherungen nach Rückfrage bzw. Doku. Umsetzung im Skill [`windows-paket`](../.claude/skills/windows-paket/SKILL.md).
- **„Öffnen mit“**/Dateizuordnung für JPEG, PNG … (Phase 7), damit Doppelklick im Explorer die
  Galerie öffnet.
- Abnahme jeder Version in der **Windows-Sandbox ohne Netz** (`<Networking>Disable</Networking>`):
  installieren, Ordner hinzufügen, ansehen, Metadaten schreiben, deinstallieren.

## Phasen

Jede Phase endet mit einem installierbaren Stand, grüner CI und aktualisierter Doku. Zielwerte
sind vorläufig und werden in Phase 0 an Messungen geprüft.

### Phase 0 – Fundament und Labor

- Gerüst aus der Mottulbox (Tabelle oben): Build, Lint, Format, Typen, Tests, E2E-Harness, CI
  (Windows + Linux), Dependabot, `CLAUDE.md`, Doku-Gerüst (`docs/ENTWICKLUNG.md`,
  `docs/SICHERHEIT.md`, `docs/INSTALL.md`).
- Netzsperre (Schicht A) und Fenster-Härtung (C) von Anfang an, mit E2E `netz` und `security`.
- `scripts/download-exiftool.mjs` (`npm run exiftool:fetch`; offizielle Quelle, Version und SHA-256 fest im Skript) und `scripts/testbilder.mjs`
  (synthetische Testbibliothek, nie echte Fotos).
- **Labor** (Skill `bild-labor`), Ergebnisse in diesen Plan:
  - sharp im Electron-Bilddienst: Vorschaubilder je Sekunde (24-MP-JPEG, 4-Kern-Laptop),
    Spitzenspeicher, `concurrency`, sehr große Bilder (Panorama > 100 MP), kaputte Dateien.
  - ExifTool `-stay_open`: Lesen von 1.000 / Schreiben von 100 Dateien, Unicode-Pfade
    (`-charset filename=utf8`), Pfade > 260 Zeichen, Netzlaufwerk.
  - Formatmatrix (was dekodiert sharp, was zeigt Chromium, was schreibt ExifTool).
  - Paket: `asarUnpack` für sharp/`@img`, ExifTool über `extraResources`, Größe des Installers.
  - better-sqlite3: 50.000 Zeilen in Stapeln einfügen – wie lange blockiert main je Stapel?
- **Abnahme:** leere App installiert und startet offline in der Windows-Sandbox; E2E grün auf
  Windows und Linux; Messwerte stehen hier.

### Phase 1 – Bibliothek und Galerie (erste nutzbare Version)

- Ordner hinzufügen/entfernen, Ordner-Modi, Scan, Überwachen, Bilddienst mit Neustart.
- Vorschaubilder (Stufen 256/768) verschlüsselt im Cache (Schicht D), sichtbare zuerst.
- Kacheln mit Größenregler, Liste/Details, Ordnerbaum, Auswahl, Statusleiste.
- Sortieren nach Name, Aufnahmedatum (Grundfelder schon beim Scan), Dateidatum, Größe, Typ.
- Betrachter: Vollbild, Zoom, Vor/Zurück, Filmstreifen, Diashow, Löschen in den Papierkorb.
- Formate: JPEG, PNG, WebP, GIF, AVIF, TIFF; BMP nach Labor.
- **Abnahme** (50.000 synthetische Bilder): Neustart mit vorhandenem Index bis zur sichtbaren
  Galerie < 2 s, Sortierwechsel < 200 ms, Scrollen ohne Ruckeln, Erstindex im Hintergrund ohne
  hängende Oberfläche; E2E `galerie`, `originale`.

### Phase 2 – Metadaten lesen, Filtern, Suchen

- Vollständiges Lesen per ExifTool, Info-Panel, „alle Felder“.
- Sortieren nach allen Feldern inkl. GPS-Entfernung; Gruppieren (Tag/Monat/Jahr, Ordner,
  Kamera, Ort); Blocksatz-Ansicht.
- Filterleiste, gespeicherte Ansichten, Volltextsuche.
- Offline-Ortsnamen (GeoNames, Lizenz CC BY 4.0 – Hinweis in „Über“).
- **Abnahme:** E2E `sortieren` mit bekannten Testbildern (Reihenfolge exakt erwartet).

### Phase 3 – Metadaten bearbeiten

- Bearbeiten-Panel einzeln/mehrfach, Felder aus `shared/metaFields.ts`.
- Schreiben mit Konfliktprüfung, Journal/Rückgängig, Sicherung, Nachprüfung, XMP-Sidecars.
- Schnellbewertung im Betrachter.
- **Abnahme:** E2E `metadaten` (Werte stehen danach in der Datei, Pixeldaten unverändert,
  Rückgängig stellt den alten Stand her); Checkliste von Hand: Explorer und digiKam zeigen Titel,
  Stichwörter, Bewertung.

### Phase 4 – Stapelverarbeitung

- Assistent, alle Aktionen der Tabelle außer „Bearbeitung übertragen“, Rezepte speichern.
- Zweistufiges Umbenennen (Tausch A↔B, nur Groß/Klein), Rückgängig über das Journal.
- Export mit Datenschutz-Vorgaben (Schicht E).
- **Abnahme:** E2E `stapel` (Vorschau = Ergebnis, Konflikte blockieren, Abbrechen hinterlässt
  keine halben Dateien, Rückgängig).

### Phase 5 – Bildbearbeitung

- Editor mit Werkzeugen, Rezept, Vorschau/Ergebnis-Abgleich, Als Kopie / Original ersetzen.
- Rezept auf Auswahl übertragen (Stapel).
- **Abnahme:** Labortest Vorschau ↔ Ergebnis (PSNR-Grenze), E2E `editor`.
- **Version 1.0** nach Phase 5.

### Phase 6 – Privatsphäre-Ausbau

- „Was steckt drin?“-Bericht, Export-Profile, Seriennummern entfernen.
- Je nach Antwort auf die offenen Fragen: App-Sperre, verschlüsselter Index, Tresor-Ordner.

### Phase 7 – Erweiterungen nach Bedarf

HEIC (libheif als WebAssembly oder das ffmpeg der Mottulbox – im Labor vergleichen), RAW-Vorschau
(eingebettetes JPEG per ExifTool), Karte offline (Natural-Earth-Grundkarte), Duplikate (exakt per
Hash, ähnlich per Wahrnehmungs-Hash), GPX-Zuordnung, Vergleichsansicht, Dateizuordnung,
portable Variante, Videos (nur anzeigen).

## Tests und Qualität

- **Rein und getestet** (vitest): `sortFilter`, `renamePattern`, `batchPlan`, `editPlan`,
  `metaFields`, `dates`, `geo`, Argumentdateien für ExifTool, Protokoll-Prüfungen.
- **Labortests** mit echtem sharp/ExifTool auf synthetischen Bildern (`*.lab.test.ts`, wie
  `player.lab.test.ts` der Mottulbox).
- **E2E** (Playwright, gebaute App, frischer Benutzerordner, Testbibliothek aus
  `scripts/testbilder.mjs`): `smoke`, `security`, `netz`, `originale`, `galerie`, `sortieren`,
  `metadaten`, `stapel`, `editor`, `paket`.
- **Nie echte Fotos** in Repository, Tests, Logs oder Fehlerberichten.
- Vor jedem Abschluss: Skill `abschluss-check`; zusätzlich `review-checkliste` und `bildschutz`.

## Risiken

| Risiko | Gegenmittel |
|---|---|
| ExifTool-Start/Durchsatz unter Windows langsam (Perl in der exe) | `-stay_open`, ein Prozess je Spur, stapelweise; im Labor messen. Rückfall fürs schnelle Lesen beim Scan: reiner JS-Leser (z. B. exifr), Schreiben bleibt bei ExifTool |
| Dekoder-Absturz an präparierten Dateien | Bilddienst als eigener Prozess, Zeitlimit je Datei, Datei als „defekt“ markieren |
| `fs.watch` verpasst Änderungen (Netzlaufwerk, Überlauf) | Abgleich beim Start, bei Fokus und periodisch; Überlauf → Ordner neu abgleichen |
| Metadaten erscheinen in anderen Programmen nicht | Feld-Zuordnung im Labor gegen Explorer/digiKam/Lightroom prüfen, MWG-Regeln |
| SmartScreen schreckt ab | Code-Signatur prüfen (offene Frage), INSTALL.md mit Bildern |
| Große Bibliotheken (> 100.000) | Kennungslisten statt Objekte über IPC, Indizes, virtualisiertes Raster; Messung mit 100.000 synthetischen Bildern |
| Zeitzonen beim Aufnahmedatum | Datum „lokal wie in der Kamera“ speichern, Versatz getrennt; Zeitverschiebung als eigene Stapel-Aktion |

## Offene Fragen

Vor Phase 1 klären (Annahme in Klammern, gilt, bis etwas anderes entschieden ist):

1. **Was heißt „gut geschützt“ für dich?** Reichen die Schichten A–F, oder brauchst du zusätzlich
   App-Sperre (PIN), verschlüsselten Index oder einen verschlüsselten Tresor-Ordner?
   (Annahme: A–F, Rest optional in Phase 6.)
2. **„Sortieren nach GPS“** – Entfernung zu einem Ort, nach Orten gruppiert oder eine Karte?
   (Annahme: Entfernung + Gruppen ab Phase 2, Karte Phase 7.)
3. **HEIC (iPhone) und RAW** nötig? Welche Kameras/Handys? (Annahme: Phase 7.)
4. **Videos** in der Galerie anzeigen? (Annahme: nein, später nur anzeigen.)
5. **Größe der Bibliothek** und Ablage: wie viele Bilder, lokal, USB, NAS? (Annahme: bis 100.000,
   lokal und USB, NAS mit Einschränkungen.)
6. **Code-Signatur** (jährliche Kosten) für eine Installation ohne SmartScreen-Warnung?
   (Annahme: vorerst unsigniert wie die Mottulbox.)
7. **Metadaten in die Bilddatei schreiben** (Standard) oder lieber nur XMP-Sidecars bzw. nur in
   der App? (Annahme: in die Datei, Sidecar für RAW und schreibgeschützte Dateien.)
8. **Updates:** ganz ohne Netz (manuell) oder ein Knopf „Nach Updates suchen“, der als einzige
   Funktion online geht und ab Werk aus ist? (Annahme: ganz ohne Netz.)
9. **Name der App** und Logo. (Annahme: Arbeitstitel „Galerie“.)
10. **Eigenständige App** (Annahme) oder Werkzeug in der Mottulbox?
11. Nur **Windows** oder auch macOS/Linux als Paket? (Annahme: nur Windows; Linux nur in der CI.)

## Skills

In `.claude/skills/` angelegt. Aus der Mottulbox übernommen und angepasst:

| Skill | Wofür |
|---|---|
| `abschluss-check` | Prüfung vor Commit/PR: Format, Lint, Typen, Tests, E2E, Doku, Bericht |
| `ipc-kanal` | neue IPC-Fläche (Channel, API, Preload, Handler) mit Eingabeprüfung |
| `electron-e2e` | E2E-Tests der gebauten App, bewährte Muster und Grenzen aus der Mottulbox |
| `abhaengigkeiten` | Pakete mit 7 Tagen Abstand, Electron-Hauptversionen, native Module (sharp, better-sqlite3), ExifTool |
| `review-checkliste` | bestätigte Fehlerklassen aus den Mottulbox-Reviews, ergänzt um Bild-spezifische |

Neu für die Galerie:

| Skill | Wofür |
|---|---|
| `bild-labor` | Bildverfahren (sharp, ExifTool, Formate) messen statt raten – Testbilder, Pixel, Durchsatz, Speicher |
| `bibliothek-index` | Scan, Überwachen, Index-Schema, Migrationen, Sortier-/Filter-Abfragen, Leistung |
| `metadaten-schreiben` | Metadaten sicher schreiben: Feld-Zuordnung, ExifTool-Aufrufe, Journal, Nachprüfung, Sidecars |
| `stapelverarbeitung` | Stapel planen, Konflikte, zweistufiges Umbenennen, Ausführen, Bericht, Rückgängig |
| `bildschutz` | Schutzkonzept A–F als Prüfliste vor jeder Änderung, die Dateien, Cache, Netz oder Export berührt |
| `windows-paket` | Installer (One-Click, je Benutzer), Ressourcen im Paket, Offline-Test in der Windows-Sandbox |

Nicht übernommen, weil Mottulbox-spezifisch: `projektdatei`, `kabelverlauf`, `anleitung-inhalte`,
`fernsteuerung-seite`, `konvertierungs-kern`, `neues-werkzeug`, `ffmpeg-labor` (Vorgehen steckt in
`bild-labor`), `aufraeumen` (bei Bedarf später samt Skripten übernehmen).
